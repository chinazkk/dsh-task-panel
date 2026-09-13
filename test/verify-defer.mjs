// 验证 p8 修复：无可用 agent 时返工/派发挂起（不再跳过吞任务），agent 就绪后自动续跑
// 场景 1：全新实例无 agent → dispatch 挂起 → agent/created 就绪 → 自动真正执行
// 场景 2：全新实例（面板 agent 创建失败 → 用根 agent 兜底执行）→ 完成后根 agent 消失 →
//         点返工 → 挂起（不闪回待验收）→ state 轮询探测 agent 就绪 → 自动续跑返工轮
import process from 'node:process'

const LIB = new URL('../lib/index.js', import.meta.url).href
const hostMod = await import(LIB)

const rpcRoute = {}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function assert(cond, msg) {
  if (!cond) { console.error('❌ 断言失败:', msg); process.exit(1) }
  console.log('  ✅', msg)
}

function makeEnv(opts = {}) {
  const env = {
    pendingRuns: [],
    rootAgentReady: false,
    listeners: {},
    panelCreateFails: !!opts.panelCreateFails,
  }
  const ROOT_AGENT = { id: 'root-agent', session: { id: 'root-session', header: { cwd: '/workspace/demo' } }, ctx: {} }
  const mockSessionQuery = {
    searchSessions: async () => ({ items: [] }),
    readSession: async () => ({
      session: { id: 's1' },
      events: [
        { type: 'user/message', seq: 1, time: Date.now(), data: { content: [{ type: 'text', text: '请执行需求...' }] } },
        { type: 'assistant/message', seq: 2, time: Date.now(), data: { message: { id: 'm2', role: 'assistant', content: [{ type: 'text', text: '完成：已创建 demo.txt' }], source: {} } } },
      ],
    }),
  }
  let runSeq = 0
  const mockSubagents = {
    list: () => ['fork', 'spawn'],
    start: async (provider, request) => {
      runSeq++
      const id = 'sess-mock-' + runSeq
      const seq = runSeq
      const isReview = String(request.label || '').startsWith('复核 ')
      let resolveResult
      const result = new Promise((res) => { resolveResult = res })
      env.pendingRuns.push(() => resolveResult(isReview
        ? { structured: { passed: true, verdict: '复核通过', issues: [], suggestions: [] }, output: [{ type: 'text', text: '复核通过' }], stopReason: 'completed' }
        : { structured: { done: true, summary: '完成：已创建 demo.txt（第 ' + seq + ' 轮）', changedFiles: ['demo.txt'], testCommand: '', testResult: '', blocker: '' }, output: [{ type: 'text', text: '完成：已创建 demo.txt（第 ' + seq + ' 轮）' }], stopReason: 'completed' }))
      return { id, result, dispose: async () => {} }
    },
  }
  const mockAgents = {
    currentInitiator: () => null,
    roots: () => (env.rootAgentReady ? [ROOT_AGENT] : []),
    list: () => (env.rootAgentReady ? [ROOT_AGENT] : []),
    create: async (o) => {
      if (env.panelCreateFails) throw new Error('panel agent create failed (mock)')
      return { agent: { id: 'panel-agent', session: { id: o.sessionId, header: { cwd: o.meta?.cwd } }, ctx: {} }, dispose: async () => {} }
    },
  }
  const ctx = {
    subagents: mockSubagents,
    agents: mockAgents,
    tools: { register: () => () => {} },
    get: (name) => {
      if (name === 'sessionQuery') return mockSessionQuery
      if (name === 'fs') return { resolve: async (p) => p, readText: async () => null, writeText: async () => {}, stat: async () => null }
      if (name === 'sandboxPolicy') return { workspaceRoot: '/tmp', resolve: (req) => ({ workspaceRoot: (req && req.session && req.session.header && req.session.header.cwd) || '/tmp' }) }
      if (name === 'systemPrompt') return { section: () => {} }
      if (name === 'agentPresets') return { composeFrom: () => {} }
      if (name === 'agentDefaultModel') return { currentSelection: () => null }
      if (name === 'directoryPicker') return { capability: () => ({ kind: 'browse', list: async () => ({ path: '/', crumbs: [], entries: [] }) }) }
      if (name === 'webServer') return {
        register: (route) => {
          if (route.kind === 'exact' && route.path === '/plugins/dsh-task-panel/rpc') {
            rpcRoute.handler = route.handler
            return () => { rpcRoute.handler = null }
          }
          return () => {}
        },
      }
      return undefined
    },
    on: (ev, fn) => { (env.listeners[ev] = env.listeners[ev] || []).push(fn); return () => {} },
    effect: (fn) => { const d = fn(); return typeof d === 'function' ? d : () => {} },
  }
  hostMod.apply(ctx)
  return env
}

async function rpc(method, args) {
  assert(typeof rpcRoute.handler === 'function', 'RPC 路由已注册')
  let status = 0
  let body = ''
  const req = { [Symbol.asyncIterator]: async function* () { yield JSON.stringify({ method, args: args ?? null }) } }
  const res = { writeHead: (s) => { status = s }, end: (b) => { body = b } }
  await rpcRoute.handler(req, res)
  if (status !== 200) { console.error('❌ RPC ' + method + ' 失败: ' + status + ' ' + body); process.exit(1) }
  return JSON.parse(body || 'null')
}

// ── 场景 1：全新实例，无 agent 时 dispatch 挂起；agent/created 就绪后自动执行 ──
console.log('■ 场景 1：无 agent 时 dispatch → 挂起；agent 就绪（事件）→ 自动执行')
const env1 = makeEnv()
env1.rootAgentReady = false
assert(Array.isArray(env1.listeners['agent/created']) && env1.listeners['agent/created'].length === 1, 'agent/created 监听已注册')

let a = await rpc('create', { title: '挂起验证', description: '在仓库创建 demo.txt，含测试' })
await rpc('dispatch', { id: a.id })
await sleep(60)
a = await rpc('get', { id: a.id })
assert(a.stage === 'queued', '无 agent：需求保持 queued（不被跳过弹回待验收），实际 ' + a.stage)
assert(a.executions.length === 0, '无空执行记录被写入')
assert((a.events || []).some((e) => e.type === 'deferred'), '写入 deferred 事件（暂无可用 agent 会话）')
assert(env1.pendingRuns.length === 0, '未启动子 agent')
let sv = await rpc('state', {})
assert(sv.execQueue.includes(a.id), '需求在执行队列中等待')

for (const fn of env1.listeners['agent/created'] || []) fn({ agent: {} }) // agent 仍未就绪
await sleep(30)
a = await rpc('get', { id: a.id })
assert(a.stage === 'queued' && env1.pendingRuns.length === 0, 'agent 仍未就绪：继续挂起')

env1.rootAgentReady = true
for (const fn of env1.listeners['agent/created'] || []) fn({ agent: {} })
await sleep(100)
a = await rpc('get', { id: a.id })
assert(a.stage === 'executing', 'agent 就绪（agent/created）→ 自动开始执行，实际 ' + a.stage)
assert(env1.pendingRuns.length === 1, '子 agent 已派发')
env1.pendingRuns.shift()()
await sleep(150)
a = await rpc('get', { id: a.id })
assert(a.stage === 'reviewing' || a.stage === 'accepting', '执行完成进入验收链路，实际 ' + a.stage)
assert(a.deliverable.includes('demo.txt'), '真实产物摘要回填')

// ── 场景 2：全新实例（面板 agent 创建失败 → 根 agent 兜底执行）；根 agent 消失后返工 → 挂起 → state 轮询续跑 ──
console.log('■ 场景 2：无 agent 时点返工 → 挂起；state 轮询探测 agent → 自动续跑（返工轮）')
const env2 = makeEnv({ panelCreateFails: true })
env2.rootAgentReady = true

let b = await rpc('create', { title: '返工挂起验证' })
await rpc('dispatch', { id: b.id })
await sleep(100)
assert(env2.pendingRuns.length === 1, '根 agent 兜底：执行已派发（面板 agent 创建失败不阻塞）')
env2.pendingRuns.shift()() // 执行完成
await sleep(150)
if (env2.pendingRuns.length) { env2.pendingRuns.shift()(); await sleep(120) } // 复核完成（若有）
b = await rpc('get', { id: b.id })
assert(b.stage === 'accepting', '进入待验收，实际 ' + b.stage)

env2.rootAgentReady = false // 根 agent 消失（面板 agent 从未创建成功）
b = await rpc('rework', { id: b.id, feedback: '缺少测试用例，请补充单测' })
await sleep(60)
assert(b.stage === 'queued', '无 agent 点返工：保持 queued 挂起（不闪回待验收），实际 ' + b.stage)
assert(b.reworkCount === 1, '返工计数 +1')
b = await rpc('get', { id: b.id })
assert((b.events || []).some((e) => e.type === 'deferred'), '返工挂起也写入 deferred 事件')
assert(env2.pendingRuns.length === 0, '未启动子 agent')

await rpc('state', {}) // agent 仍未就绪：state 轮询不误触发
await sleep(30)
b = await rpc('get', { id: b.id })
assert(b.stage === 'queued', 'agent 未就绪时 state 轮询不误启动')

env2.rootAgentReady = true
await rpc('state', {}) // 面板轮询触发续跑（兜底路径）
await sleep(100)
b = await rpc('get', { id: b.id })
assert(b.stage === 'executing', 'state 轮询探测到 agent → 自动续跑返工轮，实际 ' + b.stage)
env2.pendingRuns.shift()()
await sleep(150)
if (env2.pendingRuns.length) { env2.pendingRuns.shift()(); await sleep(120) }
b = await rpc('get', { id: b.id })
assert(b.stage === 'accepting' || b.stage === 'reviewing', '返工轮执行完成，实际 ' + b.stage)
assert(b.executions[b.executions.length - 1].isRework === true, '本轮标记为返工')
assert(b.executions[b.executions.length - 1].round === 2, '执行轮次为第 2 轮')

console.log('\n✅✅ p8 修复验证通过：返工/派发在无 agent 时挂起等待，agent 就绪后自动真正执行')
