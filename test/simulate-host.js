// ─────────────────────────────────────────────────────────────
// simulate-host.js · 用真实 src/host.js 源码 + mock 服务跑全流程
// 验证：create/update/remove、双队列调度、子 agent 派发(pump)、
//       一句话产物、对话 transcript、验收通过/返工、置顶/撤回。
// 运行：node test/simulate-host.js
// ─────────────────────────────────────────────────────────────
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')

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
const mockSubagents = {
  list: () => ['fork', 'spawn'],
  start: async () => {
    runSeq++
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
  roots: () => [{ id: 'root-agent' }],
  list: () => [{ id: 'root-agent' }],
}

const listeners = {}
const ctx = {
  subagents: mockSubagents,
  agents: mockAgents,
  get: (name) => (name === 'sessionQuery' ? mockSessionQuery : undefined),
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

  // 12. list 工具快照（tools 注册无 schema 校验，此处直接看注册数）
  console.log('\n✅ 全部断言通过：状态机 + 双队列 + 子 session 派发 + 验收/返工 全流程正常')
  console.log('注册工具列表:', registeredTools.join(', '))
}

main().catch((e) => { console.error('测试异常:', e); process.exit(1) })
