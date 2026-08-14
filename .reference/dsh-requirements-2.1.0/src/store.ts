// ─────────────────────────────────────────────────────────────
// JSONL 存储 Provider（Store Seam 实现）
// 通过 ctx.requirementsStore 注入；可替换为 SQLite / 远程后端。
// 需求以 JSONL 持久化；两个队列（需求队列/执行队列）以 queues.json 持久化。
// ─────────────────────────────────────────────────────────────

import { appendFile, mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type {
  QueueState,
  Requirement,
  RequirementId,
  RequirementStage,
  RequirementsStore,
} from './types.js'

export interface JsonlStoreOptions {
  /** 数据目录，默认 process.env.DSH_REQUIREMENTS_DIR 或 ~/.dsh/requirements */
  dir?: string
}

export class JsonlRequirementsStore implements RequirementsStore {
  private readonly file: string
  private readonly queueFile: string

  constructor(options: JsonlStoreOptions = {}) {
    const dir =
      options.dir ??
      process.env.DSH_REQUIREMENTS_DIR ??
      join(process.env.HOME ?? process.cwd(), '.dsh', 'requirements')
    this.file = join(dir, 'requirements.jsonl')
    this.queueFile = join(dir, 'queues.json')
  }

  private async ensureDir(): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true })
  }

  async save(req: Requirement): Promise<void> {
    await this.ensureDir()
    await appendFile(this.file, JSON.stringify(req) + '\n')
  }

  async get(id: RequirementId): Promise<Requirement> {
    const found = (await this.readAll()).find((r) => r.id === id)
    if (!found) throw new Error(`requirement ${id} not found`)
    return found
  }

  async update(id: RequirementId, patch: Partial<Requirement>): Promise<void> {
    const all = await this.readAll()
    await this.writeAll(
      all.map((r) =>
        r.id === id ? { ...r, ...patch, version: r.version + 1, updatedAt: Date.now() } : r,
      ),
    )
  }

  async remove(id: RequirementId): Promise<void> {
    await this.writeAll((await this.readAll()).filter((r) => r.id !== id))
  }

  async list(filter: { stage?: RequirementStage } = {}): Promise<Requirement[]> {
    const all = await this.readAll()
    return filter.stage ? all.filter((r) => r.stage === filter.stage) : all
  }

  // ── 两个队列的持久化 ─────────────────────────────────────
  async readQueues(): Promise<QueueState> {
    await this.ensureDir()
    try {
      const parsed = JSON.parse(await readFile(this.queueFile, 'utf8')) as QueueState
      return {
        backlog: Array.isArray(parsed.backlog) ? parsed.backlog : [],
        execQueue: Array.isArray(parsed.execQueue) ? parsed.execQueue : [],
      }
    } catch {
      return { backlog: [], execQueue: [] }
    }
  }

  async writeQueues(state: QueueState): Promise<void> {
    await this.ensureDir()
    await writeFile(this.queueFile, JSON.stringify(state, null, 2))
  }

  // ── 内部 ─────────────────────────────────────────────
  private async readAll(): Promise<Requirement[]> {
    await this.ensureDir()
    try {
      const raw = await readFile(this.file, 'utf8')
      return raw
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Requirement)
    } catch {
      return []
    }
  }

  private async writeAll(list: Requirement[]): Promise<void> {
    await this.ensureDir()
    const tmp = this.file + '.tmp'
    await writeFile(tmp, list.map((r) => JSON.stringify(r)).join('\n') + '\n')
    await rename(tmp, this.file)
  }
}