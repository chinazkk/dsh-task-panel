// ─────────────────────────────────────────────────────────────
// RequirementsService：业务逻辑（Consumer）
// 需求队列(backlog) / 执行队列(execQueue) 分离的状态机 + 事件 emit。
// 持久化全部委托给注入的 RequirementsStore。
// ─────────────────────────────────────────────────────────────

import type {
  AcceptanceRecord,
  AcceptanceItem,
  ExecutionAction,
  Requirement,
  RequirementElement,
  RequirementId,
  RequirementInput,
  RequirementStage,
  RequirementsEvents,
  RequirementsStore,
} from './types.js'

/** 从描述文本推断需求构成要素（自动拆解） */
export function decomposeElements(input: RequirementInput): RequirementElement[] {
  const desc = input.description ?? ''
  const cats: RequirementElement['category'][] = []
  if (/api|接口|http|rest|后端|服务|endpoint/i.test(desc)) cats.push('api')
  if (/ui|界面|页面|前端|组件|web|交互/i.test(desc)) cats.push('ui')
  if (/test|测试|单测|集成|用例/i.test(desc)) cats.push('test')
  if (/config|配置|环境/i.test(desc)) cats.push('config')
  if (cats.length === 0) cats.push('feature')
  return cats.map((c, i) => ({
    id: `E${i + 1}`,
    category: c,
    description: `${c}：${input.title} 的实现`,
    scope: input.scope ?? [],
  }))
}

/** 从需求 + 要素生成验收要素（定义"怎么做完"） */
export function generateAcceptanceCriteria(
  _input: RequirementInput,
  elements: RequirementElement[],
): AcceptanceItem[] {
  const list: AcceptanceItem[] = [
    { id: 'A1', category: 'functional', description: '核心功能实现并通过自检', autoCheckable: true },
  ]
  if (elements.some((e) => e.category === 'test')) {
    list.push({ id: 'A2', category: 'test', description: '单元 / 集成测试通过', autoCheckable: true })
  }
  list.push({ id: 'A3', category: 'code_quality', description: '代码规范与可读性达标', autoCheckable: true })
  list.push({ id: 'A4', category: 'user_confirmation', description: '用户验收确认', autoCheckable: false })
  return list
}

export interface RequirementsServiceOptions {
  /** 返工自动重入执行队列的上限，超过后退回需求队列。默认 5。 */
  maxRework?: number
}

export class RequirementsService {
  private readonly maxRework: number
  private loaded = false
  private backlog: RequirementId[] = []
  private execQueue: RequirementId[] = []

  constructor(
    private readonly ctx: { requirementsStore: RequirementsStore; emit: EmitFn },
    options: RequirementsServiceOptions = {},
  ) {
    this.maxRework = options.maxRework ?? 5
  }

  private get store(): RequirementsStore {
    return this.ctx.requirementsStore
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    const q = await this.store.readQueues()
    this.backlog = q.backlog
    this.execQueue = q.execQueue
    this.loaded = true
  }

  private async persistQueues(): Promise<void> {
    await this.store.writeQueues({ backlog: this.backlog, execQueue: this.execQueue })
  }

  // ── 需求层：创建 → 需求队列（不自动执行） ────────────────
  async create(input: RequirementInput): Promise<Requirement> {
    const elements = decomposeElements(input)
    const acceptanceCriteria =
      input.acceptanceCriteria && input.acceptanceCriteria.length > 0
        ? input.acceptanceCriteria
        : generateAcceptanceCriteria(input, elements)
    const req: Requirement = {
      id: `RQ-${Date.now()}` as RequirementId,
      title: input.title,
      description: input.description ?? '',
      priority: input.priority ?? 'medium',
      stage: 'backlog',
      elements,
      scope: input.scope ?? [],
      dependencies: input.dependencies ?? [],
      acceptanceCriteria,
      contextAnchors: input.contextAnchors ?? [],
      executions: [],
      acceptances: [],
      reworkCount: 0,
      reworkReason: null,
      createdBy: input.createdBy ?? 'user',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      version: 1,
      command: input.command ?? null,
    }
    await this.store.save(req)
    await this.ensureLoaded()
    if (!this.backlog.includes(req.id)) this.backlog.push(req.id)
    await this.persistQueues()
    this.ctx.emit('requirement/created', req)
    return req
  }

  // ── 执行队列调度 ─────────────────────────────────────
  async dispatchToExec(id: RequirementId): Promise<void> {
    const req = await this.store.get(id)
    await this.ensureLoaded()
    const bi = this.backlog.indexOf(id)
    if (bi >= 0) this.backlog.splice(bi, 1)
    if (
      this.execQueue.indexOf(id) < 0 &&
      req.stage !== 'executing' &&
      req.stage !== 'accepting' &&
      req.stage !== 'accepted'
    ) {
      this.execQueue.push(id)
      await this.store.update(id, { stage: 'queued' })
      await this.persistQueues()
      this.ctx.emit('requirement/queued', id) // → 队列 worker 派发
    }
  }

  async recallFromExec(id: RequirementId): Promise<void> {
    await this.ensureLoaded()
    const ei = this.execQueue.indexOf(id)
    if (ei >= 0) {
      this.execQueue.splice(ei, 1)
      if (!this.backlog.includes(id)) this.backlog.push(id)
      await this.store.update(id, { stage: 'backlog' })
      await this.persistQueues()
    }
  }

  async moveExec(id: RequirementId, toIndex: number): Promise<void> {
    await this.ensureLoaded()
    const ei = this.execQueue.indexOf(id)
    if (ei < 0 || ei === toIndex) return
    this.execQueue.splice(ei, 1)
    let target = toIndex
    if (ei < toIndex) target = toIndex - 1
    target = Math.max(0, Math.min(target, this.execQueue.length))
    this.execQueue.splice(target, 0, id)
    await this.persistQueues()
  }

  async moveExecTop(id: RequirementId): Promise<void> {
    await this.ensureLoaded()
    const ei = this.execQueue.indexOf(id)
    if (ei < 0) return
    this.execQueue.splice(ei, 1)
    this.execQueue.unshift(id)
    await this.persistQueues()
  }

  /** 队列 worker 取队首执行 */
  async dequeueExec(): Promise<RequirementId | null> {
    await this.ensureLoaded()
    const id = this.execQueue.shift() ?? null
    await this.persistQueues()
    return id
  }

  /** 返工自动重入队尾 */
  async enqueueExec(id: RequirementId): Promise<void> {
    await this.ensureLoaded()
    if (!this.execQueue.includes(id)) this.execQueue.push(id)
    await this.persistQueues()
  }

  async getBacklog(): Promise<RequirementId[]> {
    await this.ensureLoaded()
    return this.backlog.slice()
  }

  async getExecQueue(): Promise<RequirementId[]> {
    await this.ensureLoaded()
    return this.execQueue.slice()
  }

  // ── 执行层 ─────────────────────────────────────────────
  async startExecution(id: RequirementId): Promise<void> {
    const req = await this.store.get(id)
    const round = req.reworkCount + 1
    req.executions.push({
      round,
      startedAt: Date.now(),
      actions: [],
      summary: '',
      isRework: round > 1,
      reworkReason: req.reworkReason ?? undefined,
    })
    req.stage = 'executing'
    await this.store.update(id, { stage: 'executing', executions: req.executions })
    this.ctx.emit('requirement/executing', id, round)
  }

  async recordAction(id: RequirementId, action: ExecutionAction): Promise<void> {
    const req = await this.store.get(id)
    const exec = req.executions[req.executions.length - 1]
    if (exec) {
      exec.actions.push(action)
      await this.store.update(id, { executions: req.executions })
    }
  }

  async completeExecution(id: RequirementId, summary: string): Promise<void> {
    const req = await this.store.get(id)
    const exec = req.executions[req.executions.length - 1]
    if (exec) {
      exec.completedAt = Date.now()
      exec.summary = summary
    }
    await this.store.update(id, { stage: 'accepting', executions: req.executions })
    this.ctx.emit('requirement/accepting', id)
  }

  // ── 验收层 ─────────────────────────────────────────────
  async submitAcceptance(id: RequirementId, record: AcceptanceRecord): Promise<void> {
    const req = await this.store.get(id)
    req.acceptances.push(record)
    if (record.overall === 'passed') {
      await this.store.update(id, { stage: 'accepted', acceptances: req.acceptances })
      this.ctx.emit('requirement/accepted', id)
    } else {
      const reworkReason = record.reworkSuggestion ?? record.failedItems?.join(', ') ?? ''
      const nextRework = req.reworkCount + 1
      if (nextRework < this.maxRework) {
        // 自动重入执行队列（队尾）
        await this.store.update(id, {
          stage: 'queued',
          reworkCount: nextRework,
          reworkReason,
          acceptances: req.acceptances,
        })
        await this.enqueueExec(id)
      } else {
        // 返工达上限 → 退回需求队列
        await this.store.update(id, {
          stage: 'backlog',
          reworkCount: nextRework,
          reworkReason,
          acceptances: req.acceptances,
        })
        await this.ensureLoaded()
        if (!this.backlog.includes(id)) this.backlog.push(id)
        await this.persistQueues()
      }
      this.ctx.emit('requirement/rework', id, reworkReason)
    }
  }

  // ── 查询 ─────────────────────────────────────────────
  get(id: RequirementId): Promise<Requirement> {
    return this.store.get(id)
  }
  update(id: RequirementId, patch: Partial<Requirement>): Promise<void> {
    return this.store.update(id, patch)
  }
  list(filter?: { stage?: RequirementStage }): Promise<Requirement[]> {
    return this.store.list(filter)
  }
  remove(id: RequirementId): Promise<void> {
    return this.store.remove(id)
  }
}

type EmitFn = <K extends keyof RequirementsEvents>(name: K, ...args: Parameters<RequirementsEvents[K]>) => void

export type { RequirementId, RequirementStage }
export type RequirementsAction = ExecutionAction