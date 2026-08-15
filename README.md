# dsh-task-panel

任务面板（Task Panel）插件 —— 基于 DeepSeek Harness (DSH) 的动态 Cordis 插件（Host + Client）。

六列看板 + 双队列任务队列：需求提出/修改/删除 → 丢入执行队列 → 在**子 session** 中由 agent 串行完成任务 → 验收（**一句话产物** + **点击查看 agent 完整对话** + **验收反馈返工重入队列**）。

> 设计依据：
> - 架构文档（本地化）：[`docs/architecture.html`](docs/architecture.html) —— DeepSeek Harness 架构 + 需求面板三层设计（含第四部分：当前实现 v14）
> - 文件需求清单：[`.reference/cordis-plugin-file-requirements.md`](.reference/cordis-plugin-file-requirements.md)
> - 前代实现参考：`dsh-requirements-2.1.0`（TypeScript bundle，见 `.reference/`）

---

## 功能

- **需求管理**：新增 / 编辑 / 删除需求（标题、描述、优先级、范围、命令），自动拆解**构成要素**、生成**验收要素**。
- **双队列分离**：
  - **需求队列 (backlog)**：新需求进入，可编辑/评审，**不自动执行**。
  - **执行队列 (queued)**：丢入后才排队执行，支持**置顶 / 撤回 / 删除**。
- **子 session 执行**：队列 worker 通过 `ctx.subagents.start()` 在**新会话**中派发子 agent 串行完成任务（FIFO，同时仅 1 个 executing）。
- **验收（非阻塞）**：执行完成即入**待验收池**，不阻塞后续任务；验收界面展示**一句话产物**（子 agent 最终交付摘要）。
- **对话回看**：每轮执行保存子 agent 的 sessionId 与父会话 id；验收时「查看对话」**跳转到真实子代理会话**（`sessions.openSubagent`），会话不可跳转时回退到已捕获的对话摘要弹窗。
- **验收反馈返工**：验收「通过」→ 验收完成；「返工」→ 填写反馈 → 自动重入执行队列（带返工原因，≤5 次后退回需求队列防死循环）。
- **持久化**：状态持久化到**需求绑定目录** `lastWorkdir/.dsh-task-panel/requirements.json`（即 `/workspace/dsh-task-panel/.dsh-task-panel/requirements.json`，随需求绑定目录走，重启/升级后状态自动恢复；未绑定目录时回退 `sandboxPolicy.workspaceRoot` 并自动迁移历史数据）。写入时显式携带 `workspace-write` 策略（沙箱默认模式为 read-only，不传策略会写盘失败）。

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
| `src/client.js` | Client | 六列看板 + 需求表单 + 验收面板（产物/对话/返工/暂停恢复）；入口为会话视图标签页「任务面板」 |

## 安装（动态插件）

本插件作为 DSH **动态 Cordis 插件**交付：通过 `cordis_define` / `cordis_run` 加载 Host + Client 两半。

**从 Git 安装步骤**（`src/host.js` + `src/client.js` 即全部插件代码）：

```bash
# 1. 克隆仓库（私有仓库需已授权）
git clone git@github.com:chinazkk/dsh-task-panel.git
cd dsh-task-panel

# 2. 校验代码（语法 + 依赖审计 + 全流程模拟测试，均不依赖 DSH 运行时）
npm install            # 仅安装本地脚本依赖（peer 依赖 @deepseek-ai/dsh、cordis 由宿主 DSH 提供）
npm run check          # 语法校验 host + client + 依赖审计（未声明的外部依赖会报错）
npm run check:deps     # 单独跑依赖审计（扫描 import/require + Host 服务清单）
npm test               # 18 项断言全流程模拟

# 3. 在 DSH 会话中注册运行（Host 半 = src/host.js 全文，Client 半 = src/client.js 全文）
#    cordis_define(kind: existing, pluginId: 已有插件ID 或 kind: new 新建)
#      - code.host   ← 粘贴 src/host.js 全文
#      - code.client ← 粘贴 src/client.js 全文
#    cordis_run(packageId, mode: update/run)
#    面板入口：会话视图标签页「任务面板」（与「对话 / 轨迹」同级）
```

> 说明：DSH 动态插件没有独立的 npm 安装包——`src/host.js` / `src/client.js`
> 就是插件的全部可部署代码，仓库即唯一源码来源，`cordis_define` 时整文件粘贴即可。
> 若目标 DSH 已运行本插件（`reqp-1`），只需把新源码粘贴到新 Package 后 `cordis_run update`。

- Host 依赖注入：`subagents`、`agents` + `ctx.get('...')` 服务（`sessionQuery`、`fs`、`sandboxPolicy`、`systemPrompt`、`agentPresets`、`agentDefaultModel`）
- Client 依赖注入：`slots`、`sessions`；入口为会话视图标签页 `conversation.view`（与「对话 / 轨迹」同级）
- 沙箱适配：Host 沙箱无 `AbortController`，从 `agent/pre-step` / `tools/execute` 事件捕获 `AbortSignal` 构造器，以 `AbortSignal.any([])` 生成「永不中断」的子 agent 信号；捕获不到时回退到语义等价的鸭子类型信号——执行器初始化不再因缺 AbortSignal 失败（详见 `src/host.js` 的 `makeNeverAbortSignal`）。

## 仓库完整性（源码即唯一来源）

本仓库是运行中插件（`reqp-1` / 当前 `pkg-14`）的**唯一源码来源**：`src/host.js` 与 `src/client.js`
与插件 Host/Client 两半**逐字节一致**（每次改动都通过 `cordis_define` 重新定义并 `cordis_run` 加载，
再从仓库直接提交）。仓库包含：

| 内容 | 文件 | 说明 |
| --- | --- | --- |
| 项目清单 | `package.json` | 声明对 `@deepseek-ai/dsh` / `cordis` 的 peer 依赖（零 dependencies/devDependencies）+ exports 映射 + 脚本 |
| Host 半源码 | `src/host.js` | 数据模型/状态机/双队列/专用面板 agent/子 session 派发/8 工具/15 RPC/持久化/workdir 绑定 |
| Client 半源码 | `src/client.js` | 六列看板 UI（固定高对比按钮 + 对话跳转 + 目录绑定表单） |
| 逻辑测试 | `test/simulate-host.js` | 真实源码全流程模拟（18 项断言，含 AbortSignal 兜底回归） |
| 语法校验 | `scripts/check-syntax.js` | 校验两半源码可按沙箱方式解析 |
| 依赖审计 | `scripts/check-deps.js` | 校验外部 import/require 均已声明 + 输出 Host 服务清单 |
| 依赖清单文档 | `docs/DEPENDENCIES.md` | 三层依赖说明：peer 依赖 / Host 服务 / Node 内置模块 |
| 架构文档 | `docs/architecture.html` | DeepSeek Harness 架构 + 需求面板三层设计（本地化，含第四部分 v14） |
| 参考材料 | `.reference/` | 文件需求清单 + 前代 2.1.0 实现 |

```bash
npm run check       # 语法校验（host + client）+ 依赖审计
npm run check:deps  # 依赖审计（外部说明符声明检查 + Host 服务清单）
npm test            # 状态机/双队列/验收全流程模拟测试
```

> 依赖说明：插件运行时消费 DSH 提供的服务（`subagents` / `agents` / `sessionQuery` / `fs` /
> `sandboxPolicy` / `systemPrompt` / `agentPresets` / `agentDefaultModel` 等），这些由宿主
> harness 提供，**不随本仓库打包**；`package.json` 的 `peerDependencies` 显式声明了这份
> 依赖关系，保证仓库可复现。完整三层依赖清单见 [`docs/DEPENDENCIES.md`](docs/DEPENDENCIES.md)，
> 并用 `npm run check:deps` 自动核对声明与源码消费一致。

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

`state` / `get` / `conversation` / `create` / `update` / `remove` / `set-workdir` / `dispatch` / `recall` / `top` / `accept` / `rework` / `pause` / `stop` / `resume`（15 个 handler）

## 状态机

`backlog`（需求队列）→ `queued`（执行队列）→ `executing`（子 agent 执行中，可暂停/停止）→ `paused`（已暂停，可恢复）→ `accepting`（待验收池）→ `accepted`（验收完成）；验收失败自动 `rework` 重入执行队列。

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
├── package.json       # 依赖清单（peerDeps + exports + 脚本）
├── docs/
│   ├── architecture.html   # 本地化架构文档（含第四部分 v14）
│   └── DEPENDENCIES.md     # 三层依赖清单（peer 依赖 / Host 服务 / Node 内置模块）
├── src/
│   ├── host.js       # Host 半（数据/状态机/队列/面板 agent/工具/RPC）
│   └── client.js     # Client 半（六列看板 UI）
├── scripts/
│   ├── check-syntax.js   # 语法校验
│   └── check-deps.js     # 依赖审计（外部说明符声明检查 + Host 服务清单）
├── test/
│   └── simulate-host.js
└── .reference/       # 参考材料（文件需求清单 + 2.1.0 bundle）
```
