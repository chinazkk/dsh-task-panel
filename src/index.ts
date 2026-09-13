// @ts-nocheck — the plugin body below is JS-style (ported from the dynamic host body);
// type-checking is disabled like the harness's own allowJs/checkJs:false packages.

// dsh-task-panel · Host half (bundle form)
// Converts the dynamic-plugin host body into a standard Cordis bundle plugin.
// Client RPC (`harness.handle`) is bridged over a web route the client fetches.
import { defineTool } from '@deepseek-ai/dsh-tools'

const rpcHandlers = new Map()
let rpcRegistered = false

/** Convert a JSON-Schema-wrapper `parameters` object into the DSL property map `defineTool` expects. */
function normalizeParameters(value) {
  if (value && typeof value === 'object' && value.type === 'object' && value.properties) {
    const required = new Set(value.required ?? [])
    const spec = {}
    for (const [k, v] of Object.entries(value.properties)) {
      spec[k] = { ...v, ...(required.has(k) ? { required: true } : {}) }
    }
    return spec
  }
  return value
}

/** The closure symbols the dynamic host body references, backed by bundle APIs. */
const harness = {
  defineTool: (def) => defineTool({ ...def, parameters: normalizeParameters(def.parameters) }),
  registerTool: (ctx, def) => ctx.tools.register(def),
  handle: (method, fn) => {
    rpcHandlers.set(method, fn)
    return () => rpcHandlers.delete(method)
  },
}

/** Register the client↔host RPC route once the web server is available. */
function registerRpcRoute(ctx) {
  if (rpcRegistered) return
  const webServer = ctx.get('webServer') ?? ctx.get('httpServer')
  if (!webServer) return
  rpcRegistered = true
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/plugins/dsh-task-panel/rpc',
    handler: async (req, res) => {
      let body = ''
      for await (const chunk of req) body += chunk
      let payload = /** @type {any} */ ({})
      try { payload = JSON.parse(body || '{}') } catch { /* ignore */ }
      const fn = rpcHandlers.get(payload.method)
      if (!fn) {
        res.writeHead(404)
        res.end(JSON.stringify({ error: 'method-not-found' }))
        return
      }
      try {
        const value = await fn(payload.args ?? null)
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify(value ?? null))
      } catch (e) {
        res.writeHead(500)
        res.end(JSON.stringify({ error: String(e && e.message ? e.message : e) }))
      }
    },
  }), 'dsh-task-panel: rpc route')
}

// ── host.js dynamic body, verbatim ─────────────────────────────────────────
const plugin = (() => {
// ─────────────────────────────────────────────────────────────
// dsh-task-panel · Host 半
// 需求面板 + 双队列任务队列：
//   需求队列(backlog) → 执行队列(queued) → 执行中(executing)
//   → 待验收(accepting) → 验收完成(accepted)，返工自动重入。
// 队列在子 session（subagents.start）中串行执行，
// 完成后回填一句话产物 + 完整对话 transcript，供验收查看。
// ─────────────────────────────────────────────────────────────

return {
  inject: ['subagents', 'agents', 'directoryPicker'],
  apply(ctx) {
    const subagents = ctx.subagents
    const agents = ctx.agents
    const sessionQuery = ctx.get('sessionQuery')
    const fs = ctx.get('fs')
    const sandboxPolicy = ctx.get('sandboxPolicy')
    const systemPrompt = ctx.get('systemPrompt')
    const agentPresets = ctx.get('agentPresets')
    const agentDefaultModel = ctx.get('agentDefaultModel')
    const directoryPicker = ctx.get('directoryPicker')

    const MAX_REWORK = 5
    const EXECUTION_OUTPUT_SCHEMA = {
      type: 'object',
      properties: {
        done: { type: 'boolean' },
        summary: { type: 'string' },
        changedFiles: { type: 'array', items: { type: 'string' } },
        testCommand: { type: 'string' },
        testResult: { type: 'string' },
        blocker: { type: 'string' },
      },
      required: ['done'],
      additionalProperties: true,
    }
    const REVIEW_OUTPUT_SCHEMA = {
      type: 'object',
      properties: {
        passed: { type: 'boolean' },
        verdict: { type: 'string' },
        issues: { type: 'array', items: { type: 'string' } },
        suggestions: { type: 'array', items: { type: 'string' } },
      },
      required: ['passed'],
      additionalProperties: true,
    }
    // 执行器不应使用面板管理工具（防止误调 complete_execution 等绕过队列元数据捕获）
    // 注意：deny 名单必须是子 agent 作用域内「已知的全局工具」，否则 tools.restrict 校验会抛错
    const EXEC_DENY_TOOLS = [
      'propose_requirement', 'edit_requirement', 'delete_requirement',
      'dispatch_requirement', 'list_requirements', 'get_requirement',
      'complete_execution', 'submit_acceptance',
    ]
    // 持久化诊断（通过 list_requirements 输出，便于定位写入失败原因）
    let persistDiag = 'ok'

    // ── 沙箱没有 AbortController，从真实事件捕获 AbortSignal 构造器 ──
    // agent/pre-step（每步）与 tools/execute（每次工具调用）都携带当前 step 的中止信号，
    // 从信号对象取出其构造器，用于生成「永不中断」的子 agent 信号。
    let AbortSignalCtor = null
    function captureSignalCtor(signal) {
      if (!AbortSignalCtor && signal && typeof signal === 'object' && signal.constructor) {
        try { AbortSignalCtor = signal.constructor } catch (e) { /* noop */ }
      }
    }
    ctx.on('agent/pre-step', (payload, next) => {
      try { if (payload && payload.signal) captureSignalCtor(payload.signal) } catch (e) { /* noop */ }
      return next()
    })
    ctx.on('tools/execute', (exec, next) => {
      try { if (exec && exec.signal) captureSignalCtor(exec.signal) } catch (e) { /* noop */ }
      return next()
    })
    // 无可用 agent 时挂起的队列：任一 agent 就绪（用户开启对话创建根 agent）即续跑派发，
    // 让返工/派发的需求真正重新执行，而不是被「未挂载子 agent」跳过吞掉。
    ctx.on('agent/created', () => {
      maybeResumeAfterAgentAvailable()
    })
    // 永不中断的信号：子 agent 跑完整轮，不因触发它的某个 step 结束而被取消。
    // 三级兜底，保证执行器初始化永远拿得到信号（不再报「未捕获到 AbortSignal」）：
    //   1) 已捕获的真实 AbortSignal 构造器 → AbortSignal.any([])（永不中止）
    //   2) 全局 AbortSignal（宿主 Node 20+ 直接可用时）
    //   3) 鸭子类型永不中断信号：与 AbortSignal.any([]) 语义等价（永不 aborted），
    //      harness 仅消费 aborted/reason/throwIfAborted/addEventListener/removeEventListener
    function makeNeverAbortSignal() {
      if (AbortSignalCtor && typeof AbortSignalCtor.any === 'function') {
        try { return AbortSignalCtor.any([]) } catch (e) { /* fallthrough */ }
      }
      try {
        const g = typeof globalThis !== 'undefined' ? globalThis : null
        if (g && typeof g.AbortSignal === 'function' && typeof g.AbortSignal.any === 'function') {
          return g.AbortSignal.any([])
        }
      } catch (e) { /* fallthrough */ }
      return {
        aborted: false,
        reason: undefined,
        throwIfAborted() {},
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() { return true },
      }
    }

    // ── 内存态（Fork/Resume 通过 fs 尽力持久化） ──
    const requirements = {}
    const backlog = []
    const execQueue = []
    let seqCounter = 0
    let lastWorkdir = null // 上次绑定的工作目录（新建需求时默认值）
    let pumpTimer = null

    function nextId() {
      seqCounter += 1
      return 'RQ-' + Date.now().toString(36).toUpperCase() + '-' + seqCounter
    }

    function normalizeScheduledAt(value) {
      if (value === undefined) return undefined
      if (value === null || value === '') return null
      if (typeof value === 'number' && Number.isFinite(value)) return value > 0 ? value : null
      if (typeof value === 'string') {
        const text = value.trim()
        if (!text) return null
        const ms = Date.parse(text)
        return Number.isFinite(ms) ? ms : null
      }
      return null
    }

    function formatScheduledAt(value) {
      return value ? new Date(value).toLocaleString() : '立即执行'
    }

    function trimPath(value) {
      return typeof value === 'string' ? value.trim().replace(/\/+$/, '') : ''
    }

    function normalizePanelWorkdir(value) {
      const text = trimPath(value)
      if (!text) return null
      return text.replace(/(\/dsh-task-panel)+$/, '/dsh-task-panel')
    }

    function panelProjectDirFrom(baseDir) {
      const base = normalizePanelWorkdir(baseDir)
      if (!base) return null
      return base.endsWith('/dsh-task-panel') ? base : base + '/dsh-task-panel'
    }

    function isErrorStopReason(stopReason) {
      if (!stopReason) return false
      return !['completed', 'stop', 'end_turn', 'done'].includes(String(stopReason))
    }

    function stopReasonDiagnostic(label, stopReason, hasOutput) {
      return label + '以 stopReason=' + stopReason + ' 结束' + (hasOutput ? '。' : '，未返回可用输出。')
    }

    function addEvent(req, type, message, meta) {
      if (!req) return
      req.events = Array.isArray(req.events) ? req.events : []
      req.events.push({
        type,
        message: String(message || ''),
        at: Date.now(),
        meta: meta && typeof meta === 'object' ? meta : null,
      })
      if (req.events.length > 120) req.events = req.events.slice(-120)
    }

    function ensureRequirementShape(req) {
      if (!req || typeof req !== 'object') return req
      if (typeof req.workdir === 'string' && req.workdir.trim()) req.workdir = normalizePanelWorkdir(req.workdir)
      req.autoReview = req.autoReview === false ? false : true
      req.contextAnchors = Array.isArray(req.contextAnchors) ? req.contextAnchors.map(normalizeContextAnchor).filter(Boolean).slice(0, 8) : []
      req.executions = Array.isArray(req.executions) ? req.executions : []
      for (const exec of req.executions) {
        if (!exec || typeof exec !== 'object') continue
        if (isErrorStopReason(exec.stopReason)) {
          const diagnostic = stopReasonDiagnostic('子 agent ', exec.stopReason, !!exec.summary && !/^执行完成（stopReason=/.test(exec.summary))
          exec.done = false
          if (!exec.summary || /^执行完成（stopReason=/.test(exec.summary)) exec.summary = '执行失败：' + diagnostic
          if (!exec.blocker) exec.blocker = diagnostic
        }
      }
      req.reviews = Array.isArray(req.reviews) ? req.reviews : []
      for (const review of req.reviews) {
        if (!review || typeof review !== 'object') continue
        if (isErrorStopReason(review.stopReason)) {
          const diagnostic = stopReasonDiagnostic('复核子 agent ', review.stopReason, !!review.verdict)
          review.passed = false
          if (!review.verdict) review.verdict = '自动复核失败：' + diagnostic
          if (!Array.isArray(review.issues) || !review.issues.length) review.issues = [diagnostic]
        }
      }
      req.acceptances = Array.isArray(req.acceptances) ? req.acceptances : []
      req.events = Array.isArray(req.events) ? req.events : []
      return req
    }

    function normalizeContextAnchor(anchor) {
      if (!anchor || typeof anchor !== 'object') return null
      const sessionId = String(anchor.sessionId || anchor.id || '').trim()
      if (!sessionId) return null
      return {
        sessionId,
        title: String(anchor.title || anchor.name || '').trim().slice(0, 160),
        snippet: String(anchor.snippet || anchor.summary || '').trim().slice(0, 800),
        cwd: String(anchor.cwd || '').trim().slice(0, 260),
        parentSessionId: anchor.parentSessionId ? String(anchor.parentSessionId) : null,
        matchedAt: typeof anchor.matchedAt === 'number' ? anchor.matchedAt : Date.now(),
        source: anchor.source === 'manual' ? 'manual' : 'search',
      }
    }

    function contextQueryFrom(input) {
      const text = [
        input && input.title,
        input && input.description,
        Array.isArray(input && input.scope) ? input.scope.join(' ') : '',
      ].map((x) => String(x || '').trim()).filter(Boolean).join(' ')
      return text.slice(0, 240)
    }

    function clipText(value, max) {
      const text = String(value || '').trim()
      if (!text || text.length <= max) return text
      return text.slice(0, Math.max(0, max - 1)) + '…'
    }

    function contextAnchorFromHit(hit) {
      if (!hit || !hit.header) return null
      return normalizeContextAnchor({
        sessionId: hit.header.id,
        title: hit.header.title || '',
        snippet: hit.bestMatch && hit.bestMatch.snippet ? hit.bestMatch.snippet : '',
        cwd: hit.header.cwd || '',
        parentSessionId: hit.header.parentSession || null,
        source: 'search',
      })
    }

    async function suggestContextSessions(input, limit) {
      const query = contextQueryFrom(input || {})
      if (!query || !sessionQuery || typeof sessionQuery.searchSessions !== 'function') return []
      try {
        const page = await sessionQuery.searchSessions({
          query,
          eventFilters: [
            { kind: 'type', values: ['user/message', 'assistant/message'] },
            { kind: 'surface', values: ['current'] },
          ],
          limit: limit || 6,
        })
        const items = page && Array.isArray(page.items) ? page.items : []
        const seen = new Set()
        return items.map(contextAnchorFromHit).filter((anchor) => {
          if (!anchor || seen.has(anchor.sessionId)) return false
          seen.add(anchor.sessionId)
          return true
        }).slice(0, limit || 6)
      } catch (e) {
        return []
      }
    }

    async function attachContextAnchors(req, input) {
      if (!req) return req
      const explicit = Array.isArray(input && input.contextAnchors)
        ? input.contextAnchors
        : (Array.isArray(input && input.relatedSessions) ? input.relatedSessions : null)
      if (explicit) {
        req.contextAnchors = explicit.map(normalizeContextAnchor).filter(Boolean).slice(0, 8)
        return req
      }
      req.contextAnchors = await suggestContextSessions(input || req, 3)
      return req
    }

    function schedulePumpAt(timestamp) {
      if (!timestamp || !Number.isFinite(timestamp)) return
      if (pumpTimer) {
        try { clearTimeout(pumpTimer) } catch (e) { /* noop */ }
        pumpTimer = null
      }
      const delay = Math.max(0, Math.min(timestamp - Date.now(), 2147483647))
      pumpTimer = setTimeout(() => {
        pumpTimer = null
        void pump()
      }, delay)
    }

    function nextRunnableQueueIndex() {
      const now = Date.now()
      let nextAt = null
      for (let i = 0; i < execQueue.length; i++) {
        const req = requirements[execQueue[i]]
        if (!req) return { index: i, nextAt }
        const scheduledAt = typeof req.scheduledAt === 'number' ? req.scheduledAt : null
        if (!scheduledAt || scheduledAt <= now) return { index: i, nextAt }
        if (!nextAt || scheduledAt < nextAt) nextAt = scheduledAt
      }
      return { index: -1, nextAt }
    }

    // ── 持久化（best effort：失败只告警，不阻断） ──
    // 数据目录策略：优先需求绑定目录所在项目根（lastWorkdir 即用户指定的持久化目录，
    // 例如 <绑定目录根>），数据落在 <项目根>/.dsh-task-panel/requirements.json；
    // lastWorkdir 未设置时回退根会话项目区 / sandboxPolicy.workspaceRoot（旧位置，含历史数据可迁移）。
    // bundle 是应用级插件：无 session 时 sandboxPolicy.resolve() 的策略根是 process.cwd()
    // （GUI 启动目录），会拒绝写绑定目录；因此解析写盘策略时带上根 agent 的 session，
    // 策略根 = 根会话 cwd（用户实际项目区），绑定目录落盘才被允许（fs 服务按传入 policy 裁决）。
    let dataTarget = null
    let dataBaseDir = null
    let dataTargetPromise = null
    let writePolicy = null // 显式 workspace-write 策略（默认模式是 read-only，必须显式传入 fs.writeText）
    function resolveSessionPolicy() {
      try {
        const root = resolveRootAgent()
        const session = root && root.session
        if (session && session.header && typeof session.header.cwd === 'string' && session.header.cwd) {
          return sandboxPolicy.resolve({ mode: 'workspace-write', session })
        }
      } catch (e) { /* fallthrough */ }
      return sandboxPolicy.resolve({ mode: 'workspace-write' })
    }
    function resolveDataBaseDir() {
      // 1) 需求绑定目录（用户持久化目标，如 <绑定目录根>）
      if (typeof lastWorkdir === 'string' && lastWorkdir.trim()) return normalizePanelWorkdir(lastWorkdir)
      // 2) 根会话项目区 / 部署 workspaceRoot（旧位置，含历史数据）
      try {
        const root = writePolicy && writePolicy.workspaceRoot ? writePolicy.workspaceRoot : (sandboxPolicy ? sandboxPolicy.workspaceRoot : null)
        if (root && typeof root === 'string') return root
      } catch (e) { /* noop */ }
      return null
    }
    function resolveDataTarget() {
      if (dataTarget && dataBaseDir === resolveDataBaseDir()) return Promise.resolve(dataTarget)
      if (dataTargetPromise) return dataTargetPromise
      dataTargetPromise = (async () => {
        try {
          if (!fs || !sandboxPolicy) {
            persistDiag = 'fs=' + !!fs + ' sandboxPolicy=' + !!sandboxPolicy + '（fs 或 sandboxPolicy 不可用）'
            return null
          }
          writePolicy = resolveSessionPolicy()
          const base = resolveDataBaseDir()
          if (!base) {
            persistDiag = '数据目录解析为空（无 lastWorkdir / workspaceRoot）'
            return null
          }
          const target = await fs.resolve(base + '/.dsh-task-panel/requirements.json')
          dataTarget = target
          dataBaseDir = base
          persistDiag = 'ok -> ' + base + '/.dsh-task-panel/requirements.json'
          return target
        } catch (e) {
          persistDiag = 'resolve failed: ' + (e && e.message ? e.message : String(e))
          console.error('resolve data target failed', e)
          return null
        }
      })()
      return dataTargetPromise
    }

    async function loadState() {
      try {
        // 候选数据源（顺序探测，读到即用）：
        //   1) 用户指定的持久化目录（绑定目录所在项目根）
        //   2) 面板项目目录 <根agent cwd>/dsh-task-panel/.dsh-task-panel（bundle 时代面板数据位置）
        //   3) 部署 workspaceRoot/.dsh-task-panel（最旧位置，含历史数据可迁移）
        let text = null
        let fromOld = false
        const candidates = []
        // 优先：用户明确指定的持久化目录（需求绑定目录根，代码内可配置）
        if (typeof lastWorkdir === 'string' && lastWorkdir.trim()) {
          candidates.push(normalizePanelWorkdir(lastWorkdir) + '/.dsh-task-panel/requirements.json')
        }
        try {
          const root = resolveRootAgent()
          const rcwd = root && root.session && root.session.header ? root.session.header.cwd : null
          if (rcwd && typeof rcwd === 'string' && rcwd.length > 4) {
            candidates.push(panelProjectDirFrom(rcwd) + '/.dsh-task-panel/requirements.json')
          }
        } catch (e) { /* noop */ }
        try {
          const oldBase = writePolicy && writePolicy.workspaceRoot ? writePolicy.workspaceRoot : (sandboxPolicy ? sandboxPolicy.workspaceRoot : null)
          if (oldBase) candidates.push(oldBase + '/.dsh-task-panel/requirements.json')
        } catch (e) { /* noop */ }
        for (const cand of candidates) {
          try {
            const t = await fs.resolve(cand)
            text = await fs.readText(t)
            if (text) break
          } catch (e) { /* 该候选无数据 */ }
        }
        if (!text) return
        // 解析 lastWorkdir → 更新内存 + 迁移到绑定目录根
        let parsed
        try { parsed = JSON.parse(text) } catch (e) { return }
        if (parsed && typeof parsed.lastWorkdir === 'string' && parsed.lastWorkdir) {
          lastWorkdir = normalizePanelWorkdir(parsed.lastWorkdir)
          if (lastWorkdir !== resolveDataBaseDir()) {
            // lastWorkdir 已存在且目标变了 → 迁移到新位置
            dataTarget = null
            dataBaseDir = null
            dataTargetPromise = null
            const newTarget = await resolveDataTarget()
            if (newTarget) {
              try { await fs.writeText(newTarget, text, undefined, undefined, resolveSessionPolicy()); fromOld = true } catch (e) { /* noop */ }
            }
          }
        }
        // 载入最终数据（迁移后新位置；未迁移则原位置）
        const finalText = fromOld ? text : (await fs.readText(await resolveDataTarget()))
        const final = JSON.parse(finalText)
        if (!final || typeof final !== 'object') return
        if (final.requirements && typeof final.requirements === 'object') {
          for (const k of Object.keys(final.requirements)) requirements[k] = ensureRequirementShape(final.requirements[k])
        }
        if (Array.isArray(final.backlog)) { backlog.length = 0; backlog.push(...final.backlog) }
        if (Array.isArray(final.execQueue)) { execQueue.length = 0; execQueue.push(...final.execQueue) }
        if (typeof final.lastWorkdir === 'string' && final.lastWorkdir) lastWorkdir = normalizePanelWorkdir(final.lastWorkdir)
      } catch (e) { /* 首次运行没有数据 */ }
    }

    function persistState() {
      const p = (async () => {
        try {
          const target = await resolveDataTarget()
          if (!target) return
          // 每次写盘重新解析 session 化策略：启动时根 agent 可能尚未就绪，
          // resolveDataTarget 缓存的 writePolicy 可能是无 session 的部署根策略
          // （写绑定目录会被拒）；此刻根 agent 已就绪，必须用新策略写。
          await fs.writeText(target, JSON.stringify({ requirements, backlog, execQueue, lastWorkdir }), undefined, undefined, resolveSessionPolicy())
          persistDiag = 'written'
        } catch (e) {
          // 兜底：绑定目录不可写（如 lastWorkdir 超出根会话 cwd）时，
          // 回退写部署根（process.cwd()/.dsh-task-panel），保证持久化永不失效。
          try {
            const fallbackRoot = sandboxPolicy && sandboxPolicy.workspaceRoot ? sandboxPolicy.workspaceRoot : null
            if (fallbackRoot) {
              const fb = await fs.resolve(fallbackRoot + '/.dsh-task-panel/requirements.json')
              await fs.writeText(fb, JSON.stringify({ requirements, backlog, execQueue, lastWorkdir }), undefined, undefined, sandboxPolicy.resolve({ mode: 'workspace-write' }))
              persistDiag = 'written(fallback ' + fallbackRoot + ')'
            } else {
              persistDiag = 'write failed: ' + (e && e.message ? e.message : String(e))
            }
          } catch (e2) {
            persistDiag = 'write failed: ' + (e && e.message ? e.message : String(e))
            console.error('persist failed', e)
          }
        }
      })()
      // 不让写盘失败影响主流程
      p.catch(() => {})
    }

    // ── 需求层 ───────────────────────────────────────────
    function decomposeElements(input) {
      const desc = (input.description || '') + ' ' + (input.title || '')
      const cats = []
      if (/api|接口|http|rest|后端|服务|endpoint/i.test(desc)) cats.push('api')
      if (/ui|界面|页面|前端|组件|web|交互/i.test(desc)) cats.push('ui')
      if (/test|测试|单测|集成|用例/i.test(desc)) cats.push('test')
      if (/config|配置|环境/i.test(desc)) cats.push('config')
      if (cats.length === 0) cats.push('feature')
      return cats.map((c, i) => ({
        id: 'E' + (i + 1),
        category: c,
        description: c + '：' + (input.title || '') + ' 的实现',
        scope: (input.scope || []).slice(),
      }))
    }

    function generateAcceptance(input, elements) {
      const list = [{ id: 'A1', category: 'functional', description: '核心功能实现并通过自检', autoCheckable: true }]
      if (elements.some((e) => e.category === 'test')) {
        list.push({ id: 'A2', category: 'test', description: '单元/集成测试通过', autoCheckable: true })
      }
      list.push({ id: 'A3', category: 'code_quality', description: '代码规范与可读性达标', autoCheckable: true })
      list.push({ id: 'A4', category: 'user_confirmation', description: '用户验收确认', autoCheckable: false })
      return list
    }

    function create(input) {
      const elements = decomposeElements(input)
      const acceptanceCriteria =
        input.acceptanceCriteria && input.acceptanceCriteria.length
          ? input.acceptanceCriteria
          : generateAcceptance(input, elements)
      const req = {
        id: nextId(),
        title: String(input.title || '').trim(),
        description: String(input.description || ''),
        priority: ['critical', 'high', 'medium', 'low'].includes(input.priority) ? input.priority : 'medium',
        stage: 'backlog',
        // 需求绑定的工作目录（子 agent 在该目录下执行；未绑定则用面板默认目录）
        workdir: typeof input.workdir === 'string' && input.workdir.trim() ? normalizePanelWorkdir(input.workdir) : (normalizePanelWorkdir(lastWorkdir) || null),
        elements,
        scope: (input.scope || []).slice(),
        dependencies: (input.dependencies || []).slice(),
        acceptanceCriteria,
        contextAnchors: Array.isArray(input.contextAnchors) ? input.contextAnchors.map(normalizeContextAnchor).filter(Boolean).slice(0, 8) : [],
        executions: [],
        reviews: [],
        acceptances: [],
        events: [],
        reworkCount: 0,
        reworkReason: null,
        scheduledAt: normalizeScheduledAt(input.scheduledAt) ?? null,
        autoReview: input.autoReview === false ? false : true,
        createdBy: input.createdBy === 'agent' ? 'agent' : 'user',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        version: 1,
        command: input.command ? String(input.command) : null,
      }
      // 记住本次绑定的目录，下次新建默认沿用
      if (req.workdir && req.workdir !== lastWorkdir) {
        lastWorkdir = req.workdir
        persistState()
      }
      requirements[req.id] = req
      if (backlog.indexOf(req.id) < 0) backlog.push(req.id)
      addEvent(req, 'created', '需求已创建')
      persistState()
      return req
    }

    function get(id) {
      return requirements[id] || null
    }

    function update(id, patch) {
      const req = requirements[id]
      if (!req) throw new Error('需求不存在: ' + id)
      const allowed = ['title', 'description', 'priority', 'scope', 'dependencies', 'command', 'acceptanceCriteria', 'workdir']
      for (const k of allowed) {
        if (Object.prototype.hasOwnProperty.call(patch, k) && patch[k] !== undefined) req[k] = patch[k]
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'contextAnchors')) {
        req.contextAnchors = Array.isArray(patch.contextAnchors) ? patch.contextAnchors.map(normalizeContextAnchor).filter(Boolean).slice(0, 8) : []
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'scheduledAt')) {
        req.scheduledAt = normalizeScheduledAt(patch.scheduledAt)
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'autoReview')) {
        req.autoReview = patch.autoReview === false ? false : true
      }
      if (typeof req.title === 'string') req.title = req.title.trim()
      if (typeof req.workdir === 'string' && req.workdir.trim()) {
        req.workdir = normalizePanelWorkdir(req.workdir)
        if (req.workdir !== lastWorkdir) { lastWorkdir = req.workdir; persistState() }
      }
      req.updatedAt = Date.now()
      req.version = (req.version || 0) + 1
      persistState()
      void pump()
      return req
    }

    function remove(id) {
      if (!requirements[id]) return false
      const bi = backlog.indexOf(id)
      if (bi >= 0) backlog.splice(bi, 1)
      const ei = execQueue.indexOf(id)
      if (ei >= 0) execQueue.splice(ei, 1)
      delete requirements[id]
      persistState()
      return true
    }

    // ── 双队列调度 ─────────────────────────────────────
    function dispatchToExec(id, options) {
      const req = requirements[id]
      if (!req) throw new Error('需求不存在: ' + id)
      if (options && Object.prototype.hasOwnProperty.call(options, 'scheduledAt')) {
        req.scheduledAt = normalizeScheduledAt(options.scheduledAt)
      }
      const bi = backlog.indexOf(id)
      if (bi >= 0) backlog.splice(bi, 1)
      if (
        execQueue.indexOf(id) < 0 &&
        req.stage !== 'executing' &&
        req.stage !== 'reviewing' &&
        req.stage !== 'accepting' &&
        req.stage !== 'accepted'
      ) {
        execQueue.push(id)
        req.stage = 'queued'
        req.updatedAt = Date.now()
        addEvent(req, 'dispatched', req.scheduledAt ? '已加入执行队列，等待计划时间' : '已加入执行队列')
        persistState()
        void pump()
      }
    }

    function recallFromExec(id) {
      const ei = execQueue.indexOf(id)
      if (ei >= 0) {
        execQueue.splice(ei, 1)
        if (backlog.indexOf(id) < 0) backlog.push(id)
        const req = requirements[id]
        if (req) { req.stage = 'backlog'; req.updatedAt = Date.now(); addEvent(req, 'recalled', '已从执行队列撤回') }
        persistState()
      }
    }

    function moveExecTop(id) {
      const ei = execQueue.indexOf(id)
      if (ei >= 0) { execQueue.splice(ei, 1); execQueue.unshift(id); persistState() }
    }

    function moveExec(id, toIndex) {
      const ei = execQueue.indexOf(id)
      if (ei < 0 || ei === toIndex) return
      execQueue.splice(ei, 1)
      let target = toIndex
      if (ei < toIndex) target = toIndex - 1
      target = Math.max(0, Math.min(target, execQueue.length))
      execQueue.splice(target, 0, id)
      persistState()
    }

    // ── 执行层 ─────────────────────────────────────────
    function startExecution(id) {
      const req = requirements[id]
      if (!req) return
      const round = (req.reworkCount || 0) + 1
      req.executions.push({
        round,
        startedAt: Date.now(),
        completedAt: null,
        summary: '',
        isRework: round > 1,
        reworkReason: req.reworkReason || null,
        sessionId: null,
        parentSessionId: null,
        stopReason: null,
        transcript: [],
      })
      req.stage = 'executing'
      req.scheduledAt = null
      req.updatedAt = Date.now()
      addEvent(req, 'started', '子 agent 开始执行第 ' + round + ' 轮')
      persistState()
    }

    function completeExecution(id, summary, meta) {
      const req = requirements[id]
      if (!req) return
      const exec = req.executions[req.executions.length - 1]
      if (exec) {
        exec.completedAt = Date.now()
        exec.summary = String(summary || '')
        if (meta) {
          exec.sessionId = meta.sessionId || null
          exec.parentSessionId = meta.parentSessionId || null
          exec.stopReason = meta.stopReason || null
          exec.transcript = Array.isArray(meta.transcript) ? meta.transcript : []
          exec.done = meta.done === false ? false : true
          exec.changedFiles = Array.isArray(meta.changedFiles) ? meta.changedFiles : []
          exec.testCommand = typeof meta.testCommand === 'string' ? meta.testCommand : ''
          exec.testResult = typeof meta.testResult === 'string' ? meta.testResult : ''
          exec.blocker = typeof meta.blocker === 'string' ? meta.blocker : ''
        }
      }
      const failed = meta && meta.done === false
      req.stage = meta && (meta.skipReview || failed) ? 'accepting' : 'reviewing'
      req.updatedAt = Date.now()
      addEvent(req, failed ? 'execution-failed' : 'execution-completed',
        failed ? '执行未正常完成，已进入待验收'
          : ((meta && meta.skipReview) ? '执行完成，已进入待验收' : '执行完成，进入自动复核'), {
        sessionId: meta && meta.sessionId ? meta.sessionId : null,
      })
      persistState()
    }

    function startReview(id) {
      const req = requirements[id]
      if (!req) return
      const round = (req.reworkCount || 0) + 1
      req.reviews = Array.isArray(req.reviews) ? req.reviews : []
      req.reviews.push({
        round,
        startedAt: Date.now(),
        completedAt: null,
        passed: null,
        verdict: '',
        issues: [],
        suggestions: [],
        sessionId: null,
        parentSessionId: null,
        stopReason: null,
        transcript: [],
      })
      req.stage = 'reviewing'
      req.updatedAt = Date.now()
      addEvent(req, 'review-started', '自动复核开始')
      persistState()
    }

    function completeReview(id, review, meta) {
      const req = requirements[id]
      if (!req) return
      const rec = req.reviews && req.reviews[req.reviews.length - 1]
      if (rec) {
        rec.completedAt = Date.now()
        rec.passed = review && review.passed === true
        rec.verdict = String(review && review.verdict ? review.verdict : '')
        rec.issues = Array.isArray(review && review.issues) ? review.issues : []
        rec.suggestions = Array.isArray(review && review.suggestions) ? review.suggestions : []
        if (meta) {
          rec.sessionId = meta.sessionId || null
          rec.parentSessionId = meta.parentSessionId || null
          rec.stopReason = meta.stopReason || null
          rec.transcript = Array.isArray(meta.transcript) ? meta.transcript : []
        }
      }
      req.stage = 'accepting'
      req.updatedAt = Date.now()
      addEvent(req, 'review-completed', rec && rec.passed ? '自动复核通过，等待验收' : '自动复核发现问题，等待验收决策', {
        issueCount: rec && rec.issues ? rec.issues.length : 0,
      })
      persistState()
    }

    // ── 验收层 ─────────────────────────────────────────
    function submitAcceptance(id, record) {
      const req = requirements[id]
      if (!req) throw new Error('需求不存在: ' + id)
      const round = (req.reworkCount || 0) + 1
      const rec = {
        round,
        overall: record.overall === 'passed' ? 'passed' : 'failed',
        agentSummary: String(record.agentSummary || ''),
        userConfirmed: !!record.userConfirmed,
        failedItems: Array.isArray(record.failedItems) ? record.failedItems : [],
        reworkSuggestion: String(record.reworkSuggestion || ''),
        timestamp: Date.now(),
      }
      req.acceptances.push(rec)
      if (rec.overall === 'passed') {
        req.stage = 'accepted'
        addEvent(req, 'accepted', '验收通过')
      } else {
        const reason = rec.reworkSuggestion || rec.failedItems.join(', ') || '验收未通过'
        const next = (req.reworkCount || 0) + 1
        req.reworkCount = next
        req.reworkReason = reason
        if (next < MAX_REWORK) {
          req.stage = 'queued'
          if (execQueue.indexOf(id) < 0) execQueue.push(id)
          addEvent(req, 'rework', '验收未通过，已重新入队返工：' + reason)
        } else {
          // 返工达上限 → 退回需求队列防死循环
          req.stage = 'backlog'
          const bi = execQueue.indexOf(id)
          if (bi >= 0) execQueue.splice(bi, 1)
          if (backlog.indexOf(id) < 0) backlog.push(id)
          addEvent(req, 'rework-limit', '返工达到上限，已退回需求队列：' + reason)
        }
      }
      req.updatedAt = Date.now()
      persistState()
      if (rec.overall !== 'passed') void pump()
      return req
    }

    // ── 队列派发器：串行子 session 执行 ───────────────
    let busy = false
    const runningRuns = new Map() // requirementId -> SubagentRun（可定向暂停/停止）
    const userStopped = new Set() // 被用户暂停/停止的需求 id
    const stopTargets = new Map() // 需求 id -> 'paused' | 'backlog'

    // ── 无可用父级 agent 时挂起等待（修复：返工/派发不再被「未挂载子 agent」跳过吞任务）──
    // roots/list/initiator 均为空（用户尚未开启任何对话）时，不吞任务、不伪造执行：
    // 需求放回队首保持 queued，等 agent 就绪后自动真正执行。
    let waitingForAgent = false
    function deferExecutionForAgent(id) {
      const req = requirements[id]
      if (!req) return
      req.stage = 'queued'
      if (execQueue.indexOf(id) < 0) execQueue.unshift(id) // 放回队首，保持原排队次序
      req.updatedAt = Date.now()
      addEvent(req, 'deferred', '暂无可用 agent 会话，已放回执行队列；开启对话后将自动继续执行')
      waitingForAgent = true
      persistState()
    }
    function maybeResumeAfterAgentAvailable() {
      if (!waitingForAgent || busy) return
      if (!resolveRootAgent()) return
      waitingForAgent = false
      void pump()
    }

    // 当前会话的根 agent（作为面板专用 agent 的装配来源与兜底父级）
    function resolveRootAgent() {
      try { const roots = agents.roots(); if (roots && roots.length) return roots[0] } catch (e) { /* noop */ }
      try { const list = agents.list(); if (list && list.length) return list[0] } catch (e) { /* noop */ }
      try { const init = agents.currentInitiator(); if (init) return init } catch (e) { /* noop */ }
      return null
    }

    // ── 面板专用主 agent（懒创建，供所有执行器复用为父级） ──
    // 之前裸 agents.create 的面板 agent 缺 {{model}} 等装配导致执行器起不来；
    // 正解：创建时在 setup(agentCtx) 里调 agentPresets.composeFrom(agentCtx, 根agent.ctx)，
    // 让面板 agent 继承根 agent 的完整装配（模型、工具、prompt 段落），同时拥有独立 session 与 cwd。
    let panelAgent = null
    let panelHandle = null
    let panelDiag = 'not-created'
    let panelCreating = null
    async function ensurePanelAgent() {
      if (panelAgent) return panelAgent
      if (panelCreating) return panelCreating
      const root = resolveRootAgent()
      if (!root) { panelDiag = 'no-root-agent'; return null }
      panelCreating = (async () => {
        try {
          // 面板专属工作目录：优先用最近绑定的需求目录所在项目，否则 <根agent cwd>/dsh-task-panel
          const rootCwd = root.session && root.session.header ? root.session.header.cwd : null
          const baseDir = rootCwd && typeof rootCwd === 'string' ? rootCwd : (sandboxPolicy ? sandboxPolicy.workspaceRoot : null)
          const panelCwd = panelProjectDirFrom(baseDir)
          // 继承根 agent 的模型选择，确保 {{model}} 有值
          const agentOptions = {}
          try {
            const sel = agentDefaultModel ? agentDefaultModel.currentSelection() : null
            if (sel) {
              if (sel.provider) agentOptions.provider = sel.provider
              if (sel.model) agentOptions.model = sel.model
            }
          } catch (e) { panelDiag = 'model:' + (e && e.message ? e.message : String(e)) }
          const sessionId = 'dsh-task-panel-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 36).toString(36)
          const handle = await agents.create({
            sessionId,
            meta: { cwd: panelCwd, origin: 'subagent', agentPreset: 'default' },
            agentOptions,
            // 关键：继承根 agent 的 standing composition（含 {{model}} 变量、工具、persona）
            setup: (agentCtx) => {
              if (agentPresets && typeof agentPresets.composeFrom === 'function') {
                agentPresets.composeFrom(agentCtx, root.ctx)
              }
            },
          })
          panelHandle = handle
          panelAgent = handle.agent
          panelDiag = 'created ' + sessionId + ' cwd=' + (panelCwd || 'none') + ' model=' + (agentOptions.model || '-')
          return panelAgent
        } catch (e) {
          panelDiag = 'create failed: ' + (e && e.message ? e.message : String(e))
          console.error('ensurePanelAgent failed', e)
          return null
        } finally {
          panelCreating = null
        }
      })()
      return panelCreating
    }

    // 执行器父级：面板专用 agent（创建失败时兜底回根 agent，保证任务仍可执行）
    async function resolveParent() {
      try {
        const panel = await ensurePanelAgent()
        if (panel) return panel
      } catch (e) { /* fallthrough */ }
      return resolveRootAgent()
    }

    function resolveProvider() {
      try {
        const names = subagents.list() || []
        for (const p of ['fork', 'spawn', 'acp']) if (names.includes(p)) return p
        return names[0] || 'fork'
      } catch (e) { return 'fork' }
    }

    // ── 任务面板自有的专用执行目录（不在别的项目下跑子任务） ──
    async function resolvePanelExecDir() {
      try {
        const parent = await resolveParent()
        const sessionCwd = parent && parent.session && parent.session.header
          ? parent.session.header.cwd : null
        if (!sessionCwd || typeof sessionCwd !== 'string') return null
        // 面板自己的项目目录：若父级已经在 dsh-task-panel 内，直接复用，避免拼成双层目录。
        const candidate = panelProjectDirFrom(sessionCwd)
        if (fs) {
          try {
            const t = await fs.resolve(candidate)
            const info = await fs.stat(t)
            if (info) return candidate
          } catch (e) { /* 目录不存在则回退 */ }
        }
        return candidate
      } catch (e) { return null }
    }

    // 用户暂停/停止执行中的任务：中断子 agent，目标 paused（可恢复）或 backlog（退回需求队列）
    function stopExecution(id, target) {
      const run = runningRuns.get(id)
      if (!run) return false
      userStopped.add(id)
      stopTargets.set(id, target === 'paused' ? 'paused' : 'backlog')
      try { void run.dispose().catch(() => {}) } catch (e) { /* noop */ }
      return true
    }

    // 恢复已暂停的任务 → 重入执行队列
    function resumeExecution(id) {
      const req = requirements[id]
      if (!req || req.stage !== 'paused') return false
      req.stage = 'queued'
      if (execQueue.indexOf(id) < 0) execQueue.push(id)
      req.updatedAt = Date.now()
      persistState()
      void pump()
      return true
    }

    function buildPrompt(req, execDir) {
      // 工作目录优先级：需求绑定 workdir > 面板默认执行目录
      const workdir = (req.workdir && typeof req.workdir === 'string' && req.workdir.trim())
        ? normalizePanelWorkdir(req.workdir)
        : (execDir || null)
      const anchors = Array.isArray(req.contextAnchors) ? req.contextAnchors : []
      const anchorLines = anchors.length
        ? ['关联历史会话（可作为上下文参考，必要时按 sessionId 打开/查询原会话）：'].concat(anchors.map((a, i) =>
            '[' + (i + 1) + '] sessionId=' + a.sessionId +
            (a.title ? ' 标题=' + a.title : '') +
            (a.cwd ? ' cwd=' + a.cwd : '') +
            (a.snippet ? '\n    摘要片段：' + a.snippet : ''),
          ))
        : []
      const lines = [
        '请执行需求 #' + req.id + '「' + req.title + '」。',
        workdir ? '工作目录（请在此目录内完成所有文件操作，先 cd 到该目录）：' + workdir : '',
        req.scheduledAt ? '计划执行时间：' + formatScheduledAt(req.scheduledAt) + '（当前已到点，开始执行）' : '',
        req.description ? '描述：' + req.description : '',
        '优先级：' + req.priority,
        req.scope && req.scope.length ? '涉及范围：' + req.scope.join(', ') : '',
        ...anchorLines,
        '构成要素：' + req.elements.map((e) => e.description).join('；'),
        '验收要素：' + req.acceptanceCriteria.map((a) => '[' + a.id + '] ' + a.description).join('；'),
        req.command ? '如需验证请运行命令：' + req.command : '',
        req.reworkCount > 0 && req.reworkReason
          ? '这是第 ' + (req.reworkCount + 1) + ' 轮执行，请针对返工原因修复：' + req.reworkReason
          : '',
        '请在你的会话中实际完成该需求（读代码、修改文件、运行测试等）。',
        '最后按结构化结果输出：done、summary（一句话产物）、changedFiles、testCommand、testResult、blocker。',
      ]
      return lines.filter(Boolean).join('\n')
    }

    function buildReviewPrompt(req) {
      const exec = (req.executions || [])[req.executions.length - 1] || {}
      const changedFiles = Array.isArray(exec.changedFiles) ? exec.changedFiles.filter(Boolean) : []
      const visibleFiles = changedFiles.slice(0, 20)
      const lines = [
        '请复核需求 #' + req.id + '「' + req.title + '」。',
        req.description ? '描述：' + clipText(req.description, 600) : '',
        '验收要素：' + req.acceptanceCriteria.map((a) => '[' + a.id + '] ' + a.description).join('；'),
        req.scope && req.scope.length ? '涉及范围：' + req.scope.join(', ') : '',
        req.workdir ? '工作目录：' + req.workdir : '',
        '参考产物（压缩）：' + (clipText(exec.summary, 280) || '（无）'),
        visibleFiles.length ? '改动文件（最多列出前20个）：' + visibleFiles.join(', ') + (changedFiles.length > visibleFiles.length ? '，等 ' + changedFiles.length + ' 个' : '') : '',
        exec.testCommand ? '验证命令：' + exec.testCommand : '',
        exec.testResult ? '验证结果（压缩）：' + clipText(exec.testResult, 500) : '',
        exec.blocker ? '执行阻塞（压缩）：' + clipText(exec.blocker, 240) : '',
        '请对照验收要素、代码质量、测试证据和潜在遗漏做复核。参考产物只作为摘要；需要细节时优先查看改动文件或对应执行会话。不要修改文件，只做检查。',
        '最后按结构化结果输出：passed、verdict、issues、suggestions。',
      ]
      return lines.filter(Boolean).join('\n')
    }

    function structuredOf(result) {
      return result && result.structured && typeof result.structured === 'object' ? result.structured : null
    }

    function normalizedExecutionResult(result) {
      const s = structuredOf(result) || {}
      const fallback = extractText(result && result.output)
      const stopReason = result && result.stopReason ? String(result.stopReason) : ''
      const stoppedWithError = isErrorStopReason(stopReason)
      const diagnostic = stopReason
        ? stopReasonDiagnostic('子 agent ', stopReason, !!fallback)
        : '子 agent 未返回结构化执行结果。'
      return {
        done: stoppedWithError ? false : (s.done === false ? false : true),
        summary: String(s.summary || fallback || (stoppedWithError ? '执行失败：' + diagnostic : '执行完成')),
        changedFiles: Array.isArray(s.changedFiles) ? s.changedFiles.map((x) => String(x)).filter(Boolean).slice(0, 80) : [],
        testCommand: String(s.testCommand || ''),
        testResult: String(s.testResult || ''),
        blocker: String(s.blocker || (stoppedWithError ? diagnostic : '')),
      }
    }

    function normalizedReviewResult(result) {
      const s = structuredOf(result) || {}
      const fallback = extractText(result && result.output)
      const stopReason = result && result.stopReason ? String(result.stopReason) : ''
      const stoppedWithError = isErrorStopReason(stopReason)
      const diagnostic = stopReason
        ? stopReasonDiagnostic('复核子 agent ', stopReason, !!fallback)
        : '复核子 agent 未返回结构化结果。'
      return {
        passed: stoppedWithError ? false : s.passed === true,
        verdict: String(s.verdict || fallback || (stoppedWithError ? '自动复核失败：' + diagnostic : '')),
        issues: Array.isArray(s.issues) ? s.issues.map((x) => String(x)).filter(Boolean).slice(0, 50) : (stoppedWithError ? [diagnostic] : []),
        suggestions: Array.isArray(s.suggestions) ? s.suggestions.map((x) => String(x)).filter(Boolean).slice(0, 50) : (stoppedWithError ? ['查看复核子会话或重新执行该需求。'] : []),
      }
    }

    function extractText(blocks) {
      if (!Array.isArray(blocks)) return ''
      return blocks
        .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text)
        .join('\n')
        .slice(0, 4000)
    }

    async function captureTranscript(sessionId) {
      if (!sessionQuery || !sessionId) return []
      try {
        const snap = await sessionQuery.readSession(sessionId)
        const events = snap && Array.isArray(snap.events) ? snap.events : []
        const out = []
        for (const ev of events) {
          if (!ev || !ev.type) continue
          const time = typeof ev.time === 'number' ? ev.time : Date.now()
          if (ev.type === 'user/message' && ev.data && Array.isArray(ev.data.content)) {
            const text = extractText(ev.data.content)
            if (text) out.push({ role: 'user', text: text.slice(0, 2000), time })
          } else if (ev.type === 'assistant/message' && ev.data && ev.data.message && Array.isArray(ev.data.message.content)) {
            const text = extractText(ev.data.message.content)
            if (text) out.push({ role: 'assistant', text: text.slice(0, 4000), time })
          } else if (ev.type === 'tool/call' && ev.data) {
            out.push({ role: 'tool', text: '调用工具 ' + ev.data.name + ' ' + String(ev.data.arguments || '').slice(0, 500), time })
          }
        }
        return out.slice(-300)
      } catch (e) {
        return []
      }
    }

    async function runReview(id, parent) {
      const req = requirements[id]
      if (!req || req.stage !== 'reviewing') return
      startReview(id)
      if (!parent || !subagents) {
        completeReview(id, {
          passed: true,
          verdict: '未挂载子 agent 复核能力，已跳过自动复核。',
          issues: [],
          suggestions: ['请人工验收执行产物。'],
        }, { stopReason: 'no-subagent' })
        return
      }
      const signal = makeNeverAbortSignal()
      const provider = resolveProvider()
      const run = await subagents.start(provider, {
        label: '复核 ' + id + ' ' + req.title,
        prompt: [{ type: 'text', text: buildReviewPrompt(req) }],
        parent: parent,
        signal: signal,
        toolFilter: { deny: EXEC_DENY_TOOLS },
        outputSchema: REVIEW_OUTPUT_SCHEMA,
      })
      runningRuns.set(id, run)
      const curReview = req.reviews[req.reviews.length - 1]
      if (curReview && !curReview.sessionId) {
        curReview.sessionId = run && run.id ? run.id : null
        curReview.parentSessionId = parent && parent.session ? parent.session.id : null
        persistState()
      }
      let result
      try {
        result = await run.result
      } finally {
        runningRuns.delete(id)
      }
      if (userStopped.has(id)) {
        userStopped.delete(id)
        const target = stopTargets.get(id) || 'backlog'
        stopTargets.delete(id)
        const review = req.reviews[req.reviews.length - 1]
        if (review) {
          review.completedAt = Date.now()
          review.sessionId = run && run.id ? run.id : null
          review.parentSessionId = parent && parent.session ? parent.session.id : null
          review.stopReason = 'user-stopped'
          review.verdict = target === 'paused' ? '已暂停：用户中断复核，等待恢复' : '已停止：用户终止复核'
        }
        req.stage = target
        if (target === 'backlog' && backlog.indexOf(id) < 0) backlog.push(id)
        req.updatedAt = Date.now()
        addEvent(req, target === 'paused' ? 'paused' : 'stopped', target === 'paused' ? '自动复核已暂停' : '自动复核已停止')
        persistState()
        return
      }
      const sessionId = run && run.id ? run.id : null
      const transcript = await captureTranscript(sessionId)
      try { if (run && typeof run.dispose === 'function') await run.dispose() } catch (e) { /* noop */ }
      completeReview(id, normalizedReviewResult(result), {
        sessionId,
        parentSessionId: parent && parent.session ? parent.session.id : null,
        stopReason: result && result.stopReason,
        transcript,
      })
    }

    async function pump() {
      if (busy) return
      if (execQueue.length === 0) return
      const runnable = nextRunnableQueueIndex()
      if (runnable.index < 0) {
        schedulePumpAt(runnable.nextAt)
        return
      }
      const id = execQueue.splice(runnable.index, 1)[0]
      if (!id || !requirements[id]) {
        persistState()
        void pump()
        return
      }
      const req = requirements[id]
      busy = true
      persistState()
      // 先探测父级 agent 可用性，再开始执行：无 agent 时挂起放回队首。
      // 不进入 try——try 的 finally 会 void pump()，与「放回队列」互相触发形成微任务死循环。
      const parent = await resolveParent()
      if (!parent || !subagents) {
        deferExecutionForAgent(id)
        busy = false
        return
      }
      const execDir = await resolvePanelExecDir()
      try {
        startExecution(id)
        // 永不中断的信号：优先真实 AbortSignal（agent/pre-step / tools/execute 已捕获），
        // 捕获不到时回退鸭子类型信号——执行器初始化不再因缺 AbortSignal 而失败。
        const signal = makeNeverAbortSignal()
        const provider = resolveProvider()
        const run = await subagents.start(provider, {
          label: '执行 ' + id + ' ' + req.title,
          prompt: [{ type: 'text', text: buildPrompt(req, execDir) }],
          parent: parent,
          signal: signal,
          toolFilter: { deny: EXEC_DENY_TOOLS },
          outputSchema: EXECUTION_OUTPUT_SCHEMA,
        })
        runningRuns.set(id, run)
        // 启动后立即回填会话 id（执行中即可实时追踪进度 / 跳转子代理会话）
        const curExec = req.executions[req.executions.length - 1]
        if (curExec && !curExec.sessionId) {
          curExec.sessionId = run && run.id ? run.id : null
          curExec.parentSessionId = parent && parent.session ? parent.session.id : null
          persistState()
        }
        let result
        try {
          result = await run.result
        } finally {
          runningRuns.delete(id)
        }
        // 用户暂停/停止：不进入待验收，按目标状态流转
        if (userStopped.has(id)) {
          userStopped.delete(id)
          const target = stopTargets.get(id) || 'backlog'
          stopTargets.delete(id)
          const exec = req.executions[req.executions.length - 1]
          if (exec) {
            exec.completedAt = Date.now()
            exec.sessionId = run && run.id ? run.id : null
            exec.parentSessionId = parent && parent.session ? parent.session.id : null
            exec.summary = target === 'paused' ? '已暂停：用户中断执行，等待恢复' : '已停止：用户终止执行'
            exec.stopReason = 'user-stopped'
          }
          req.stage = target
          if (target === 'backlog' && backlog.indexOf(id) < 0) backlog.push(id)
          req.updatedAt = Date.now()
          persistState()
        } else {
          const execResult = normalizedExecutionResult(result)
          const sessionId = run && run.id ? run.id : null
          const transcript = await captureTranscript(sessionId)
          try { if (run && typeof run.dispose === 'function') await run.dispose() } catch (e) { /* noop */ }
          await completeExecution(id, execResult.summary, {
            sessionId: sessionId,
            parentSessionId: parent && parent.session ? parent.session.id : null,
            stopReason: result && result.stopReason,
            transcript: transcript,
            done: execResult.done,
            changedFiles: execResult.changedFiles,
            testCommand: execResult.testCommand,
            testResult: execResult.testResult,
            blocker: execResult.blocker,
            skipReview: execResult.done === false || req.autoReview === false,
          })
          if (execResult.done !== false && req.autoReview !== false) {
            try {
              await runReview(id, parent)
            } catch (reviewErr) {
              completeReview(id, {
                passed: false,
                verdict: '自动复核异常：' + (reviewErr && reviewErr.message ? reviewErr.message : String(reviewErr)),
                issues: ['自动复核未能完成，请人工检查执行结果。'],
                suggestions: ['查看执行子会话与改动文件后再验收。'],
              }, { stopReason: 'review-error' })
            }
          }
        }
      } catch (err) {
        await completeExecution(id, '执行异常：' + (err && err.message ? err.message : String(err)), { skipReview: true })
      } finally {
        busy = false
        void pump()
      }
    }

    // ── 对外只读视图（供 RPC / 工具 / 提示词使用；清洗所有字段避免 undefined 泄漏） ──
    function sanitizeExec(ex) {
      if (!ex) return null
      return {
        round: typeof ex.round === 'number' ? ex.round : 0,
        startedAt: typeof ex.startedAt === 'number' ? ex.startedAt : 0,
        completedAt: typeof ex.completedAt === 'number' ? ex.completedAt : null,
        summary: typeof ex.summary === 'string' ? ex.summary : '',
        isRework: !!ex.isRework,
        reworkReason: ex.reworkReason || null,
        sessionId: ex.sessionId || null,
        parentSessionId: ex.parentSessionId || null,
        stopReason: ex.stopReason || null,
        transcript: Array.isArray(ex.transcript) ? ex.transcript : [],
        done: ex.done === false ? false : true,
        changedFiles: Array.isArray(ex.changedFiles) ? ex.changedFiles : [],
        testCommand: typeof ex.testCommand === 'string' ? ex.testCommand : '',
        testResult: typeof ex.testResult === 'string' ? ex.testResult : '',
        blocker: typeof ex.blocker === 'string' ? ex.blocker : '',
      }
    }

    function sanitizeReview(review) {
      if (!review) return null
      return {
        round: typeof review.round === 'number' ? review.round : 0,
        startedAt: typeof review.startedAt === 'number' ? review.startedAt : 0,
        completedAt: typeof review.completedAt === 'number' ? review.completedAt : null,
        passed: review.passed === true,
        verdict: typeof review.verdict === 'string' ? review.verdict : '',
        issues: Array.isArray(review.issues) ? review.issues : [],
        suggestions: Array.isArray(review.suggestions) ? review.suggestions : [],
        sessionId: review.sessionId || null,
        parentSessionId: review.parentSessionId || null,
        stopReason: review.stopReason || null,
        transcript: Array.isArray(review.transcript) ? review.transcript : [],
      }
    }

    function view(id) {
      const req = requirements[id]
      if (!req) return null
      const executions = (req.executions || []).map(sanitizeExec).filter(Boolean)
      const lastExec = executions[executions.length - 1] || null
      const reviews = (req.reviews || []).map(sanitizeReview).filter(Boolean)
      const lastReview = reviews[reviews.length - 1] || null
      return {
        id: req.id,
        title: req.title,
        description: req.description,
        priority: req.priority,
        stage: req.stage,
        elements: req.elements,
        scope: req.scope,
        dependencies: req.dependencies,
        acceptanceCriteria: req.acceptanceCriteria,
        contextAnchors: Array.isArray(req.contextAnchors) ? req.contextAnchors.map(normalizeContextAnchor).filter(Boolean) : [],
        executions: executions,
        reviews,
        acceptances: (req.acceptances || []).map((a) => ({
          round: typeof a.round === 'number' ? a.round : 0,
          overall: a.overall || 'failed',
          agentSummary: typeof a.agentSummary === 'string' ? a.agentSummary : '',
          userConfirmed: !!a.userConfirmed,
          failedItems: Array.isArray(a.failedItems) ? a.failedItems : [],
          reworkSuggestion: a.reworkSuggestion || '',
          timestamp: typeof a.timestamp === 'number' ? a.timestamp : 0,
        })),
        reworkCount: req.reworkCount || 0,
        reworkReason: req.reworkReason || null,
        createdBy: req.createdBy,
        createdAt: req.createdAt,
        updatedAt: req.updatedAt,
        version: req.version,
        command: req.command || null,
        workdir: req.workdir || null,
        scheduledAt: typeof req.scheduledAt === 'number' ? req.scheduledAt : null,
        autoReview: req.autoReview === false ? false : true,
        events: (Array.isArray(req.events) ? req.events : []).slice(-40).map((ev) => ({
          type: ev && ev.type ? String(ev.type) : 'event',
          message: ev && ev.message ? String(ev.message) : '',
          at: ev && typeof ev.at === 'number' ? ev.at : 0,
          meta: ev && ev.meta && typeof ev.meta === 'object' ? ev.meta : null,
        })),
        // 验收产物：一句话摘要（最新一轮执行总结）
        deliverable: lastExec ? lastExec.summary : '',
        lastSessionId: lastExec ? lastExec.sessionId : null,
        lastParentSessionId: lastExec ? lastExec.parentSessionId : null,
        reviewPassed: lastReview ? lastReview.passed : null,
        reviewVerdict: lastReview ? lastReview.verdict : '',
        reviewIssues: lastReview ? lastReview.issues : [],
        reviewSessionId: lastReview ? lastReview.sessionId : null,
        reviewParentSessionId: lastReview ? lastReview.parentSessionId : null,
      }
    }

    // 轻量视图：轮询用（不含 transcript，避免每次拉全量对话）
    function lightView(id) {
      const r = view(id)
      if (!r) return null
      return {
        id: r.id,
        title: r.title,
        description: r.description,
        priority: r.priority,
        stage: r.stage,
        scope: r.scope,
        command: r.command,
        workdir: r.workdir,
        scheduledAt: r.scheduledAt,
        autoReview: r.autoReview,
        contextAnchors: r.contextAnchors,
        reworkCount: r.reworkCount,
        reworkReason: r.reworkReason,
        deliverable: r.deliverable,
        lastSessionId: r.lastSessionId,
        lastParentSessionId: r.lastParentSessionId,
        elementCount: r.elements.length,
        criterionCount: r.acceptanceCriteria.length,
        executionCount: r.executions.length,
        acceptanceCount: r.acceptances.length,
        reviewCount: r.reviews.length,
        reviewPassed: r.reviewPassed,
        reviewVerdict: r.reviewVerdict,
        reviewIssues: r.reviewIssues,
        reviewSessionId: r.reviewSessionId,
        reviewParentSessionId: r.reviewParentSessionId,
        events: r.events.slice(-6),
        updatedAt: r.updatedAt,
      }
    }

    function stateView() {
      return {
        requirements: Object.keys(requirements).map((k) => lightView(k)).filter(Boolean),
        backlog: backlog.slice(),
        execQueue: execQueue.slice(),
        maxRework: MAX_REWORK,
        persistDiag,
        lastWorkdir: normalizePanelWorkdir(lastWorkdir),
        panelDiag,
      }
    }

    // ── Client RPC ─────────────────────────────────────
    const handles = []
    function handle(method, fn) {
      try {
        const disposer = harness.handle(method, (args) => fn(args || {}))
        if (typeof disposer === 'function') handles.push(disposer)
      } catch (e) {
        console.error('harness.handle failed: ' + method, e)
      }
    }

    handle('state', async () => { maybeResumeAfterAgentAvailable(); return stateView() })
    handle('get', async (a) => view(a.id))
    handle('progress', async (a) => {
      // 实时进度：返回所有 executing/reviewing 需求的最新会话 id / 父会话 id / 工作目录 / 最近对话片段
      const out = []
      for (const k of Object.keys(requirements)) {
        const r = requirements[k]
        if (r.stage !== 'executing' && r.stage !== 'reviewing') continue
        const current = r.stage === 'reviewing'
          ? ((r.reviews || [])[r.reviews.length - 1] || null)
          : ((r.executions || [])[r.executions.length - 1] || null)
        const sessionId = current && current.sessionId ? current.sessionId : null
        const parentSessionId = current && current.parentSessionId ? current.parentSessionId : null
        let recent = []
        if (sessionId) recent = await captureTranscript(sessionId)
        out.push({
          id: r.id,
          title: r.title,
          stage: r.stage,
          workdir: r.workdir || null,
          sessionId,
          parentSessionId,
          startedAt: current ? current.startedAt : 0,
          elapsedMs: current ? (Date.now() - current.startedAt) : 0,
          recent: Array.isArray(recent) ? recent.slice(-8) : [],
        })
      }
      return out
    })
    handle('conversation', async (a) => {
      // 按需读取子 agent 会话的完整对话（若 transcript 已在执行记录中则直接返回）
      const r = view(a.id)
      if (!r) return null
      const runs = [...(r.executions || []), ...(r.reviews || [])]
      const run = runs.find((e) => e.sessionId === a.sessionId) || runs[runs.length - 1]
      const parentSessionId = run && run.parentSessionId ? run.parentSessionId : null
      if (run && Array.isArray(run.transcript) && run.transcript.length) {
        return { sessionId: run.sessionId, parentSessionId, transcript: run.transcript }
      }
      if (run && run.sessionId && sessionQuery) {
        const transcript = await captureTranscript(run.sessionId)
        run.transcript = transcript
        persistState()
        return { sessionId: run.sessionId, parentSessionId, transcript }
      }
      return { sessionId: null, parentSessionId: null, transcript: [] }
    })
    handle('suggest-sessions', async (a) => {
      const list = await suggestContextSessions({
        title: a.title,
        description: a.description,
        scope: Array.isArray(a.scope) ? a.scope : [],
      }, typeof a.limit === 'number' ? a.limit : 6)
      return { ok: true, items: list }
    })
    handle('create', async (a) => {
      const req = create(a)
      await attachContextAnchors(req, a)
      persistState()
      return view(req.id)
    })
    handle('update', async (a) => {
      const req = update(a.id, a)
      return view(req.id)
    })
    handle('remove', async (a) => ({ removed: remove(a.id) }))
    handle('set-workdir', async (a) => {
      // 全局默认工作目录：新建需求未指定时沿用
      if (typeof a.workdir === 'string' && a.workdir.trim()) {
        lastWorkdir = normalizePanelWorkdir(a.workdir)
        persistState()
        return { ok: true, lastWorkdir }
      }
      return { ok: false, lastWorkdir: normalizePanelWorkdir(lastWorkdir) }
    })
    handle('dispatch', async (a) => { dispatchToExec(a.id, a); return stateView() })
    handle('recall', async (a) => { recallFromExec(a.id); return stateView() })
    handle('top', async (a) => { moveExecTop(a.id); return stateView() })
    handle('accept', async (a) => {
      submitAcceptance(a.id, { overall: 'passed', agentSummary: (a.summary || ''), userConfirmed: true })
      return view(a.id)
    })
    handle('rework', async (a) => {
      submitAcceptance(a.id, {
        overall: 'failed',
        agentSummary: (a.summary || ''),
        failedItems: [],
        reworkSuggestion: String(a.feedback || '验收未通过'),
        userConfirmed: true,
      })
      return view(a.id)
    })
    handle('pause', async (a) => {
      stopExecution(a.id, 'paused')
      return view(a.id)
    })
    handle('stop', async (a) => {
      stopExecution(a.id, 'backlog')
      return view(a.id)
    })
    handle('resume', async (a) => {
      resumeExecution(a.id)
      return stateView()
    })
    handle('browse-dir', async (a) => {
      // 目录选择：列出指定目录层级（供「绑定工作目录」选择器使用）
      if (!directoryPicker) return { ok: false, error: 'directoryPicker 不可用' }
      try {
        const cap = directoryPicker.capability()
        if (!cap || cap.kind !== 'browse') {
          return { ok: false, error: '目录选择器不支持浏览模式（kind=' + (cap && cap.kind) + '）', native: cap && cap.kind === 'native' }
        }
        const listing = await cap.list(a && a.path ? String(a.path) : undefined, undefined)
        return {
          ok: true,
          path: listing.path,
          home: listing.home,
          crumbs: Array.isArray(listing.crumbs) ? listing.crumbs : [],
          entries: Array.isArray(listing.entries) ? listing.entries : [],
        }
      } catch (e) {
        return { ok: false, error: e && e.message ? e.message : String(e) }
      }
    })
    handle('pick-dir', async (a) => {
      // 目录选择：原生 OS 选择器（native capability）
      if (!directoryPicker) return { ok: false, error: 'directoryPicker 不可用' }
      try {
        const cap = directoryPicker.capability()
        if (!cap || cap.kind !== 'native') {
          return { ok: false, error: '目录选择器不支持原生选择（kind=' + (cap && cap.kind) + '）', browse: cap && cap.kind === 'browse' }
        }
        const chosen = await cap.pick(undefined)
        return { ok: true, path: chosen }
      } catch (e) {
        return { ok: false, error: e && e.message ? e.message : String(e) }
      }
    })

    // ── Agent 工具（8 个） ─────────────────────────────
    const textOutput = {
      schema: { type: 'string' },
      render: (args, value) => [{ type: 'text', text: typeof value === 'string' ? value : String(value) }],
    }

    function defineTool(def) {
      return harness.defineTool(def)
    }
    function registerTool(def) {
      try {
        const disposer = harness.registerTool(ctx, def)
        if (typeof disposer === 'function') handles.push(disposer)
      } catch (e) {
        console.error('registerTool failed: ' + def.name, e)
      }
    }

    registerTool(defineTool({
      name: 'propose_requirement',
      description: '提出一个需求：自动拆解构成要素与验收要素，进入需求队列（backlog，不自动执行）。之后可用 dispatch_requirement 丢入执行队列。可指定 workdir 绑定执行目录、scheduledAt 定时执行、autoReview 控制是否执行后自动复核。',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '需求标题' },
          description: { type: 'string', description: '详细描述（背景/目标/约束）' },
          priority: { type: 'string', enum: ['critical', 'high', 'medium', 'low'], description: '优先级' },
          scope: { type: 'array', items: { type: 'string' }, description: '涉及模块/文件' },
          dependencies: { type: 'array', items: { type: 'string' }, description: '前置需求 ID' },
          command: { type: 'string', description: '可选：执行时运行的命令' },
          workdir: { type: 'string', description: '可选：绑定执行工作目录（子 agent 在该目录完成文件操作）' },
          scheduledAt: { type: 'string', description: '可选：计划执行时间。支持 ISO/可解析时间字符串；为空表示立即执行。' },
          autoReview: { type: 'boolean', description: '可选：是否在执行完成后启动自动复核 agent；默认 true。' },
          contextAnchors: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                sessionId: { type: 'string' },
                title: { type: 'string' },
                snippet: { type: 'string' },
                cwd: { type: 'string' },
              },
              additionalProperties: true,
            },
            description: '可选：手动关联的历史会话，元素含 sessionId/title/snippet/cwd。未传时会按标题/描述自动扫描相关会话。',
          },
        },
        required: ['title'],
      },
      output: textOutput,
      async execute(args) {
        try {
          const req = create(args)
          await attachContextAnchors(req, args)
          persistState()
          return '已提出需求 ' + req.id + '「' + req.title + '」，拆解 ' + req.elements.length +
            ' 个构成要素、' + req.acceptanceCriteria.length + ' 项验收要素，已进入需求队列（不自动执行）。' +
            '自动复核：' + (req.autoReview === false ? '关闭。' : '开启。') +
            '关联会话：' + (req.contextAnchors && req.contextAnchors.length ? req.contextAnchors.length + ' 条。' : '无。') +
            '调用 dispatch_requirement 丢到执行队列后' + (req.scheduledAt ? '将在 ' + formatScheduledAt(req.scheduledAt) + ' 执行。' : '开始执行。')
        } catch (e) {
          return '提出需求失败：' + (e && e.message ? e.message : String(e))
        }
      },
    }))

    registerTool(defineTool({
      name: 'edit_requirement',
      description: '编辑已存在需求的标题/描述/优先级/范围/命令/绑定工作目录/计划执行时间/自动复核开关。',
      parameters: {
        type: 'object',
        properties: {
          requirementId: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          priority: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          scope: { type: 'array', items: { type: 'string' } },
          command: { type: 'string' },
          workdir: { type: 'string', description: '绑定工作目录' },
          scheduledAt: { type: 'string', description: '计划执行时间；为空表示立即执行。' },
          autoReview: { type: 'boolean', description: '是否在执行完成后启动自动复核 agent。' },
          contextAnchors: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                sessionId: { type: 'string' },
                title: { type: 'string' },
                snippet: { type: 'string' },
                cwd: { type: 'string' },
              },
              additionalProperties: true,
            },
            description: '手动关联的历史会话，元素含 sessionId/title/snippet/cwd。',
          },
        },
        required: ['requirementId'],
      },
      output: textOutput,
      async execute(args) {
        try {
          const req = update(args.requirementId, args)
          return '已更新需求 ' + req.id + '：' + req.title + '（' + req.priority + '，自动复核' + (req.autoReview === false ? '关闭' : '开启') + '，关联会话' + (req.contextAnchors ? req.contextAnchors.length : 0) + '条）'
        } catch (e) {
          return '编辑需求失败：' + (e && e.message ? e.message : String(e))
        }
      },
    }))

    registerTool(defineTool({
      name: 'delete_requirement',
      description: '删除一个需求（从所有队列中移除，不可恢复）。',
      parameters: {
        type: 'object',
        properties: { requirementId: { type: 'string' } },
        required: ['requirementId'],
      },
      output: textOutput,
      async execute(args) {
        const removed = remove(args.requirementId)
        return removed ? '已删除需求 ' + args.requirementId : '需求不存在：' + args.requirementId
      },
    }))

    registerTool(defineTool({
      name: 'dispatch_requirement',
      description: '将需求从需求队列丢到执行队列，排队由子 agent 串行执行；可指定 scheduledAt 在某个时间后执行。',
      parameters: {
        type: 'object',
        properties: {
          requirementId: { type: 'string' },
          scheduledAt: { type: 'string', description: '可选：计划执行时间。支持 ISO/可解析时间字符串；为空表示立即执行。' },
        },
        required: ['requirementId'],
      },
      output: textOutput,
      async execute(args, exec) {
        try {
          captureSignalCtor(exec && exec.signal)
          dispatchToExec(args.requirementId, args)
          const req = requirements[args.requirementId]
          return '需求 ' + args.requirementId + ' 已丢入执行队列' + (req && req.scheduledAt ? '，计划在 ' + formatScheduledAt(req.scheduledAt) + ' 执行。' : '排队执行。')
        } catch (e) {
          return '派发失败：' + (e && e.message ? e.message : String(e))
        }
      },
    }))

    registerTool(defineTool({
      name: 'list_requirements',
      description: '按阶段查询需求列表（backlog/queued/executing/reviewing/paused/accepting/accepted，不传则全部）。',
      parameters: {
        type: 'object',
        properties: { stage: { type: 'string', description: '可选，过滤阶段' } },
      },
      output: textOutput,
      async execute(args) {
        const sv = stateView()
        const all = sv.requirements
        const list = args.stage ? all.filter((r) => r.stage === args.stage) : all
        if (!list.length) return '（无' + (args.stage || '任何阶段') + '需求）\n【存储】' + sv.persistDiag + '\n【面板agent】' + (sv.panelDiag || 'not-created')
        return '【存储】' + sv.persistDiag + '\n【面板agent】' + (sv.panelDiag || 'not-created') + '\n' + list.map((r) => '-' + r.id + ' [' + r.priority + '] ' + r.title + '（' + r.stage +
          (r.reworkCount ? '，返工' + r.reworkCount + '次' : '') + (r.scheduledAt ? '，计划:' + formatScheduledAt(r.scheduledAt) : '') + (r.autoReview === false ? '，不自动复核' : '，自动复核') + (r.workdir ? '，目录:' + r.workdir : '') + '）').join('\n')
      },
    }))

    registerTool(defineTool({
      name: 'get_requirement',
      description: '查看单个需求的完整上下文（构成要素、验收要素、执行与验收历史、返工记录、一句话产物）。',
      parameters: {
        type: 'object',
        properties: { requirementId: { type: 'string' } },
        required: ['requirementId'],
      },
      output: textOutput,
      async execute(args) {
        const r = view(args.requirementId)
        if (!r) return '未找到需求 ' + args.requirementId
        const lines = [
          '#' + r.id + '「' + r.title + '」 [' + r.priority + '] stage=' + r.stage,
          '描述：' + r.description,
          '工作目录：' + (r.workdir || '（未绑定，用面板默认目录）'),
          '计划执行：' + (r.scheduledAt ? formatScheduledAt(r.scheduledAt) : '立即执行'),
          '自动复核：' + (r.autoReview === false ? '关闭' : '开启'),
          '关联会话：' + (r.contextAnchors && r.contextAnchors.length ? r.contextAnchors.map((a) => a.sessionId + (a.title ? '「' + a.title + '」' : '')).join('；') : '无'),
          '构成要素：' + r.elements.map((e) => e.description).join('；'),
          '验收要素：' + r.acceptanceCriteria.map((a) => '[' + a.id + '] ' + a.description).join('；'),
          '返工：' + r.reworkCount + ' 次' + (r.reworkReason ? '，原因：' + r.reworkReason : ''),
          '执行轮次：' + r.executions.length,
          ...r.executions.map((ex, i) => '  第' + ex.round + '轮(' + (ex.isRework ? '返工' : '首次') + ') 产物：' + (ex.summary || '（无）')),
          '复核轮次：' + r.reviews.length,
          ...(r.reviews || []).map((rv) => '  第' + rv.round + '轮复核：' + (rv.passed ? '通过' : '有问题') + '，' + (rv.verdict || '（无结论）')),
        ]
        return lines.join('\n')
      },
    }))

    registerTool(defineTool({
      name: 'complete_execution',
      description: '手动标记需求执行完成并进入待验收池（附执行总结，作为验收产物的一句话）。队列自动执行时无需调用。',
      parameters: {
        type: 'object',
        properties: {
          requirementId: { type: 'string' },
          summary: { type: 'string', description: '执行总结（一句话产物）' },
        },
        required: ['requirementId'],
      },
      output: textOutput,
      async execute(args) {
        const req = requirements[args.requirementId]
        if (!req) return '需求不存在：' + args.requirementId
        completeExecution(args.requirementId, String(args.summary || ''), { skipReview: true })
        return '需求 ' + args.requirementId + ' 已提交验收（产物：' + (args.summary || '无') + '）'
      },
    }))

    registerTool(defineTool({
      name: 'submit_acceptance',
      description: '提交需求验收结果。全部通过进入验收完成；任一失败或给出反馈则自动重入执行队列返工（≤' + MAX_REWORK + '次）。',
      parameters: {
        type: 'object',
        properties: {
          requirementId: { type: 'string' },
          passed: { type: 'boolean', description: '是否通过' },
          summary: { type: 'string', description: '验收总结' },
          feedback: { type: 'string', description: '失败时的修复反馈/建议' },
        },
        required: ['requirementId', 'passed'],
      },
      output: textOutput,
      async execute(args) {
        try {
          if (args.passed) {
            submitAcceptance(args.requirementId, { overall: 'passed', agentSummary: String(args.summary || ''), userConfirmed: true })
            return '需求 ' + args.requirementId + ' 验收通过，已进入验收完成队列。'
          }
          submitAcceptance(args.requirementId, {
            overall: 'failed',
            agentSummary: String(args.summary || ''),
            failedItems: [],
            reworkSuggestion: String(args.feedback || '验收未通过'),
            userConfirmed: true,
          })
          return '需求 ' + args.requirementId + ' 验收未通过，已自动重入执行队列返工。反馈：' + (args.feedback || '无')
        } catch (e) {
          return '验收失败：' + (e && e.message ? e.message : String(e))
        }
      },
    }))

    // ── 系统提示词段落：让主 agent 感知面板状态 ──
    if (systemPrompt && typeof systemPrompt.section === 'function') {
      try {
        systemPrompt.section({
          name: 'dsh-task-panel:state',
          order: 90,
          text: () => {
          const sv = stateView()
          const byStage = (s) => sv.requirements.filter((r) => r.stage === s)
          const line = (r) => '-' + r.id + ' [' + r.priority + '] ' + r.title
          const parts = [
            '【需求面板状态】',
            '需求队列(backlog): ' + byStage('backlog').length,
            ...byStage('backlog').slice(0, 8).map(line),
            '执行队列(queued): ' + byStage('queued').length,
            ...byStage('queued').slice(0, 8).map((r) => line(r) + (r.scheduledAt ? '（计划 ' + formatScheduledAt(r.scheduledAt) + '）' : '')),
            '执行中(executing): ' + byStage('executing').length,
            '自动复核(reviewing): ' + byStage('reviewing').length,
            '已暂停(paused): ' + byStage('paused').length,
            '待验收(accepting): ' + byStage('accepting').length,
            '验收完成(accepted): ' + byStage('accepted').length,
          ]
          const accepting = Object.values(requirements).find((r) => r.stage === 'accepting')
          if (accepting) {
            parts.push('', '【待验收需求 ' + accepting.id + '「' + accepting.title + '」】')
            parts.push('一句话产物：' + (accepting.deliverable || '（无）'))
            parts.push('验收要素：' + accepting.acceptanceCriteria.map((a) => '[' + a.id + '] ' + a.description).join('；'))
            parts.push('可调用 submit_acceptance 完成验收，或通过 UI 进行验收反馈。')
          }
          return parts.join('\n')
          },
        })
      } catch (e) { console.error('system prompt section failed', e) }
    }

    // ── 启动恢复：重置卡在 executing 的项 + 恢复队列 ──
    ;(async () => {
      await loadState()
      let changed = false
      for (const k of Object.keys(requirements)) {
        const r = requirements[k]
        if (r.stage === 'executing' || r.stage === 'reviewing') {
          r.stage = 'queued'
          if (execQueue.indexOf(k) < 0) execQueue.push(k)
          changed = true
        }
      }
      if (changed) persistState()
      void pump()
    })()

    // ── 停止时清理：取消在途子 agent + 释放面板专用 agent ──
    ctx.effect(() => () => {
      for (const run of runningRuns.values()) {
        try { run.dispose() } catch (e) { /* noop */ }
      }
      if (pumpTimer) {
        try { clearTimeout(pumpTimer) } catch (e) { /* noop */ }
        pumpTimer = null
      }
      runningRuns.clear()
      if (panelHandle) {
        try { void panelHandle.dispose().catch(() => {}) } catch (e) { /* noop */ }
        panelHandle = null
        panelAgent = null
      }
    })
  },
}
})()

export const name = 'dsh-task-panel'
export const inject = [...plugin.inject, 'tools']
export function apply(ctx) {
  registerRpcRoute(ctx)
  ctx.on('internal/service', (name) => {
    if (name === 'webServer' || name === 'httpServer') registerRpcRoute(ctx)
  })
  return plugin.apply(ctx)
}
