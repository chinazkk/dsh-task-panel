// ─────────────────────────────────────────────────────────────
// 数据模型 + 领域事件声明（Definition 包）
// 对应需求面板三层流水线 + 需求队列/执行队列分离
// ─────────────────────────────────────────────────────────────

export type RequirementId = string & { readonly __brand: 'RequirementId' }

/**
 * 需求生命周期阶段。
 * 需求队列(backlog)与执行队列(queued)分离：backlog 不自动执行，
 * 只有丢入执行队列(queued)才排队执行；rework 为返工瞬时态（自动重入 queued）。
 */
export type RequirementStage =
  | 'backlog' // 需求队列：等待人工丢入执行队列（不自动执行）
  | 'queued' // 执行队列：已排队，等待串行派发
  | 'executing' // 执行层：子 agent 新会话执行中
  | 'accepting' // 验收层：等待验收
  | 'rework' // 返工瞬时态：验收失败，自动重入执行队列
  | 'accepted' // 完成：进入验收完成队列

export type Priority = 'critical' | 'high' | 'medium' | 'low'

export type ElementCategory = 'feature' | 'api' | 'ui' | 'test' | 'config' | 'other'
export type AcceptanceCategory =
  | 'functional'
  | 'test'
  | 'code_quality'
  | 'documentation'
  | 'performance'
  | 'user_confirmation'

export interface RequirementElement {
  id: string
  category: ElementCategory
  description: string
  scope: string[]
}

export interface AcceptanceItem {
  id: string
  category: AcceptanceCategory
  description: string
  autoCheckable: boolean
}

export interface ContextAnchor {
  type: 'session_event' | 'code_location' | 'file_reference'
  ref: string
  description?: string
}

export interface ExecutionAction {
  type: 'code_change' | 'tool_call' | 'file_create' | 'file_edit' | 'test_run'
  description: string
  toolCallId?: string
  timestamp: number
}

export interface ExecutionRecord {
  round: number
  startedAt: number
  completedAt?: number
  actions: ExecutionAction[]
  summary: string
  isRework: boolean
  reworkReason?: string
  /** 执行所用子 agent 的 session id（新会话执行 seam） */
  sessionId?: string | null
}

export interface AcceptanceResult {
  itemId: string
  passed: boolean
  detail: string
}

export interface AcceptanceRecord {
  round: number
  items: AcceptanceResult[]
  overall: 'passed' | 'failed'
  agentSummary: string
  userConfirmed?: boolean
  failedItems?: string[]
  reworkSuggestion?: string
  timestamp: number
}

export interface Requirement {
  id: RequirementId
  title: string
  description: string
  priority: Priority
  stage: RequirementStage

  // 需求构成要素（需求层自动拆解）
  elements: RequirementElement[]
  scope: string[]
  dependencies: RequirementId[]
  acceptanceCriteria: AcceptanceItem[]

  // 上下文锚点
  contextAnchors: ContextAnchor[]

  // 生命周期记录（完整上下文，全程可追溯）
  executions: ExecutionRecord[]
  acceptances: AcceptanceRecord[]
  reworkCount: number
  reworkReason: string | null

  createdBy: 'user' | 'agent'
  createdAt: number
  updatedAt: number
  version: number

  /** 可选：执行时运行的命令（真实执行 seam） */
  command?: string | null
}

export interface RequirementInput {
  title: string
  description?: string
  priority?: Priority
  scope?: string[]
  dependencies?: string[]
  acceptanceCriteria?: AcceptanceItem[]
  contextAnchors?: ContextAnchor[]
  command?: string | null
  createdBy?: 'user' | 'agent'
}

/** 两个队列的持久化快照 */
export interface QueueState {
  /** 需求队列：不自动执行 */
  backlog: RequirementId[]
  /** 执行队列：FIFO 串行执行，支持重排/置顶 */
  execQueue: RequirementId[]
}

// ── 存储 Seam 契约（Definition） ─────────────────────────────
export interface RequirementsStore {
  save(req: Requirement): Promise<void>
  get(id: RequirementId): Promise<Requirement>
  update(id: RequirementId, patch: Partial<Requirement>): Promise<void>
  remove(id: RequirementId): Promise<void>
  list(filter?: { stage?: RequirementStage }): Promise<Requirement[]>

  /** 两个队列的持久化读写（Fork/Resume 保留） */
  readQueues(): Promise<QueueState>
  writeQueues(state: QueueState): Promise<void>
}

// ── 领域事件（实时，非持久化） ───────────────────────────────
export interface RequirementsEvents {
  'requirement/created'(req: Requirement): void
  'requirement/queued'(id: RequirementId): void // 丢入执行队列 → 队列 worker 派发
  'requirement/executing'(id: RequirementId, round: number): void
  'requirement/accepting'(id: RequirementId): void
  'requirement/accepted'(id: RequirementId): void // 验收通过 → 释放队列，派发下一个
  'requirement/rework'(id: RequirementId, reason: string): void // 验收失败 → 自动重入执行队列
}