// ─────────────────────────────────────────────────────────────
// simulate-host.js · 用构建产物 lib/（bundle 形态）跑全流程冒烟测试
// 验证（bundle 形态）：
//   1) host 插件 apply 激活（inject 声明 / 事件钩子 / 工具注册 ×8）
//   2) client↔host RPC 桥：webServer 路由注册 + HTTP handler 逐方法调用
//   3) 需求 create/update/remove、双队列调度、子 agent 派发(pump)、
//      一句话产物、对话 transcript、验收通过/返工、置顶/撤回、
//      AbortSignal 兜底（未捕获信号时执行器仍能初始化）
//   4) client bundle（lib/client.js）__ModuleLoader__ handoff：
//      factory 返回 {name,inject,apply}，apply 注册 conversation.view 槽位
// 运行：npm test（或 node test/simulate-host.js）
// ─────────────────────────────────────────────────────────────
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(__dirname, '..')

// ── 构建产物（bundle 形态） ────────────────────────────────
const hostMod = await import(path.join(repoRoot, 'lib', 'index.js'))

// ── mocks ──────────────────────────────────────────────────
const registeredTools = [] // 记录 ctx.tools.register 收到的工具定义
const rpcRoute = {}        // webServer.register 捕获的 RPC 路由
let promptSection = null   // systemPrompt.section 捕获的回调

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
  tools: {
    register: (def) => { registeredTools.push(def); return () => {} },
  },
  get: (name) => {
    if (name === 'sessionQuery') return mockSessionQuery
    if (name === 'fs') return {
      resolve: async (p) => p,
      readText: async () => null,
      writeText: async () => {},
      stat: async () => null,
    }
    if (name === 'sandboxPolicy') return { workspaceRoot: '/tmp', resolve: () => ({ workspaceRoot: '/tmp' }) }
    if (name === 'systemPrompt') return { section: (cb) => { promptSection = cb } }
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
  on: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); return () => {} },
  effect: (fn) => { const d = fn(); return typeof d === 'function' ? d : () => {} },
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function assert(cond, msg) {
  if (!cond) { console.error('❌ 断言失败:', msg); process.exit(1) }
}

// ── 通过 webServer RPC 路由调用 host 方法（与浏览器 client 完全同路径） ──
async function rpc(method, args) {
  assert(typeof rpcRoute.handler === 'function', 'RPC 路由未注册（webServer.register 未捕获）')
  let status = 0
  let body = ''
  const req = {
    [Symbol.asyncIterator]: async function* () { yield JSON.stringify({ method, args: args ?? null }) },
  }
  const res = {
    writeHead: (s) => { status = s },
    end: (b) => { body = b },
  }
  await rpcRoute.handler(req, res)
  assert(status === 200, 'RPC ' + method + ' 应返回 200，实际 ' + status + '（' + body + '）')
  return JSON.parse(body || 'null')
}

async function main() {
  // ── Host 半 ─────────────────────────────────────────────
  console.log('■ Host bundle:', path.relative(repoRoot, 'lib/index.js'))
  console.log('  name =', hostMod.name, '| inject =', JSON.stringify(hostMod.inject))
  assert(hostMod.name === 'dsh-task-panel', 'bundle 应导出 name=dsh-task-panel')
  assert(Array.isArray(hostMod.inject) && hostMod.inject.includes('subagents') && hostMod.inject.includes('agents') && hostMod.inject.includes('tools'), 'inject 应含 subagents/agents/tools')
  hostMod.apply(ctx)
  console.log('✅ apply 激活 | 工具数 =', registeredTools.length, '| 事件钩子 =', Object.keys(listeners).join(','))
  assert(registeredTools.length === 8, '应注册 8 个 Agent 工具，实际 ' + registeredTools.length)
  const toolNames = registeredTools.map((t) => t.name)
  for (const n of ['propose_requirement', 'edit_requirement', 'delete_requirement', 'dispatch_requirement', 'list_requirements', 'get_requirement', 'complete_execution', 'submit_acceptance']) {
    assert(toolNames.includes(n), '缺少工具 ' + n)
  }
  assert(typeof rpcRoute.handler === 'function', 'RPC 路由应在 apply 时注册（webServer 可用）')

  // 模拟 agent/pre-step 事件 → 注入 AbortSignal 构造器
  for (const fn of listeners['agent/pre-step'] || []) await fn({ signal: AbortSignal.timeout(60000) }, () => 'next')
  console.log('✅ 已注入 AbortSignal（来自 agent/pre-step）')

  // 1. create → backlog
  let a = await rpc('create', { title: '创建测试文件', description: '在仓库创建 demo.txt，内容 ok，含测试', priority: 'high', scope: ['src/'] })
  console.log('\n[1] create →', a.id, '| stage =', a.stage, '| 要素 =', a.elements.map((e) => e.category).join(','), '| 验收 =', a.acceptanceCriteria.length)
  assert(a.stage === 'backlog', 'create 后应在 backlog')
  assert(a.elements.length >= 1 && a.acceptanceCriteria.length >= 1, '应自动拆解要素与验收')

  // 2. update 编辑
  a = await rpc('update', { id: a.id, title: '创建测试文件（已编辑）', description: '改后的描述' })
  console.log('[2] update →', a.title, '| 描述 =', a.description)
  assert(a.title === '创建测试文件（已编辑）', 'update 应生效')

  // 3. set-workdir 绑定
  const wd = await rpc('set-workdir', { workdir: '/workspace/dsh-task-panel' })
  console.log('[2b] set-workdir →', JSON.stringify(wd))
  assert(wd.ok === true && wd.lastWorkdir === '/workspace/dsh-task-panel', 'set-workdir 应生效')

  // 4. dispatch → executing（手动控制完成）
  await rpc('dispatch', { id: a.id })
  await sleep(30)
  a = await rpc('get', { id: a.id })
  console.log('[3] dispatch 后 stage =', a.stage)
  assert(a.stage === 'executing', '子 agent 执行中')
  assert(pendingRuns.length === 1, '应派发一个子 agent')
  assert(a.lastSessionId === 'sess-mock-1', '执行启动后应立即回填会话 id（执行中可追踪）')
  assert(startedReqs[0].signal && startedReqs[0].parent, '子 agent 请求应携带 signal 与 parent')

  // 5. 实时进度：executing 时 progress RPC 返回会话 id / 父会话 id / 最近对话
  const prog = await rpc('progress', {})
  const p0 = prog.find((p) => p.id === a.id)
  console.log('[3b] progress →', JSON.stringify(p0 ? { id: p0.id, sessionId: p0.sessionId, parentSessionId: p0.parentSessionId, recent: p0.recent.length } : null))
  assert(p0 && p0.sessionId === 'sess-mock-1', 'progress 应返回执行中会话 id')
  assert(p0 && p0.recent.length >= 1, 'progress 应返回最近对话片段')

  // 6. 完成执行 → accepting + 一句话产物 + transcript
  pendingRuns.shift()()
  await sleep(80)
  a = await rpc('get', { id: a.id })
  console.log('[4] 完成后 stage =', a.stage, '| 产物 =', a.deliverable)
  console.log('     sessionId =', a.lastSessionId, '| 执行轮次 =', a.executions.length)
  assert(a.stage === 'accepting', '完成后进入 accepting')
  assert(a.deliverable.includes('demo.txt'), '一句话产物应为交付摘要')
  assert(a.lastSessionId === 'sess-mock-1', '记录子 session id')

  // 7. 查看对话
  const conv = await rpc('conversation', { id: a.id, sessionId: a.lastSessionId })
  console.log('[5] conversation →', conv.transcript.length, '条消息')
  assert(conv.transcript.length === 3, '应捕获 3 条对话消息')

  // 8. accept → accepted
  a = await rpc('accept', { id: a.id })
  console.log('[6] accept → stage =', a.stage)
  assert(a.stage === 'accepted', '验收通过进入 accepted')

  // 9. 返工流程：B 执行完 → rework(feedback) → 自动重入队列重执行
  const b = await rpc('create', { title: '返工测试', description: '需要测试用例验证' })
  await rpc('dispatch', { id: b.id })
  await sleep(30)
  pendingRuns.shift()() // B 第 1 轮完成
  await sleep(80)
  let bv = await rpc('get', { id: b.id })
  assert(bv.stage === 'accepting', 'B 首轮完成应 accepting')
  bv = await rpc('rework', { id: b.id, feedback: '缺少测试用例，请补充单测' })
  console.log('[7] rework → stage =', bv.stage, '| 返工 =', bv.reworkCount, '| 原因 =', bv.reworkReason)
  assert(['queued', 'executing'].includes(bv.stage), '返工后应重入执行队列（queued→executing）')
  assert(bv.reworkCount === 1, '返工次数应为 1')
  await sleep(30)
  assert(pendingRuns.length === 1, '返工应自动派发第 2 轮子 agent')
  pendingRuns.shift()() // B 第 2 轮完成
  await sleep(80)
  const b2 = await rpc('get', { id: b.id })
  console.log('[8] 返工自动重执行 → stage =', b2.stage, '| 执行轮次 =', b2.executions.length, '| 第2轮返工标记 =', b2.executions[1].isRework)
  assert(b2.stage === 'accepting' && b2.executions.length === 2, '返工自动重执行并回 accepting')
  assert(b2.executions[1].isRework === true, '第 2 轮标记为返工')

  // 10. 队列排序：C/D/E 并发丢入，测试 top / recall
  const c = await rpc('create', { title: 'C' })
  const d = await rpc('create', { title: 'D' })
  const e = await rpc('create', { title: 'E' })
  await rpc('dispatch', { id: c.id })
  await rpc('dispatch', { id: d.id })
  await rpc('dispatch', { id: e.id })
  await sleep(30)
  let sv = await rpc('state', {})
  console.log('[9] 队列 =', JSON.stringify({ backlog: sv.backlog, execQueue: sv.execQueue }))
  assert(sv.execQueue.length === 2, '三需求丢入后：1 个正在执行（C），2 个排队（D/E）')
  const execNow = sv.requirements.find((r) => r.stage === 'executing')
  assert(execNow && execNow.id === c.id, 'C 应立即开始执行')
  await rpc('top', { id: e.id })
  await rpc('recall', { id: d.id })
  await sleep(30)
  sv = await rpc('state', {})
  console.log('[10] top/recall 后队列 =', JSON.stringify({ backlog: sv.backlog, execQueue: sv.execQueue }))
  assert(sv.execQueue[0] === e.id, 'top 后 E 应在队首')
  assert(sv.backlog.includes(d.id), 'recall 后 D 应退回需求队列')

  // 11. 完成剩余任务 C/E，验收通过
  while (pendingRuns.length) { pendingRuns.shift()(); await sleep(50) }
  await sleep(80)
  sv = await rpc('state', {})
  const left = sv.requirements.filter((r) => r.stage === 'executing' || r.stage === 'queued')
  console.log('[11] 全部完成后 stage 分布 =', JSON.stringify(sv.requirements.map((r) => r.id + ':' + r.stage)))
  assert(left.length === 0, 'C/E 均完成执行（D 已在第 10 步撤回 backlog）')

  // 12. list_requirements 工具 execute（走 harness.defineTool 归一化后的 schema）
  const listTool = registeredTools.find((t) => t.name === 'list_requirements')
  assert(listTool && typeof listTool.execute === 'function', 'list_requirements 应带 execute')
  const listOut = await listTool.execute({})
  console.log('[12] list_requirements →', String(listOut).split('\n')[0])
  assert(typeof listOut === 'string' && listOut.includes('RQ-'), '工具输出应包含需求')

  // 13. 系统提示词段落（systemPrompt.section 回调）
  assert(typeof promptSection === 'function', 'systemPrompt.section 应被注册')
  const promptText = await promptSection()
  console.log('[13] 提示词段落 →', promptText.split('\n')[0], '（共', promptText.split('\n').length, '行）')
  assert(promptText.includes('需求面板状态'), '提示词段落应含面板状态')

  // 14. 目录选择 RPC（browse-dir）
  const bd = await rpc('browse-dir', { path: '/workspace' })
  console.log('[14] browse-dir → ok =', bd.ok, '| entries =', bd.entries && bd.entries.length)
  assert(bd.ok === true && Array.isArray(bd.entries), 'browse-dir 应可用')

  // 15. remove
  const rm = await rpc('remove', { id: c.id })
  const sv2 = await rpc('state', {})
  console.log('[15] remove →', JSON.stringify(rm), '| 剩余需求 =', sv2.requirements.length)
  assert(rm.removed === true && !sv2.requirements.some((r) => r.id === c.id), 'remove 应生效')

  // ── Client 半（bundle handoff） ──────────────────────────
  console.log('\n■ Client bundle: lib/client.js')
  const clientSrc = fs.readFileSync(path.join(repoRoot, 'lib', 'client.js'), 'utf8')
  assert(clientSrc.includes('window.__ModuleLoader__.load({'), 'client bundle 应以 __ModuleLoader__.load 注册')
  assert(clientSrc.includes('"dsh-task-panel"'), 'client bundle 应携带插件 id dsh-task-panel')
  let handoff = null
  const sandbox = {
    window: { __ModuleLoader__: { load: (h) => { handoff = h } } },
    document: {
      createElement: () => ({ textContent: '', remove: () => {} }),
      head: { appendChild: () => {} },
    },
    console,
  }
  vm.createContext(sandbox)
  vm.runInContext(clientSrc, sandbox)
  assert(handoff && handoff.id === 'dsh-task-panel', 'client bundle 应触发 handoff（id=dsh-task-panel）')
  const clientMod = handoff.factory((spec) => {
    if (spec === 'react' || spec === 'react/jsx-runtime') return { createElement: () => ({}) }
    if (spec === '@deepseek-ai/cordis') return {}
    return {}
  })
  console.log('  handoff exports =', Object.keys(clientMod), '| inject =', JSON.stringify(clientMod.inject))
  assert(clientMod.name === 'dsh-task-panel' && typeof clientMod.apply === 'function', 'client 模块应导出 name/apply')
  assert(Array.isArray(clientMod.inject) && clientMod.inject.includes('slots') && clientMod.inject.includes('sessions'), 'client inject 应含 slots/sessions')

  let injectedSlot = null
  let registeredSlot = null
  const clientCtx = {
    get: (k) => {
      if (k === 'slots') return {
        inject: (key, cb) => { injectedSlot = { key, cb }; return () => {} },
        register: (options, component) => { registeredSlot = { options, component }; return () => {} },
      }
      if (k === 'sessions') return { openSubagent: () => {}, list: () => [] }
      return undefined
    },
  }
  clientMod.apply(clientCtx)
  assert(injectedSlot && injectedSlot.key === 'conversation.view', 'client apply 应注入 conversation.view 槽位')
  const viewEntry = injectedSlot.cb()
  assert(viewEntry && registeredSlot && registeredSlot.options.id === 'dsh-task-panel' && registeredSlot.options.label === '任务面板', '槽位注册应为「任务面板」标签页')
  console.log('✅ client apply → 注册「任务面板」会话标签页（order=' + registeredSlot.options.order + '）')

  console.log('\n✅✅ 全部断言通过：bundle 形态 host + client 冒烟测试通过')
}

main().catch((e) => { console.error('❌ 测试异常:', e); process.exit(1) })
