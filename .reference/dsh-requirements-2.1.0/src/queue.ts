// ─────────────────────────────────────────────────────────────
// 任务队列派发器（Consumer）
// 监听 queued/rework 事件 → 从执行队列出队 → 串行派发到新会话子 agent 执行。
// 执行完成(accepting)即释放队列并派发下一个——待验收不阻塞队列；
// 返工(rework) 自动重入队尾后继续派发。
// ─────────────────────────────────────────────────────────────

import type { Context } from '@deepseek-ai/dsh'
import type { Requirement, RequirementId } from './types.js'
import type { RequirementsService } from './service.js'

export interface QueuePluginOptions {
  /** 子 agent 执行提示词模板 */
  prompt?: (req: Requirement) => string
}

export const name = '@comagic/dsh-requirements/queue'

export const inject = ['requirements', 'subagents', 'agents'] as const

export function apply(ctx: Context, options: QueuePluginOptions = {}) {
  const requirements = ctx.requirements as RequirementsService
  const subagents = ctx.subagents as {
    list(): string[]
    start(name: string, request: SubagentStartRequest): Promise<SubagentRun>
  }
  const agents = ctx.agents as {
    currentInitiator(): AgentLike | undefined
    roots(): AgentLike[]
    list(): AgentLike[]
  }

  let busy = false // 是否已有需求在执行（串行）

  const buildPrompt =
    options.prompt ??
    ((req: Requirement) => {
      const lines = [
        `请执行需求 #${req.id}「${req.title}」。`,
        req.description ? `描述：${req.description}` : '',
        `优先级：${req.priority}`,
        req.scope.length ? `涉及范围：${req.scope.join(', ')}` : '',
        `构成要素：${req.elements.map((e) => e.description).join('；')}`,
        `验收要素：${req.acceptanceCriteria.map((a) => `[${a.id}] ${a.description}`).join('；')}`,
        req.command ? `如需验证请运行命令：${req.command}` : '',
        req.reworkCount > 0 && req.reworkReason
          ? `这是第 ${req.reworkCount + 1} 轮执行，请针对返工原因修复：${req.reworkReason}`
          : '',
        '请在你的会话中实际完成该需求（读代码、修改文件、运行测试等），最后用一段话总结你做了什么。',
      ]
      return lines.filter(Boolean).join('\n')
    })

  function resolveParent(): AgentLike | undefined {
    try {
      const initiator = agents.currentInitiator()
      if (initiator) return initiator
    } catch {
      /* noop */
    }
    return agents.roots()[0] ?? agents.list()[0]
  }

  function resolveProvider(): string {
    const names = subagents.list()
    return names.includes('fork') ? 'fork' : names.includes('spawn') ? 'spawn' : names[0] ?? 'fork'
  }

  function extractOutput(blocks: unknown): string {
    if (!Array.isArray(blocks)) return ''
    return blocks
      .filter((b): b is { text: string } => !!b && typeof (b as { text?: unknown }).text === 'string')
      .map((b) => b.text)
      .join('\n')
      .slice(0, 2000)
  }

  // ── 串行派发：一次只执行一个；执行完成即释放，待验收不阻塞队列 ──
  async function pump(): Promise<void> {
    if (busy) return
    const id = await requirements.dequeueExec()
    if (!id) return

    busy = true
    await requirements.startExecution(id) // → executing

    const req = await requirements.get(id)
    const parent = resolveParent()
    if (!parent || !subagents) {
      // 无子 agent seam 时，仅完成状态流转（执行留给调用方）
      await requirements.completeExecution(id, '（未挂子 agent，已跳过真实执行）')
      busy = false // 执行完成即释放，待验收不阻塞队列
      void pump()
      return
    }

    try {
      const run = await subagents.start(resolveProvider(), {
        label: `执行 ${req.id} ${req.title}`,
        prompt: [{ type: 'text', text: buildPrompt(req) }],
        parent,
        signal: new AbortController().signal,
      })
      const result = await run.result
      const summary =
        extractOutput(result.output) || `新会话执行完成（stopReason=${result.stopReason}）`
      await run.dispose()
      await requirements.completeExecution(id, summary)
    } catch (err) {
      await requirements.completeExecution(id, `执行异常：${String(err instanceof Error ? err.message : err)}`)
    } finally {
      busy = false // 执行完成即释放队列，待验收（accepting）不再阻塞
      void pump() // 立即派发下一个任务
    }
  }

  // ── 需求丢入执行队列 → 派发 ─────────────────────────────
  ctx.on('requirement/queued', () => {
    void pump()
  })

  // ── 返工自动重入队尾 → 继续派发 ──────────────────────────
  ctx.on('requirement/rework', () => {
    void pump()
  })
}

// ── 最小类型形状（与 dsh-subagent 契约对齐，避免强依赖） ──
interface AgentLike {
  [key: string]: unknown
}

interface SubagentStartRequest {
  label?: string
  prompt: { type: 'text'; text: string }[]
  parent: AgentLike
  signal: AbortSignal
  [key: string]: unknown
}

interface SubagentResult {
  output: { type: string; text?: string }[]
  stopReason: string
}

interface SubagentRun {
  id: string
  result: Promise<SubagentResult>
  dispose(): Promise<void>
}

export type { RequirementId }