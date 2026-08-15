# dsh-task-panel

任务面板（Task Panel）插件 —— 基于 DeepSeek Harness (DSH) 的 **bundle 插件**（`dsh.bundle` + `dsh.client` 双 manifest，Host + Client 双半）。

六列看板 + 双队列任务队列：需求提出/修改/删除 → 丢入执行队列 → 在**子 session** 中由 agent 串行完成任务 → 验收（**一句话产物** + **点击查看 agent 完整对话** + **验收反馈返工重入队列**）。

> 设计依据：
> - 架构文档（本地化）：[`docs/architecture.html`](docs/architecture.html)
> - 历史实现参考：`.reference/`（含前代 `dsh-requirements-2.1.0` 与 cordis 插件文件需求清单）

---

## 快速开始（dsh plugin add）

```bash
# 从 GitHub 安装（即"按 dsh plugin 的方式"）
dsh plugin --profile web add github:chinazkk/dsh-task-panel
dsh --profile web --dump-config   # 应出现 "# == dsh-task-panel" 层
dsh --profile web                 # 启动；会话视图出现「任务面板」标签页
```

详细安装/验证/升级/排障见 [`docs/INSTALL-GUIDE.md`](docs/INSTALL-GUIDE.md)。

## 功能

- **需求管理**：新增 / 编辑 / 删除需求（标题、描述、优先级、范围、命令），自动拆解**构成要素**、生成**验收要素**。
- **双队列分离**：
  - **需求队列 (backlog)**：新需求进入，可编辑/评审，**不自动执行**。
  - **执行队列 (queued)**：丢入后才排队执行，支持**置顶 / 撤回 / 删除**。
- **子 session 执行**：队列 worker 通过 `subagents.start()` 在**新会话**中派发子 agent 串行完成任务（FIFO，同时仅 1 个 executing）。
- **验收（非阻塞）**：执行完成即入**待验收池**，不阻塞后续任务；验收界面展示**一句话产物**（子 agent 最终交付摘要）。
- **对话回看**：每轮执行保存子 agent 的 sessionId 与父会话 id；验收时「查看对话」**跳转到真实子代理会话**（`sessions.openSubagent`），会话不可跳转时回退到已捕获的对话摘要弹窗。
- **验收反馈返工**：验收「通过」→ 验收完成；「返工」→ 填写反馈 → 自动重入执行队列（带返工原因，≤5 次后退回需求队列防死循环）。
- **持久化**：状态持久化到**需求绑定目录** `.dsh-task-panel/requirements.json`（随需求绑定目录走，重启/升级后状态自动恢复；未绑定目录时回退 `sandboxPolicy.workspaceRoot` 并自动迁移历史数据）。写入时显式携带 `workspace-write` 策略（沙箱默认模式为 read-only，不传策略会写盘失败）。

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
| `src/index.ts` → `lib/index.js` | Host | 数据模型 + 状态机 + 双队列调度 + 子 session 派发 + 8 个 Agent 工具 + Client RPC（webServer 路由桥）+ 持久化 |
| `src/client/index.ts` → `lib/client.js` | Client（浏览器 bundle） | 六列看板 + 需求表单 + 验收面板（产物/对话/返工/暂停恢复）；入口为会话视图标签页「任务面板」；经 `/plugins/dsh-task-panel/rpc` 调 Host |
| `cordis.patch.yml` | bundle 层 | 向 profile 插入 `dsh-task-panel` 插件行 |

**Host/Client 通信**：浏览器 Client 半通过 `fetch('/plugins/dsh-task-panel/rpc')` 调用 Host 半在
`webServer` 上注册的 RPC 路由（Host 半 `harness.handle` 注册的全部方法：state/get/progress/conversation/create/update/remove/
set-workdir/dispatch/recall/top/accept/rework/pause/stop/resume/browse-dir/pick-dir）。

**8 个 Agent 工具**：`propose_requirement` / `edit_requirement` / `delete_requirement` /
`dispatch_requirement` / `list_requirements` / `get_requirement` / `complete_execution` / `submit_acceptance`
（通过 `@deepseek-ai/dsh-tools` 的 `defineTool` 注册；执行器子 agent 作用域内 deny 面板管理工具，防止绕过队列元数据捕获）。

**沙箱适配**：Host 沙箱无 `AbortController`，从 `agent/pre-step` / `tools/execute` 事件捕获 `AbortSignal` 构造器，
以 `AbortSignal.any([])` 生成「永不中断」的子 agent 信号；捕获不到时回退到语义等价的鸭子类型信号。

## 安装与开发

- **安装（用户）**：`dsh plugin --profile web add github:chinazkk/dsh-task-panel` —— 详见 [`docs/INSTALL-GUIDE.md`](docs/INSTALL-GUIDE.md)
- **依赖清单**：详见 [`docs/DEPENDENCIES.md`](docs/DEPENDENCIES.md)
- **本地校验**：

```bash
npm run build      # tsc（Host+Client 半）→ lib/，tsdown 打包浏览器 bundle lib/client.js
npm run typecheck
npm test           # 15 组断言冒烟测试：bundle host 全流程（create/dispatch/执行/验收/返工/置顶/撤回/browse/工具/提示词段落）+ client handoff（__ModuleLoader__ + conversation.view 槽位）
npm run check      # build + test
```

> 仓库即唯一源码来源：`src/` 与 `cordis.patch.yml` 构成完整 bundle，`lib/` 为构建产物并随仓库提交
> （git 安装无需构建权限）。历史动态形态（`cordis_define` 粘贴 `src/host.js`/`src/client.js`）已由 bundle 形态取代，旧文件保留在 git 历史中。
