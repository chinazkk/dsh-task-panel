// ─────────────────────────────────────────────────────────────
// Agent 工具（Consumer）
// 6 个工具覆盖完整生命周期：
//   propose_requirement / dispatch_requirement / list_requirements
//   / get_requirement / complete_execution / submit_acceptance
// ─────────────────────────────────────────────────────────────

import type { Context } from '@deepseek-ai/dsh'
import type { RequirementsService } from './service.js'
import type { AcceptanceResult } from './types.js'

export const name = '@comagic/dsh-requirements/tools'

export const inject = ['requirements', 'tools'] as const

export function apply(ctx: Context) {
  const requirements = ctx.requirements as RequirementsService
  const tools = ctx.tools as { register(definition: ToolDefinition): () => void }

  tools.register(
    defineTool({
      name: 'propose_requirement',
      description: '提出一个需求：自动拆解构成要素与验收要素，进入需求队列（不自动执行）。',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '需求标题' },
          description: { type: 'string', description: '详细描述（背景/目标/约束）' },
          priority: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          scope: { type: 'array', items: { type: 'string' }, description: '涉及模块/文件' },
          dependencies: { type: 'array', items: { type: 'string' }, description: '前置需求 ID' },
          command: { type: 'string', description: '可选：执行时运行的命令' },
        },
        required: ['title'],
      },
      async execute(args: any) {
        const req = await requirements.create(args)
        return `已提出需求 ${req.id}「${req.title}」，拆解 ${req.elements.length} 个构成要素、${req.acceptanceCriteria.length} 项验收要素，已进入需求队列（不自动执行）。调用 dispatch_requirement 丢到执行队列后开始执行。`
      },
    }),
  )

  tools.register(
    defineTool({
      name: 'dispatch_requirement',
      description: '将需求从需求队列丢到执行队列，排队执行。',
      parameters: {
        type: 'object',
        properties: { requirementId: { type: 'string' } },
        required: ['requirementId'],
      },
      async execute(args: any) {
        await requirements.dispatchToExec(args.requirementId)
        return `需求 ${args.requirementId} 已丢入执行队列排队执行。`
      },
    }),
  )

  tools.register(
    defineTool({
      name: 'list_requirements',
      description: '按阶段查询需求列表（backlog/queued/executing/accepting/accepted）。',
      parameters: {
        type: 'object',
        properties: { stage: { type: 'string', description: '可选，过滤阶段' } },
      },
      async execute(args: any) {
        const list = await requirements.list(args.stage ? { stage: args.stage } : {})
        return list.map((r) => ({
          id: r.id,
          title: r.title,
          priority: r.priority,
          stage: r.stage,
          reworkCount: r.reworkCount,
        }))
      },
    }),
  )

  tools.register(
    defineTool({
      name: 'get_requirement',
      description: '查看单个需求的完整上下文（构成要素、验收要素、执行与验收历史、返工记录）。',
      parameters: {
        type: 'object',
        properties: { requirementId: { type: 'string' } },
        required: ['requirementId'],
      },
      async execute(args: any) {
        const r = await requirements.get(args.requirementId)
        return r ? JSON.stringify(r) : `未找到需求 ${args.requirementId}`
      },
    }),
  )

  tools.register(
    defineTool({
      name: 'complete_execution',
      description: '标记需求执行完成并提交验收（附执行总结）。',
      parameters: {
        type: 'object',
        properties: {
          requirementId: { type: 'string' },
          summary: { type: 'string', description: '执行总结' },
        },
        required: ['requirementId'],
      },
      async execute(args: any) {
        await requirements.completeExecution(args.requirementId, args.summary ?? '')
        return `需求 ${args.requirementId} 已提交验收。`
      },
    }),
  )

  tools.register(
    defineTool({
      name: 'submit_acceptance',
      description:
        '提交需求验收结果。逐项检查验收要素，全部通过进入验收完成队列，任一失败则自动重入执行队列返工。',
      parameters: {
        type: 'object',
        properties: {
          requirementId: { type: 'string' },
          results: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                itemId: { type: 'string' },
                passed: { type: 'boolean' },
                detail: { type: 'string', description: '验证过程描述' },
              },
            },
          },
          summary: { type: 'string', description: 'Agent 验收总结' },
          reworkSuggestion: { type: 'string', description: '失败时的修复建议' },
        },
        required: ['requirementId', 'results'],
      },
      async execute(args: any) {
        const results = args.results as AcceptanceResult[]
        const allPassed = results.every((r) => r.passed)
        const req = await requirements.get(args.requirementId)
        await requirements.submitAcceptance(args.requirementId, {
          round: req.reworkCount + 1,
          items: results,
          overall: allPassed ? 'passed' : 'failed',
          agentSummary: args.summary ?? '',
          failedItems: results.filter((r) => !r.passed).map((r) => r.itemId),
          reworkSuggestion: args.reworkSuggestion,
        })
        return allPassed
          ? '需求验收通过，已进入验收完成队列。'
          : `需求验收未通过，已自动重入执行队列返工。失败项: ${results
              .filter((r) => !r.passed)
              .map((r) => r.itemId)
              .join(', ')}`
      },
    }),
  )
}

// defineTool 来自宿主 harness；此处仅作类型占位，真实运行时由宿主注入。
declare function defineTool(def: any): any