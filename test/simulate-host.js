// ─────────────────────────────────────────────────────────────
// simulate-host.js · 用真实 src/host.js 源码 + mock 服务跑全流程
// 验证：create/update/remove、双队列调度、子 agent 派发(pump)、
//       一句话产物、对话 transcript、验收通过/返工、置顶/撤回，
//       以及 AbortSignal 兜底（未捕获信号时执行器仍能初始化，[17]）。
// 运行：npm test（或 node test/simulate-host.js）
// ─────────────────────────────────────────────────────────────
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'host.js'), 'utf8')

// ── mocks ──────────────────────────────────────────────────
const handlers = {}
const registeredTools = []

const mockSessionQuery = {
  readSession: async () => ({
    session: { id: 's1' },
    events: [
      { type: 'user/message', seq: 1, time: Date.now(), data: { content: [{ type: 'text', text: '请执行需求...' }] } },
      { type: 'assistant/message', seq: 2, time: Date.now(), data: { message: { id: 'm2', role: 'assistant', content: [{ type: 'text', text: '完成：已创建 demo.txt 并验证内容正确' }], source: {} } } },
      { type: 'tool/call', seq: 3, time: Date.now(), data: { name: 'bash', arguments: '{"command":"ls"}' } },
    ],
  }),
}

let runSeq = 0
const pendingRuns = [] // 手动控制子 agent 完成时机
const startedReqs = []  // 记录 subagents.start 收到的请求（parent/prompt）
const mockSubagents = {
  list: () => ['fork', 'spawn'],
  start: async (provider, request) => {
    runSeq++
    startedReqs.push(request)
    const id = 'sess-mock-' + runSeq
    let resolveResult
    const result = new Promise((res) => { resolveResult = res })
    pendingRuns.push(() => resolveResult({
      output: [{ type: 'text', text: '完成：已创建 demo.txt 并验证内容正确（第 ' + runSeq + ' 轮）' }],
      stopReason: 'completed',
    }))
    return { id, result, dispose: async () => {} }
  },
}

const mockAgents = {
  currentInitiator: () => null,
  roots: () => [{ id: 'root-agent', session: { id: 'root-session', header: { cwd: '/workspace' } }, ctx: {} }],
  list: () => [{ id: 'root-agent', session: { id: 'root-session', header: { cwd: '/workspace' } }, ctx: {} }],
  // 面板专用 agent：独立 session + 独立 cwd（setup 里 composeFrom 继承根装配）
  create: async (opts) => {
    const agent = {
      id: 'panel-agent-' + opts.sessionId.slice(-6),
      session: { id: opts.sessionId, header: { cwd: opts.meta.cwd } },
      options: opts.agentOptions || {},
      ctx: {},
    }
    if (typeof opts.setup === 'function') {
      const commit = await opts.setup({})
      if (commit && typeof commit.commit === 'function') commit.commit()
    }
    return { agent, dispose: async () => {} }
  },
}

const listeners = {}
const ctx = {
  subagents: mockSubagents,
  agents: mockAgents,
  get: (name) => {
    if (name === 'sessionQuery') return mockSessionQuery
    if (name === 'agentPresets') return { composeFrom: (childCtx, parentCtx) => 'default' }
    if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-chat' }) }
    if (name === 'directoryPicker') return {
      capability: () => ({
        kind: 'browse',
        list: async (path) => ({
          path: path || '/workspace',
          home: '/home/user',
          crumbs: [{ name: 'Users', path: '/Users' }, { name: 'jekin', path: '/home/user' }, { name: 'workplace', path: '/workspace' }],
          entries: [{ name: 'dsh-task-panel', path: '/workspace/dsh-task-panel', hidden: false }],
        }),
      }),
    }
    return undefined
  },
  on: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); return () => {} },
  effect: (fn) => { const d = fn(); return typeof d === 'function' ? d : () => {} },
}

const harness = {
  defineTool: (def) => def,
  registerTool: (c, def) => { registeredTools.push(def.name); return () => {} },
  handle: (method, fn) => { handlers[method] = fn; return () => {} },
}

const sandbox = { harness, ctx, console }
vm.createContext(sandbox)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function assert(cond, msg) {
  if (!cond) { console.error('❌ 断言失败:', msg); process.exit(1) }
}

async function main() {
  // 1. 加载并 apply 插件（真实源码）
  const plugin = await vm.runInContext('(async () => {\n' + src + '\n})()', sandbox)
  console.log('✅ 插件源码加载成功 | inject =', JSON.stringify(plugin.inject))
  plugin.apply(ctx)
  console.log('✅ apply 完成 | 工具数 =', registeredTools.length, '| RPC =', Object.keys(handlers).join(','))

  // 2. 模拟 agent/pre-step 事件 → 注入 AbortSignal 构造器
  for (const fn of listeners['agent/pre-step'] || []) await fn({ signal: AbortSignal.timeout(60000) }, () => 'next')
  console.log('✅ 已注入 AbortSignal（来自 agent/pre-step）')

  // 3. create → backlog
  let a = await handlers.create({ title: '创建测试文件', description: '在仓库创建 demo.txt，内容 ok，含测试', priority: 'high', scope: ['src/'] })
  console.log('\n[1] create →', a.id, '| stage =', a.stage, '| 要素 =', a.elements.map((e) => e.category).join(','), '| 验收 =', a.acceptanceCriteria.length)
  assert(a.stage === 'backlog', 'create 后应在 backlog')
  assert(a.elements.length >= 1 && a.acceptanceCriteria.length >= 1, '应自动拆解要素与验收')

  // 4. update 编辑
  a = await handlers.update({ id: a.id, title: '创建测试文件（已编辑）', description: '改后的描述' })
  console.log('[2] update →', a.title, '| 描述 =', a.description)
  assert(a.title === '创建测试文件（已编辑）', 'update 应生效')

  // 5. dispatch → executing（手动控制完成）
  await handlers.dispatch({ id: a.id })
  await sleep(30)
  a = await handlers.get({ id: a.id })
  console.log('[3] dispatch 后 stage =', a.stage)
  assert(a.stage === 'executing', '子 agent 执行中')
  assert(pendingRuns.length === 1, '应派发一个子 agent')
  assert(a.lastSessionId === 'sess-mock-1', '执行启动后应立即回填会话 id（执行中可追踪）')

  // 5b. 实时进度：executing 时 progress RPC 返回会话 id / 父会话 id / 最近对话
  const prog = await handlers.progress({})
  const p0 = prog.find((p) => p.id === a.id)
  console.log('[3b] progress →', JSON.stringify(p0 ? { id: p0.id, sessionId: p0.sessionId, parentSessionId: p0.parentSessionId, recent: p0.recent.length } : null))
  assert(p0 && p0.sessionId === 'sess-mock-1', 'progress 应返回执行中会话 id')
  assert(p0 && p0.recent.length >= 1, 'progress 应返回最近对话片段')

  // 6. 完成执行 → accepting + 一句话产物 + transcript
  pendingRuns.shift()()
  await sleep(80)
  a = await handlers.get({ id: a.id })
  console.log('[4] 完成后 stage =', a.stage, '| 产物 =', a.deliverable)
  console.log('     sessionId =', a.lastSessionId, '| 执行轮次 =', a.executions.length)
  assert(a.stage === 'accepting', '完成后进入 accepting')
  assert(a.deliverable.includes('demo.txt'), '一句话产物应为交付摘要')
  assert(a.lastSessionId === 'sess-mock-1', '记录子 session id')

  // 7. 查看对话
  const conv = await handlers.conversation({ id: a.id, sessionId: a.lastSessionId })
  console.log('[5] conversation →', conv.transcript.length, '条消息')
  assert(conv.transcript.length === 3, '应捕获 3 条对话消息')

  // 8. accept → accepted
  a = await handlers.accept({ id: a.id })
  console.log('[6] accept → stage =', a.stage)
  assert(a.stage === 'accepted', '验收通过进入 accepted')

  // 9. 返工流程：B 执行完 → rework(feedback) → 自动重入队列重执行
  const b = await handlers.create({ title: '返工测试', description: '需要测试用例验证' })
  await handlers.dispatch({ id: b.id })
  await sleep(30)
  pendingRuns.shift()() // B 第 1 轮完成
  await sleep(80)
  let bv = await handlers.get({ id: b.id })
  assert(bv.stage === 'accepting', 'B 首轮完成应 accepting')
  bv = await handlers.rework({ id: b.id, feedback: '缺少测试用例，请补充单测' })
  console.log('[7] rework → stage =', bv.stage, '| 返工 =', bv.reworkCount, '| 原因 =', bv.reworkReason)
  // queued 是瞬时态：worker 会立即同步派发重执行 → 读到 executing 也正确
  assert(['queued', 'executing'].includes(bv.stage), '返工后应重入执行队列（queued→executing）')
  assert(bv.reworkCount === 1, '返工次数应为 1')
  await sleep(30)
  assert(pendingRuns.length === 1, '返工应自动派发第 2 轮子 agent')
  pendingRuns.shift()() // B 第 2 轮完成
  await sleep(80)
  const b2 = await handlers.get({ id: b.id })
  console.log('[8] 返工自动重执行 → stage =', b2.stage, '| 执行轮次 =', b2.executions.length, '| 第2轮返工标记 =', b2.executions[1].isRework)
  assert(b2.stage === 'accepting' && b2.executions.length === 2, '返工自动重执行并回 accepting')
  assert(b2.executions[1].isRework === true, '第 2 轮标记为返工')

  // 10. 队列排序：C/D/E 并发丢入，测试 top / recall
  const c = await handlers.create({ title: '任务C' })
  const d = await handlers.create({ title: '任务D' })
  const e = await handlers.create({ title: '任务E' })
  await handlers.dispatch({ id: c.id }) // C 开始执行（挂起）
  await sleep(30)
  await handlers.dispatch({ id: d.id }) // D queued
  await handlers.dispatch({ id: e.id }) // E queued
  await handlers.top({ id: e.id })      // E 置顶
  await handlers.recall({ id: d.id })   // D 撤回 → backlog
  let st = await handlers.state()
  console.log('[9] 队列状态 → execQueue =', JSON.stringify(st.execQueue), '| backlog 含D =', st.backlog.includes(d.id))
  assert(st.execQueue[0] === e.id, 'E 应置顶到队首')
  assert(!st.execQueue.includes(d.id) && st.backlog.includes(d.id), 'D 应撤回至需求队列')
  pendingRuns.shift()() // C 完成 → pump 取 E
  await sleep(80)
  st = await handlers.state()
  console.log('[10] C 完成后 → E 执行中 =', st.requirements.find((x) => x.id === e.id).stage, '| C =', st.requirements.find((x) => x.id === c.id).stage)
  assert(st.requirements.find((x) => x.id === e.id).stage === 'executing', 'FIFO 依次派发：E 接着执行')
  assert(st.requirements.find((x) => x.id === c.id).stage === 'accepting', 'C 完成进入待验收')
  pendingRuns.shift()() // E 完成
  await sleep(80)

  // 11. remove 删除
  const rm = await handlers.remove({ id: c.id })
  st = await handlers.state()
  console.log('[11] remove →', JSON.stringify(rm), '| 现存需求 =', st.requirements.map((x) => x.id).join(','))
  assert(rm.removed === true && st.requirements.every((x) => x.id !== c.id), '删除生效')

  // 12. 执行器父级为面板专用主 agent（独立 session），prompt 钉死需求绑定工作目录
  const f = await handlers.create({ title: '工作目录验证', description: '验证执行器父级为面板 agent 且目录绑定生效', workdir: '/workspace/dsh-task-panel' })
  await handlers.dispatch({ id: f.id })
  await sleep(30)
  const fReq = startedReqs[startedReqs.length - 1]
  console.log('[12] 执行器 parent =', fReq.parent.id, '| prompt 含绑定目录 =', /\/Users\/jekin\/workplace\/dsh-task-panel/.test(fReq.prompt[0].text))
  assert(fReq.parent && String(fReq.parent.id).startsWith('panel-agent-'), '执行器父级应为面板专用 agent（panel-agent-*）')
  assert(/工作目录/.test(fReq.prompt[0].text) && /\/Users\/jekin\/workplace\/dsh-task-panel/.test(fReq.prompt[0].text), 'prompt 应指明需求绑定的工作目录')
  pendingRuns.shift()() // F 完成
  await sleep(80)
  await handlers.remove({ id: f.id })

  // 12b. workdir 绑定：新建需求不指定 workdir 时默认沿用上次绑定；state 暴露 lastWorkdir
  const g0 = await handlers.create({ title: '目录默认值验证' })
  console.log('[12b] 新建未指定目录 → workdir =', g0.workdir, '| lastWorkdir =', (await handlers.state()).lastWorkdir)
  assert(g0.workdir === '/workspace/dsh-task-panel', '新建需求应默认沿用上次绑定目录')
  const st0 = await handlers.state()
  assert(st0.lastWorkdir === '/workspace/dsh-task-panel', 'state 应暴露 lastWorkdir')
  await handlers.remove({ id: g0.id })

  // 13. 暂停：执行中 pause → 中断 → 已暂停（可恢复）
  const g = await handlers.create({ title: '暂停测试' })
  await handlers.dispatch({ id: g.id })
  await sleep(30)
  let gv = await handlers.get({ id: g.id })
  assert(gv.stage === 'executing', 'G 应处于执行中')
  await handlers.pause({ id: g.id })   // 用户暂停 → dispose 在途 run
  pendingRuns.shift()()                 // 被中断的 run 结算
  await sleep(80)
  gv = await handlers.get({ id: g.id })
  console.log('[13] pause → stage =', gv.stage, '| 产物 =', gv.deliverable)
  assert(gv.stage === 'paused', '暂停后应进入 paused')
  assert(/暂停/.test(gv.deliverable), '执行记录应标记为用户暂停')

  // 14. 恢复：paused → queued → 自动重执行
  await handlers.resume({ id: g.id })
  await sleep(30)
  gv = await handlers.get({ id: g.id })
  console.log('[14] resume → stage =', gv.stage, '| 执行轮次 =', gv.executions.length)
  assert(['queued', 'executing'].includes(gv.stage), '恢复后应重入执行队列')
  assert(gv.executions.length === 2, '恢复执行应新增一轮')
  pendingRuns.shift()() // G 第 2 轮完成
  await sleep(80)
  gv = await handlers.get({ id: g.id })
  assert(gv.stage === 'accepting', '恢复执行完成后进入待验收')

  // 15. 停止：执行中 stop → 中断 → 退回需求队列
  const h = await handlers.create({ title: '停止测试' })
  await handlers.dispatch({ id: h.id })
  await sleep(30)
  await handlers.stop({ id: h.id })
  pendingRuns.shift()() // 被停止的 run 结算
  await sleep(80)
  const hv = await handlers.get({ id: h.id })
  console.log('[15] stop → stage =', hv.stage, '| 产物 =', hv.deliverable)
  assert(hv.stage === 'backlog', '停止后应退回需求队列')
  assert(/停止/.test(hv.deliverable), '执行记录应标记为用户停止')

  // 16. list 工具快照
  console.log('\n✅ 全部断言通过：状态机 + 双队列 + 子 session 派发 + 专用面板 session + 暂停/恢复/停止 全流程正常')
  console.log('注册工具列表:', registeredTools.join(', '))

  // 17. 回归（#RQ-MSTX2QMA-2 返工原因）：未捕获 AbortSignal 时执行器初始化不再失败。
  //     新插件实例不触发 agent/pre-step / tools/execute（AbortSignal 构造器保持未捕获），
  //     派发后应通过「永不中断兜底信号」正常进入 executing（旧代码会报执行器初始化失败）。
  const regListeners = {}
  const regHandlers = {}
  let regRunSeq = 0
  const regPendingRuns = []
  const regStartedReqs = []
  const regCtx = {
    subagents: {
      list: () => ['fork'],
      start: async (provider, request) => {
        // 模拟 harness 对 signal 的消费契约：必须可 throwIfAborted（鸭子类型亦满足）
        if (!request || !request.signal || typeof request.signal.throwIfAborted !== 'function') {
          throw new Error('signal required')
        }
        request.signal.throwIfAborted()
        regRunSeq++
        regStartedReqs.push(request)
        const rid = 'sess-fallback-' + regRunSeq
        let resolveResult
        const result = new Promise((res) => { resolveResult = res })
        regPendingRuns.push(() => resolveResult({
          output: [{ type: 'text', text: '完成：兜底信号执行成功（第 ' + regRunSeq + ' 轮）' }],
          stopReason: 'completed',
        }))
        return { id: rid, result, dispose: async () => {} }
      },
    },
    agents: mockAgents,
    get: (name) => {
      if (name === 'agentPresets') return { composeFrom: (childCtx, parentCtx) => 'default' }
      if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-chat' }) }
      return undefined
    },
    on: (ev, fn) => { (regListeners[ev] = regListeners[ev] || []).push(fn); return () => {} },
    effect: (fn) => { const d = fn(); return typeof d === 'function' ? d : () => {} },
  }
  const regHarness = {
    defineTool: (def) => def,
    registerTool: (c, def) => { registeredTools.push(def.name); return () => {} },
    handle: (method, fn) => { regHandlers[method] = fn; return () => {} },
  }
  const regSandbox = { harness: regHarness, ctx: regCtx, console }
  vm.createContext(regSandbox)
  const plugin2 = await vm.runInContext('(async () => {\n' + src + '\n})()', regSandbox)
  plugin2.apply(regCtx)
  // 关键：不触发任何 agent/pre-step / tools/execute → AbortSignal 构造器从未被捕获
  assert(Object.keys(regListeners).length >= 1, '回归实例应注册事件监听器')
  const rq = await regHandlers.create({ title: 'AbortSignal 兜底回归', description: '验证未捕获 AbortSignal 时执行器仍可初始化' })
  await regHandlers.dispatch({ id: rq.id })
  await sleep(30)
  const rv = await regHandlers.get({ id: rq.id })
  console.log('[17] 未捕获 AbortSignal → stage =', rv.stage, '| 产物 =', rv.deliverable)
  assert(rv.stage === 'executing', '未捕获 AbortSignal 时应通过兜底信号正常初始化（不得报执行器初始化失败）')
  assert(!/初始化失败/.test(rv.deliverable || ''), '不应出现「执行器初始化失败」')
  const sig = regStartedReqs[0] && regStartedReqs[0].signal
  assert(sig && sig.aborted === false && typeof sig.throwIfAborted === 'function', '派发给子 agent 的信号应满足 harness 消费契约')
  regPendingRuns.shift()() // 兜底回归 run 结算
  await sleep(80)
  const rv2 = await regHandlers.get({ id: rq.id })
  assert(rv2.stage === 'accepting' && /兜底信号/.test(rv2.deliverable), '兜底信号执行完成后正常进入待验收')
  console.log('[17b] 兜底信号执行完成 → stage =', rv2.stage, '| 产物 =', rv2.deliverable)

  // 18. 目录选择：browse-dir RPC 列出目录层级（绑定工作目录选择器用）
  const br = await handlers['browse-dir']({ path: '/workspace' })
  console.log('[18] browse-dir → ok =', br && br.ok, '| path =', br && br.path, '| entries =', br && br.entries && br.entries.length)
  assert(br && br.ok === true, 'browse-dir 应成功返回')
  assert(br.path === '/workspace', '应返回目标目录路径')
  assert(Array.isArray(br.entries) && br.entries.some((e) => e.path.includes('dsh-task-panel')), '应列出子目录（含 dsh-task-panel）')
}

main().catch((e) => { console.error('测试异常:', e); process.exit(1) })
