<p align="center">
  <h1 align="center">dsh-task-panel</h1>
</p>

<p align="center">
  <strong>任务面板（Task Panel）—— DeepSeek Harness (DSH) 插件：六列看板 + 双队列任务队列，在子 session 中由 agent 串行执行需求，并完成验收闭环。</strong>
</p>

<p align="center">
  <a href="https://github.com/chinazkk/dsh-task-panel/issues">Report an issue</a>
  · <a href="https://github.com/chinazkk/dsh-task-panel">View on GitHub</a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/DSH-Web%20Plugin-10b981" alt="DSH Web Plugin">
  <img src="https://img.shields.io/badge/Node.js-%E2%89%A518-339933?logo=nodedotjs&logoColor=white" alt="Node.js 18 or later">
  <img src="https://img.shields.io/badge/bundle-dsh.bundle%2Bdsh.client-8b5cf6" alt="DSH bundle">
</p>

> dsh-task-panel 是一个社区维护的 DSH 插件，非 DeepSeek 官方产品。

<p align="center">
  <img src="assets/screenshots/task-panel-board.webp" alt="任务面板六列看板（示例数据）" width="960">
</p>

> 上图为任务面板六列看板（示例数据）：需求队列 → 执行队列 → 执行中（实时进度预览，可一键直达子代理会话）→ 已暂停 → 待验收（一句话产物）→ 验收完成。

## 这是什么

任务面板把「提需求 → 执行 → 验收」做成一个六列看板 + 双队列的闭环，挂在 DSH 会话视图里（与「对话 / 轨迹」同级的「任务面板」标签页）：

- **需求队列 (backlog)** —— 提出/编辑/删除需求，自动拆解**构成要素**、生成**验收要素**，不自动执行。
- **执行队列 (queued)** —— 丢入后排队，由队列 worker 在**子 session** 中派发子 agent **串行**执行（FIFO，同时仅 1 个 executing）；支持置顶 / 撤回。
- **执行中 (executing)** —— 实时进度预览（最近对话流 + 已运行时长），「查看进度」一键**直达对应子代理会话**（会话即实时进度）；可暂停 / 停止。
- **待验收 (accepting)** —— 执行完成入池，不阻塞后续任务；展示**一句话产物**，可「查看对话」（跳转真实子代理会话，不可跳转时回退对话摘要）。
- **验收闭环** —— 「通过」→ 验收完成；「返工」→ 填写反馈自动重入执行队列（≤5 次后退回需求队列防死循环）。

## 快速开始

需要一套可用的 DeepSeek Harness Web 安装。**不要**在任意目录里 `npm install`：用 `dsh plugin` 装进 Web profile 即可。

```bash
# 从 GitHub 安装（bundle 形态，lib/ 已随仓库提交，无需构建权限）
dsh plugin --profile web add github:chinazkk/dsh-task-panel

# 验证层组合
dsh --profile web --dump-config      # 输出应含 "# == dsh-task-panel" 层

# 启动（或重启现有 GUI），会话视图出现「任务面板」标签页
dsh --profile web
```

详细安装 / 升级 / 移除 / 排障见 [`docs/INSTALL-GUIDE.md`](docs/INSTALL-GUIDE.md)。

## 面板能力一览

| 阶段 | 你能做什么 |
| --- | --- |
| 需求队列 | 新建 / 编辑 / 删除 / 绑定工作目录 / 丢执行 |
| 执行队列 | 置顶 / 撤回 / 删除 |
| 执行中 | 实时进度预览 · 「查看进度」直达子代理会话 · 暂停 / 停止 |
| 已暂停 | 恢复（重入执行队列） |
| 待验收 | 一句话产物 · 查看对话（跳转真实子会话 / 摘要回退）· 通过 / 返工（附反馈） |
| 验收完成 | 查看对话 · 产物展开/收起 |

主 agent 工具集新增 8 个面板工具：`propose_requirement` / `edit_requirement` / `delete_requirement` / `dispatch_requirement` / `list_requirements` / `get_requirement` / `complete_execution` / `submit_acceptance`。

## 安全与边界

- **持久化**：状态写入**需求绑定目录根**下的 `.dsh-task-panel/requirements.json`（未绑定时回退部署 workspaceRoot，并自动迁移历史数据）；写入显式携带 `workspace-write` 沙箱策略，策略根按**根会话 cwd** 解析，绑定目录在会话工作区内即可落盘。
- **执行边界**：子 agent 的沙箱根跟随根会话 cwd——需求绑定目录需位于当前会话工作区内才能写文件。
- **工具隔离**：执行器子 agent 作用域内 deny 面板管理工具，防止绕过队列元数据捕获。
- **信号兜底**：宿主无 `AbortController` 时，从 `agent/pre-step` / `tools/execute` 事件捕获 `AbortSignal` 构造器生成「永不中断」信号，捕获不到时回退语义等价的鸭子类型信号——执行器初始化永不因缺信号失败。

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
执行中 (executing) ── 实时进度 + 直达子代理会话
   ▼
待验收池 (accepting) ── 一句话产物 + 查看对话
   ├─ ✓ 通过 → 验收完成 (accepted)
   └─ ↻ 返工（填写反馈）→ 自动重入执行队列（≤5 次）
```

| 文件 | 平台 | 职责 |
| --- | --- | --- |
| `src/index.ts` → `lib/index.js` | Host | 数据模型 + 状态机 + 双队列调度 + 子 session 派发 + 8 个 Agent 工具 + Client RPC（webServer 路由桥）+ 持久化 |
| `src/client/index.ts` → `lib/client.js` | Client（浏览器 bundle） | 六列看板 + 需求表单 + 验收面板；经 `/plugins/dsh-task-panel/rpc` 调 Host |
| `cordis.patch.yml` | bundle 层 | 向 profile 插入 `dsh-task-panel` 插件行 |

Host/Client 通信：浏览器 Client 通过 `fetch('/plugins/dsh-task-panel/rpc')` 调用 Host 在 `webServer` 注册的 RPC 路由。

## 开发与验证

```bash
npm run build      # tsc（Host+Client 半）→ lib/，tsdown 打包浏览器 bundle lib/client.js
npm run typecheck
npm test           # 15 组断言冒烟测试：bundle host 全流程 + client handoff + 真实渲染回归
npm run check      # build + test
dsh plugin --profile web add .    # 装本地目录，改代码后重新 build 即可
```

## 项目文档

- 安装 / 升级 / 排障：[`docs/INSTALL-GUIDE.md`](docs/INSTALL-GUIDE.md)
- 依赖清单（peer 依赖 / Host 服务 / Client 服务 / 构建期）：[`docs/DEPENDENCIES.md`](docs/DEPENDENCIES.md)
- 架构设计（本地化）：[`docs/architecture.html`](docs/architecture.html)

## License

Licensed under the [MIT License](LICENSE).
