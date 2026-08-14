# dsh-requirements · 需求面板 + 任务队列

交互专业级的**需求面板**插件，内置**需求队列 / 执行队列分离**的任务队列，任务在**新会话（子 agent）中真实执行**。

一套代码，可安装到任意 **DeepSeek Harness (`dsh`)** 以及 **Codex 类 harness**，开箱即用。

> 设计依据：[`deepseek-harness-requirements-arch.html`](../reports/deepseek-harness-requirements-arch.html) 第二部分「三层流水线需求面板」。

---

## 特性

- **三层流水线**：需求（自动拆解构成要素 + 生成验收要素）→ 执行（子 agent 新会话）→ 验收（逐项检查，失败自动返工）。
- **双队列分离**：
  - **需求队列 (backlog)**：新需求进入这里，**不自动执行**。
  - **执行队列 (queued)**：只有「丢入执行队列」才排队执行，支持**拖拽排序 / 置顶 / 撤回**。
- **新会话执行**：执行队列里的任务派发到**子 agent 新会话**真实完成（读代码、改文件、跑测试），串行 FIFO。
- **返工自动重入**：验收失败 → 自动重入执行队列重跑（带返工原因），连续 5 次后退回需求队列防死循环。
- **非阻塞验收**：执行完成即入「待验收池」并释放队列，待审核任务**不阻塞**后续任务，可同时堆积、逐个审核。
- **完整上下文**：每个需求全程保留 构成要素 + 每轮执行 + 每次验收 + 返工历史，可回溯。
- **6 个 Agent 工具**：`propose_requirement` / `dispatch_requirement` / `list_requirements` / `get_requirement` / `complete_execution` / `submit_acceptance`。

---

## 架构（Seam 三角色）

```
用户 / Agent
   │ propose_requirement
   ▼
需求队列 (backlog)  —— 不自动执行
   │ dispatch_requirement（丢入执行队列）
   ▼
执行队列 (queued)  —— FIFO 串行，可拖拽/置顶/撤回
   │ 队列 worker 出队 → 子 agent 新会话执行
   ▼
执行中 (executing) ── complete_execution（完成后立即释放队列，取下一个）
   ▼
待验收池 (accepting) ── submit_acceptance（可同时堆积多个，不阻塞队列）
   ├─ 通过 → 验收完成 (accepted)
   └─ 失败 → 返工 → 自动重入执行队列（≤5 次）
```

| 文件 | 角色 | ctx key |
| --- | --- | --- |
| `types.ts` | 定义 | 数据模型 + 事件 + `RequirementsStore` 契约 |
| `store.ts` | 实现 | `ctx.requirementsStore`（JSONL + queues.json，Fork/Resume 保留） |
| `service.ts` | 定义/消费 | `ctx.requirements`（`RequirementsService` 状态机） |
| `queue.ts` | 消费 | 任务队列派发器（串行 + 新会话子 agent + 返工重排队） |
| `tools.ts` | 消费 | 6 个 Agent 工具 |
| `prompt.ts` | 消费 | 三段式系统提示词注入 |

---

## 安装（开箱即用）

### 前置依赖

宿主 harness 已挂载以下 seam（本 bundle 只消费、不重复注册）：

`session` · `tools` · `system-prompt` · `subagents`（子 agent 执行） · `agents` · `fs`

### 方式 A：作为本地插件包引用（推荐，DeepSeek Harness）

```bash
# 1. 把本目录放到 harness 的插件目录
cp -r dsh-requirements-bundle /path/to/your-harness/plugins/

# 2. 安装依赖并构建
cd /path/to/your-harness/plugins/dsh-requirements-bundle
pnpm i && pnpm build
```

在宿主 `cordis.yml` 中追加一行，挂载整套：

```yaml
- id: requirements-bundle
  name: ./plugins/dsh-requirements-bundle/cordis.yml
```

重启 harness，即可看到「需求面板」五列看板 + 左侧「任务队列」窗口。

### 方式 B：npm 包引用

```bash
# 在 harness 根目录
pnpm add ./plugins/dsh-requirements-bundle   # 或发布后 pnpm add @comagic/dsh-requirements
```

```yaml
- id: requirements-bundle
  name: '@comagic/dsh-requirements/service'
- id: requirements-store
  name: '@comagic/dsh-requirements/store'
- id: requirements-queue
  name: '@comagic/dsh-requirements/queue'
- id: tool-requirements
  name: '@comagic/dsh-requirements/tools'
- id: requirements-prompt
  name: '@comagic/dsh-requirements/prompt'
```

### 方式 C：导出 tarball 分发

```bash
cd dsh-requirements-bundle
bash export.sh
# → skill-releases/dsh-requirements-<version>.tar.gz
```

在目标 harness 上：

```bash
tar -xzf dsh-requirements-<version>.tar.gz -C /path/to/your-harness/plugins
# 然后按「方式 A」挂载 + 构建
```

---

## 快速开始

1. **新建需求**：Web UI 左侧「任务队列」按钮 → 任务窗口「新增需求」，或主视图「需求面板」标签 →「＋ 新建需求」。需求先进入**需求队列**。
2. **丢入执行队列**：在需求队列卡片 / 任务窗口点「丢执行」（或 Agent 调 `dispatch_requirement`）。
3. **自动执行**：执行队列按 FIFO 串行派发，任务在子 agent 新会话中真实执行（拖拽可调顺序，`⤒` 置顶，`撤回` 可退回）。
4. **验收**：待验收卡片「✓ 通过」→ 完成；「↻ 返工」→ 自动重入执行队列重跑。
5. **自动验收**：任务窗口开启「自动验收」后，执行完成自动通过，无人值守跑完整队列。

Agent 侧（对话中）直接调用工具：

```text
propose_requirement   title="用户登录功能" description="登录页 UI + 后端鉴权 API + 测试" priority=critical
dispatch_requirement  requirementId="RQ-..."     # 丢入执行队列
list_requirements                                 # 查看各阶段
submit_acceptance     requirementId="RQ-..." results=[...]  # 验收，失败自动返工
```

---

## 数据模型（关键字段）

| 字段 | 说明 |
| --- | --- |
| `stage` | `backlog`（需求队列）→ `queued`（执行队列）→ `executing` → `accepting` → `accepted`；`rework` 为瞬时态 |
| `elements` | 需求构成要素（自动拆解：feature/api/ui/test/config） |
| `acceptanceCriteria` | 验收要素（functional/test/code_quality/user_confirmation…） |
| `executions` | 每轮执行记录（含返工，步骤 + 子 agent sessionId + 总结） |
| `acceptances` | 每次验收记录（逐项通过/失败 + 返工建议） |
| `reworkCount` / `reworkReason` | 返工次数 / 最近返工原因 |

## 关键约定

- **事件驱动状态机**：流转由 `requirement/*` 事件触发，加「设计评审层」只需注册新事件 + 新状态 + 新监听器。
- **存储 Seam**：`RequirementsStore` 是接口契约，替换为 SQLite / 远程后端时消费方零修改。
- **新会话执行 Seam**：`queue.ts` 通过 `ctx.subagents.start('fork', …)` 派生子 agent 新会话；provider 名可改（fork/spawn）。

## 常见问题（FAQ）

**Q：为什么不自动执行？**
新需求进入「需求队列（backlog）」是设计如此——只有「丢入执行队列」才排队执行，给你机会整理优先级与队列顺序。

**Q：任务在哪执行？**
执行队列的任务由队列 worker 派发到**子 agent 新会话**（`subagents`），串行执行，不阻塞主会话。

**Q：待验收会阻塞队列吗？**
不会。执行完成即进入「待验收池」并释放队列，队列继续执行下一个任务；待审核任务可同时堆积、逐个「通过 / 返工」。

**Q：验收失败后怎么办？**
自动重入执行队列返工（带返工原因），连续 5 次后退回需求队列；你仍可手动再次丢执行。

**Q：如何持久化？**
默认 JSONL + `queues.json`，写入 `~/.dsh/requirements/`（可用 `DSH_REQUIREMENTS_DIR` 覆盖）；换 `RequirementsStore` 实现即可切换后端。

---

## 目录

```
dsh-requirements-bundle/
├── cordis.yml        # bundle 组合文件（挂载整套）
├── package.json      # npm 清单（子路径导出）
├── export.sh         # 一键导出 tarball
├── README.md
└── src/
    ├── types.ts      # 数据模型 + 事件 + 存储契约
    ├── store.ts      # JSONL + 双队列持久化 Provider
    ├── service.ts    # RequirementsService（状态机）
    ├── queue.ts      # 任务队列派发器（新会话执行 + 返工重排队）
    ├── tools.ts      # 6 个 Agent 工具
    ├── prompt.ts     # 三段式提示词
    └── index.ts      # 公共面导出
```