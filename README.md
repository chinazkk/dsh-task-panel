# dsh-task-panel

任务面板（Task Panel）插件 —— 基于 DeepSeek Harness (DSH) 的动态 Cordis 插件（Host + Client）。

五列看板 + 双队列任务队列：需求提出/修改/删除 → 丢入执行队列 → 在**子 session** 中由 agent 串行完成任务 → 验收（**一句话产物** + **点击查看 agent 完整对话** + **验收反馈返工重入队列**）。

> 设计依据：
> - 架构文档：[`DeepSeek Harness 架构 + 需求面板三层设计`](https://chinazkk.cn/v1/oss/?path=17867249466595.html)
> - 前代实现参考：`dsh-requirements-2.1.0`（TypeScript bundle，见 `.reference/`）

---

## 功能

- **需求管理**：新增 / 编辑 / 删除需求（标题、描述、优先级、范围、命令），自动拆解**构成要素**、生成**验收要素**。
- **双队列分离**：
  - **需求队列 (backlog)**：新需求进入，可编辑/评审，**不自动执行**。
  - **执行队列 (queued)**：丢入后才排队执行，支持**置顶 / 撤回 / 删除**。
- **子 session 执行**：队列 worker 通过 `ctx.subagents.start()` 在**新会话**中派发子 agent 串行完成任务（FIFO，同时仅 1 个 executing）。
- **验收（非阻塞）**：执行完成即入**待验收池**，不阻塞后续任务；验收界面展示**一句话产物**（子 agent 最终交付摘要）。
- **对话回看**：每轮执行保存子 agent 的 sessionId 与完整对话 transcript，验收时**点击「查看对话」**查看执行细节。
- **验收反馈返工**：验收「通过」→ 验收完成；「返工」→ 填写反馈 → 自动重入执行队列（带返工原因，≤5 次后退回需求队列防死循环）。
- **持久化**：状态尽力持久化到 `<workspaceRoot>/.dsh-task-panel/requirements.json`（Fork/Resume 保留）。

## 架构

```
用户 / Agent / Web UI
   │ 新增/编辑/删除需求
   ▼
需求队列 (backlog) ── 不自动执行
   │ 丢执行 dispatch_requirement
   ▼
执行队列 (queued) ── FIFO 串行，可置顶/撤回
   │ 队列 worker：subagents.start() 子 session 执行
   ▼
执行中 (executing) ── 子 agent 完成 → 一句话产物 + 对话 transcript
   ▼
待验收池 (accepting) ── 可堆积多个，逐个验收
   ├─ ✓ 通过 → 验收完成 (accepted)
   └─ ↻ 返工（填写反馈）→ 自动重入执行队列（≤5 次）
```

| 文件 | 平台 | 职责 |
| --- | --- | --- |
| `src/host.js` | Host | 数据模型 + 状态机 + 双队列调度 + 子 session 派发 + 8 个 Agent 工具 + Client RPC + 持久化 |
| `src/client.js` | Client | 五列看板 + 需求表单 + 验收面板（产物/对话/返工）+ sidebar 入口 |

## 安装（动态插件）

本插件作为 DSH **动态 Cordis 插件**交付：通过 `cordis_define` / `cordis_run` 加载 Host + Client 两半。

- Host 依赖注入：`subagents`、`agents`（可选：`sessionQuery`、`fs`、`sandboxPolicy`、`systemPrompt`、`timer`）
- Client 依赖注入：`timer`；使用槽位 `sidebar.footer.action`（入口开关）、`shell.overlay`（看板）
- 沙箱适配：Host 沙箱无 `AbortController`，从 `agent/pre-step` / 工具 `exec.signal` 捕获 `AbortSignal` 构造器，以 `AbortSignal.any([])` 生成子 agent 信号。

## Agent 工具（8 个）

| 工具 | 用途 |
| --- | --- |
| `propose_requirement` | 提出需求 → 需求队列（自动拆解要素 + 验收要素） |
| `edit_requirement` | 编辑需求（标题/描述/优先级/范围/命令） |
| `delete_requirement` | 删除需求 |
| `dispatch_requirement` | 需求队列 → 执行队列（触发子 session 执行） |
| `list_requirements` | 按阶段查询需求列表 |
| `get_requirement` | 查看单个需求完整上下文（含一句话产物） |
| `complete_execution` | 手动标记执行完成 → 待验收池 |
| `submit_acceptance` | 提交验收（通过 → 完成；失败 → 自动重入队列返工） |

## Client RPC

`state` / `get` / `conversation` / `create` / `update` / `remove` / `dispatch` / `recall` / `top` / `accept` / `rework`

## 状态机

`backlog`（需求队列）→ `queued`（执行队列）→ `executing`（子 agent 执行中）→ `accepting`（待验收池）→ `accepted`（验收完成）；验收失败自动 `rework` 重入执行队列。

## 开发

```bash
# 本地文件夹即仓库：/workspace/dsh-task-panel
git add src/ README.md
git commit -m "..."
git push origin main
```

## 目录

```
dsh-task-panel/
├── README.md
├── .gitignore
├── src/
│   ├── host.js       # Host 半（数据/状态机/队列/工具/RPC）
│   └── client.js     # Client 半（看板 UI）
└── .reference/       # 参考文档（架构 HTML + 2.1.0 bundle）
```
