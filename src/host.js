// ─────────────────────────────────────────────────────────────
// dsh-task-panel · Host 半
// 需求面板 + 双队列任务队列：
//   需求队列(backlog) → 执行队列(queued) → 执行中(executing)
//   → 待验收(accepting) → 验收完成(accepted)，返工自动重入。
// 队列在子 session（subagents.start）中串行执行，
// 完成后回填一句话产物 + 完整对话 transcript，供验收查看。
// ─────────────────────────────────────────────────────────────

return {
  inject: ['subagents', 'agents'],
  apply(ctx) {
    const subagents = ctx.subagents
    const agents = ctx.agents
    const sessionQuery = ctx.get('sessionQuery')
    const fs = ctx.get('fs')
    const sandboxPolicy = ctx.get('sandboxPolicy')
    const systemPrompt = ctx.get('systemPrompt')
    const timerService = ctx.get('timer')

    const MAX_REWORK = 5

    // ── 沙箱没有 AbortController，从真实事件捕获 AbortSignal 构造器 ──
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
    // 永不中断的信号：子 agent 跑完整轮，不因触发它的某个 step 结束而被取消
    function freshSignal() {
      if (AbortSignalCtor && typeof AbortSignalCtor.any === 'function') {
        try { return AbortSignalCtor.any([]) } catch (e) { /* fallthrough */ }
      }
      return undefined
    }

    // ── 内存态（Fork/Resume 通过 fs 尽力持久化） ──
    const requirements = {}
    const backlog = []
    const execQueue = []
    let seqCounter = 0

    function nextId() {
      seqCounter += 1
      return 'RQ-' + Date.now().toString(36).toUpperCase() + '-' + seqCounter
    }

    // ── 持久化（best effort：失败只告警，不阻断） ──
    let dataTarget = null
    let dataTargetPromise = null
    function resolveDataTarget() {
      if (dataTarget) return Promise.resolve(dataTarget)
      if (dataTargetPromise) return dataTargetPromise
      dataTargetPromise = (async () => {
        try {
          if (!fs || !sandboxPolicy) return null
          const root = sandboxPolicy.workspaceRoot
          if (!root || typeof root !== 'string') return null
          const target = await fs.resolve(root + '/.dsh-task-panel/requirements.json')
          dataTarget = target
          return target
        } catch (e) {
          console.error('resolve data target failed', e)
          return null
        }
      })()
      return dataTargetPromise
    }

    async function loadState() {
      try {
        const target = await resolveDataTarget()
        if (!target) return
        const text = await fs.readText(target)
        if (!text) return
        const parsed = JSON.parse(text)
        if (!parsed || typeof parsed !== 'object') return
        if (parsed.requirements && typeof parsed.requirements === 'object') {
          for (const k of Object.keys(parsed.requirements)) requirements[k] = parsed.requirements[k]
        }
        if (Array.isArray(parsed.backlog)) { backlog.length = 0; backlog.push(...parsed.backlog) }
        if (Array.isArray(parsed.execQueue)) { execQueue.length = 0; execQueue.push(...parsed.execQueue) }
      } catch (e) { /* 首次运行没有数据 */ }
    }

    function persistState() {
      const p = (async () => {
        try {
          const target = await resolveDataTarget()
          if (!target) return
          await fs.writeText(target, JSON.stringify({ requirements, backlog, execQueue }))
        } catch (e) { console.error('persist failed', e) }
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
        elements,
        scope: (input.scope || []).slice(),
        dependencies: (input.dependencies || []).slice(),
        acceptanceCriteria,
        contextAnchors: [],
        executions: [],
        acceptances: [],
        reworkCount: 0,
        reworkReason: null,
        createdBy: input.createdBy === 'agent' ? 'agent' : 'user',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        version: 1,
        command: input.command ? String(input.command) : null,
      }
      requirements[req.id] = req
      if (backlog.indexOf(req.id) < 0) backlog.push(req.id)
      persistState()
      return req
    }

    function get(id) {
      return requirements[id] || null
    }

    function update(id, patch) {
      const req = requirements[id]
      if (!req) throw new Error('需求不存在: ' + id)
      const allowed = ['title', 'description', 'priority', 'scope', 'dependencies', 'command', 'acceptanceCriteria']
      for (const k of allowed) {
        if (Object.prototype.hasOwnProperty.call(patch, k) && patch[k] !== undefined) req[k] = patch[k]
      }
      if (typeof req.title === 'string') req.title = req.title.trim()
      req.updatedAt = Date.now()
      req.version = (req.version || 0) + 1
      persistState()
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
    function dispatchToExec(id) {
      const req = requirements[id]
      if (!req) throw new Error('需求不存在: ' + id)
      const bi = backlog.indexOf(id)
      if (bi >= 0) backlog.splice(bi, 1)
      if (
        execQueue.indexOf(id) < 0 &&
        req.stage !== 'executing' &&
        req.stage !== 'accepting' &&
        req.stage !== 'accepted'
      ) {
        execQueue.push(id)
        req.stage = 'queued'
        req.updatedAt = Date.now()
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
        if (req) { req.stage = 'backlog'; req.updatedAt = Date.now() }
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
        reworkReason: req.reworkReason || undefined,
        sessionId: null,
        stopReason: null,
        transcript: [],
      })
      req.stage = 'executing'
      req.updatedAt = Date.now()
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
          exec.stopReason = meta.stopReason || null
          exec.transcript = Array.isArray(meta.transcript) ? meta.transcript : []
        }
      }
      req.stage = 'accepting'
      req.updatedAt = Date.now()
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
      } else {
        const reason = rec.reworkSuggestion || rec.failedItems.join(', ') || '验收未通过'
        const next = (req.reworkCount || 0) + 1
        req.reworkCount = next
        req.reworkReason = reason
        if (next < MAX_REWORK) {
          req.stage = 'queued'
          if (execQueue.indexOf(id) < 0) execQueue.push(id)
        } else {
          // 返工达上限 → 退回需求队列防死循环
          req.stage = 'backlog'
          const bi = execQueue.indexOf(id)
          if (bi >= 0) execQueue.splice(bi, 1)
          if (backlog.indexOf(id) < 0) backlog.push(id)
        }
      }
      req.updatedAt = Date.now()
      persistState()
      if (rec.overall !== 'passed') void pump()
      return req
    }

    // ── 队列派发器：串行子 session 执行 ───────────────
    let busy = false
    const runningRuns = new Set()

    function resolveParent() {
      try { const init = agents.currentInitiator(); if (init) return init } catch (e) { /* noop */ }
      try { const roots = agents.roots(); if (roots && roots.length) return roots[0] } catch (e) { /* noop */ }
      try { const list = agents.list(); if (list && list.length) return list[0] } catch (e) { /* noop */ }
      return null
    }

    function resolveProvider() {
      try {
        const names = subagents.list() || []
        for (const p of ['fork', 'spawn', 'acp']) if (names.includes(p)) return p
        return names[0] || 'fork'
      } catch (e) { return 'fork' }
    }

    function buildPrompt(req) {
      const lines = [
        '请执行需求 #' + req.id + '「' + req.title + '」。',
        req.description ? '描述：' + req.description : '',
        '优先级：' + req.priority,
        req.scope && req.scope.length ? '涉及范围：' + req.scope.join(', ') : '',
        '构成要素：' + req.elements.map((e) => e.description).join('；'),
        '验收要素：' + req.acceptanceCriteria.map((a) => '[' + a.id + '] ' + a.description).join('；'),
        req.command ? '如需验证请运行命令：' + req.command : '',
        req.reworkCount > 0 && req.reworkReason
          ? '这是第 ' + (req.reworkCount + 1) + ' 轮执行，请针对返工原因修复：' + req.reworkReason
          : '',
        '请在你的会话中实际完成该需求（读代码、修改文件、运行测试等）。',
        '最后用一段简洁的话总结你的交付产物：一句话说明你做了什么、结果如何（这是验收时展示的产物摘要）。',
      ]
      return lines.filter(Boolean).join('\n')
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

    async function pump() {
      if (busy) return
      if (execQueue.length === 0) return
      const id = execQueue.shift()
      if (!id || !requirements[id]) {
        persistState()
        void pump()
        return
      }
      const req = requirements[id]
      busy = true
      persistState()
      try {
        startExecution(id)
        const parent = resolveParent()
        if (!parent || !subagents) {
          await completeExecution(id, '未挂载子 agent 执行能力，已跳过真实执行（状态流转到待验收）')
          busy = false
          void pump()
          return
        }
        // 等待 AbortSignal 构造器可用（agent/pre-step 每步都会捕获）
        let signal = freshSignal()
        let tries = 0
        while (!signal && timerService && tries < 20) {
          try { await timerService.timeout(400) } catch (e) { /* noop */ }
          signal = freshSignal()
          tries++
        }
        if (!signal) {
          await completeExecution(id, '执行器初始化失败：未捕获到 AbortSignal，请再派发一次')
          busy = false
          void pump()
          return
        }
        const provider = resolveProvider()
        const run = await subagents.start(provider, {
          label: '执行 ' + id + ' ' + req.title,
          prompt: [{ type: 'text', text: buildPrompt(req) }],
          parent: parent,
          signal: signal,
        })
        runningRuns.add(run)
        let result
        try {
          result = await run.result
        } finally {
          runningRuns.delete(run)
        }
        const summary = extractText(result && result.output) || '执行完成（stopReason=' + (result && result.stopReason) + '）'
        const sessionId = run && run.id ? run.id : null
        const transcript = await captureTranscript(sessionId)
        try { if (run && typeof run.dispose === 'function') await run.dispose() } catch (e) { /* noop */ }
        await completeExecution(id, summary, {
          sessionId: sessionId,
          stopReason: result && result.stopReason,
          transcript: transcript,
        })
      } catch (err) {
        await completeExecution(id, '执行异常：' + (err && err.message ? err.message : String(err)))
      } finally {
        busy = false
        void pump()
      }
    }

    // ── 对外只读视图（供 RPC / 工具 / 提示词使用） ──
    function view(id) {
      const req = requirements[id]
      if (!req) return null
      const lastExec = req.executions[req.executions.length - 1] || null
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
        executions: req.executions,
        acceptances: req.acceptances,
        reworkCount: req.reworkCount,
        reworkReason: req.reworkReason,
        createdBy: req.createdBy,
        createdAt: req.createdAt,
        updatedAt: req.updatedAt,
        version: req.version,
        command: req.command,
        // 验收产物：一句话摘要（最新一轮执行总结）
        deliverable: lastExec ? lastExec.summary : '',
        lastSessionId: lastExec ? lastExec.sessionId : null,
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
        reworkCount: r.reworkCount,
        reworkReason: r.reworkReason,
        deliverable: r.deliverable,
        lastSessionId: r.lastSessionId,
        elementCount: r.elements.length,
        criterionCount: r.acceptanceCriteria.length,
        executionCount: r.executions.length,
        acceptanceCount: r.acceptances.length,
        updatedAt: r.updatedAt,
      }
    }

    function stateView() {
      return {
        requirements: Object.keys(requirements).map((k) => lightView(k)).filter(Boolean),
        backlog: backlog.slice(),
        execQueue: execQueue.slice(),
        maxRework: MAX_REWORK,
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

    handle('state', async () => stateView())
    handle('get', async (a) => view(a.id))
    handle('conversation', async (a) => {
      // 按需读取子 agent 会话的完整对话（若 transcript 已在执行记录中则直接返回）
      const r = view(a.id)
      if (!r) return null
      const exec = (r.executions || []).find((e) => e.sessionId === a.sessionId) || r.executions[r.executions.length - 1]
      if (exec && Array.isArray(exec.transcript) && exec.transcript.length) {
        return { sessionId: exec.sessionId, transcript: exec.transcript }
      }
      if (exec && exec.sessionId && sessionQuery) {
        const transcript = await captureTranscript(exec.sessionId)
        exec.transcript = transcript
        persistState()
        return { sessionId: exec.sessionId, transcript }
      }
      return { sessionId: null, transcript: [] }
    })
    handle('create', async (a) => {
      const req = create(a)
      return view(req.id)
    })
    handle('update', async (a) => {
      const req = update(a.id, a)
      return view(req.id)
    })
    handle('remove', async (a) => ({ removed: remove(a.id) }))
    handle('dispatch', async (a) => { dispatchToExec(a.id); return stateView() })
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
      description: '提出一个需求：自动拆解构成要素与验收要素，进入需求队列（backlog，不自动执行）。之后可用 dispatch_requirement 丢入执行队列。',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '需求标题' },
          description: { type: 'string', description: '详细描述（背景/目标/约束）' },
          priority: { type: 'string', enum: ['critical', 'high', 'medium', 'low'], description: '优先级' },
          scope: { type: 'array', items: { type: 'string' }, description: '涉及模块/文件' },
          dependencies: { type: 'array', items: { type: 'string' }, description: '前置需求 ID' },
          command: { type: 'string', description: '可选：执行时运行的命令' },
        },
        required: ['title'],
      },
      output: textOutput,
      async execute(args) {
        try {
          const req = create(args)
          return '已提出需求 ' + req.id + '「' + req.title + '」，拆解 ' + req.elements.length +
            ' 个构成要素、' + req.acceptanceCriteria.length + ' 项验收要素，已进入需求队列（不自动执行）。' +
            '调用 dispatch_requirement 丢到执行队列后开始执行。'
        } catch (e) {
          return '提出需求失败：' + (e && e.message ? e.message : String(e))
        }
      },
    }))

    registerTool(defineTool({
      name: 'edit_requirement',
      description: '编辑已存在需求的标题/描述/优先级/范围/命令。',
      parameters: {
        type: 'object',
        properties: {
          requirementId: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          priority: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          scope: { type: 'array', items: { type: 'string' } },
          command: { type: 'string' },
        },
        required: ['requirementId'],
      },
      output: textOutput,
      async execute(args) {
        try {
          const req = update(args.requirementId, args)
          return '已更新需求 ' + req.id + '：' + req.title + '（' + req.priority + '）'
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
      description: '将需求从需求队列丢到执行队列，排队由子 agent 串行执行。',
      parameters: {
        type: 'object',
        properties: { requirementId: { type: 'string' } },
        required: ['requirementId'],
      },
      output: textOutput,
      async execute(args, exec) {
        try {
          captureSignalCtor(exec && exec.signal)
          dispatchToExec(args.requirementId)
          return '需求 ' + args.requirementId + ' 已丢入执行队列排队执行。'
        } catch (e) {
          return '派发失败：' + (e && e.message ? e.message : String(e))
        }
      },
    }))

    registerTool(defineTool({
      name: 'list_requirements',
      description: '按阶段查询需求列表（backlog/queued/executing/accepting/accepted，不传则全部）。',
      parameters: {
        type: 'object',
        properties: { stage: { type: 'string', description: '可选，过滤阶段' } },
      },
      output: textOutput,
      async execute(args) {
        const sv = stateView()
        const all = sv.requirements
        const list = args.stage ? all.filter((r) => r.stage === args.stage) : all
        if (!list.length) return '（无' + (args.stage || '任何阶段') + '需求）'
        return list.map((r) => '-' + r.id + ' [' + r.priority + '] ' + r.title + '（' + r.stage +
          (r.reworkCount ? '，返工' + r.reworkCount + '次' : '') + '）').join('\n')
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
          '构成要素：' + r.elements.map((e) => e.description).join('；'),
          '验收要素：' + r.acceptanceCriteria.map((a) => '[' + a.id + '] ' + a.description).join('；'),
          '返工：' + r.reworkCount + ' 次' + (r.reworkReason ? '，原因：' + r.reworkReason : ''),
          '执行轮次：' + r.executions.length,
          ...r.executions.map((ex, i) => '  第' + ex.round + '轮(' + (ex.isRework ? '返工' : '首次') + ') 产物：' + (ex.summary || '（无）')),
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
        completeExecution(args.requirementId, String(args.summary || ''))
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
        systemPrompt.section(async () => {
          const sv = stateView()
          const byStage = (s) => sv.requirements.filter((r) => r.stage === s)
          const line = (r) => '-' + r.id + ' [' + r.priority + '] ' + r.title
          const parts = [
            '【需求面板状态】',
            '需求队列(backlog): ' + byStage('backlog').length,
            ...byStage('backlog').slice(0, 8).map(line),
            '执行队列(queued): ' + byStage('queued').length,
            ...byStage('queued').slice(0, 8).map(line),
            '执行中(executing): ' + byStage('executing').length,
            '待验收(accepting): ' + byStage('accepting').length,
            '验收完成(accepted): ' + byStage('accepted').length,
          ]
          const accepting = byStage('accepting')[0]
          if (accepting) {
            parts.push('', '【待验收需求 ' + accepting.id + '「' + accepting.title + '」】')
            parts.push('一句话产物：' + (accepting.deliverable || '（无）'))
            parts.push('验收要素：' + accepting.acceptanceCriteria.map((a) => '[' + a.id + '] ' + a.description).join('；'))
            parts.push('可调用 submit_acceptance 完成验收，或通过 UI 进行验收反馈。')
          }
          return parts.join('\n')
        })
      } catch (e) { console.error('system prompt section failed', e) }
    }

    // ── 启动恢复：重置卡在 executing 的项 + 恢复队列 ──
    ;(async () => {
      await loadState()
      let changed = false
      for (const k of Object.keys(requirements)) {
        const r = requirements[k]
        if (r.stage === 'executing') {
          r.stage = 'queued'
          if (execQueue.indexOf(k) < 0) execQueue.push(k)
          changed = true
        }
      }
      if (changed) persistState()
      void pump()
    })()

    // ── 停止时清理：取消在途子 agent ──
    ctx.effect(() => () => {
      for (const run of runningRuns) {
        try { run.dispose() } catch (e) { /* noop */ }
      }
      runningRuns.clear()
    })
  },
}
