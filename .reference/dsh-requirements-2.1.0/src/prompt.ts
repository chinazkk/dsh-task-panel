// ─────────────────────────────────────────────────────────────
// 三段式系统提示词注入
// 每次 agent/pre-step 注入三层流水线 + 两个队列的实时状态。
// ─────────────────────────────────────────────────────────────

import type { Context } from '@deepseek-ai/dsh'
import type { RequirementsService } from './service.js'

export const name = '@comagic/dsh-requirements/prompt'

export const inject = ['requirements', 'systemPrompt'] as const

export function apply(ctx: Context) {
  const requirements = ctx.requirements as RequirementsService
  const systemPrompt = ctx.systemPrompt as { section(provider: () => string | Promise<string>): () => void }

  systemPrompt.section(async () => {
    const [backlog, queued, executing, accepting, accepted] = await Promise.all([
      requirements.list({ stage: 'backlog' }),
      requirements.list({ stage: 'queued' }),
      requirements.list({ stage: 'executing' }),
      requirements.list({ stage: 'accepting' }),
      requirements.list({ stage: 'accepted' }),
    ])

    const line = (r: { id: string; title: string; priority: string }) =>
      `- #${r.id} [${r.priority}] ${r.title}`

    // 第一段：五列状态概览（两个队列 + 执行/验收/完成）
    const overview = [
      '【需求面板状态】',
      `需求队列 (backlog): ${backlog.length}`,
      ...backlog.slice(0, 10).map(line),
      `执行队列 (queued): ${queued.length}`,
      ...queued.slice(0, 10).map(line),
      `执行中 (executing): ${executing.length}`,
      ...executing.slice(0, 5).map(line),
      `待验收 (accepting): ${accepting.length}`,
      ...accepting.slice(0, 5).map(line),
      `验收完成 (accepted): ${accepted.length}`,
    ].join('\n')

    // 第二段：当前执行中的需求完整上下文
    const active = executing[0]
    const executionContext = active
      ? [
          '',
          `【当前执行需求 #${active.id}「${active.title}」】`,
          `构成要素: ${active.elements.map((e) => e.description).join('；')}`,
          `验收要素: ${active.acceptanceCriteria.map((a) => `[${a.id}] ${a.description}`).join('；')}`,
          active.reworkCount > 0 ? `返工历史: ${active.reworkCount} 次，最近原因「${active.reworkReason ?? ''}」` : '',
        ]
          .filter(Boolean)
          .join('\n')
      : '\n【当前无执行中需求】'

    // 第三段：待验收需求验收指南
    const acceptingGuide = accepting[0]
      ? [
          '',
          `【待验收需求 #${accepting[0].id}「${accepting[0].title}」】`,
          `请对照以下验收要素逐项自检，然后调用 submit_acceptance：`,
          ...accepting[0].acceptanceCriteria.map((a) => `- [${a.id}] ${a.description}`),
        ].join('\n')
      : ''

    return overview + executionContext + acceptingGuide
  })
}