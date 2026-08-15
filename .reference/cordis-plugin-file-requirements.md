# DeepSeek Harness Cordis 插件文件需求

> 生成时间：2026-08-15
> 基于项目：`dsh-task-panel` 及其前代实现 `dsh-requirements-2.1.0`

---

## 概述

通过对比前代实现 `dsh-requirements-2.1.0`（TypeScript bundle，标准 Cordis 插件架构）与当前实现 `dsh-task-panel`（动态插件，Host + Client 两文件），可以清晰看到一个完整的 Cordis 插件需要包含哪些文件。

---

## 标准 Cordis 插件所需的文件（2.1.0 架构）

| # | 文件 | 角色 | 必需性 |
|---|------|------|--------|
| 1 | `cordis.yml` | 组合清单文件 — 声明所有插件条目及其依赖关系 | **核心必须** |
| 2 | `package.json` | npm 清单 — name、version、exports、peerDependencies | **核心必须** |
| 3 | `src/types.ts` | 数据模型 + 领域事件 + 存储 Seam 接口契约（Definition） | **核心必须** |
| 4 | `src/service.ts` | 业务逻辑状态机（Consumer），消费 `types` | **核心必须** |
| 5 | `src/store.ts` | 持久化实现（Store Seam Provider），实现 `RequirementsStore` 接口 | **核心必须** |
| 6 | `src/queue.ts` | 任务队列派发器（Consumer），导出 `name` / `inject` / `apply` | **核心必须** |
| 7 | `src/tools.ts` | Agent 工具注册（Consumer），导出 `name` / `inject` / `apply` | **核心必须** |
| 8 | `src/prompt.ts` | 系统提示词注入（Consumer），导出 `name` / `inject` / `apply` | **核心必须** |
| 9 | `src/index.ts` | Bundle 公共入口 — re-export 所有模块 | 可选（npm 包时需要） |
| 10 | `export.sh` | 导出 tarball 分发脚本 | 可选 |
| 11 | `README.md` | 文档 | 可选 |

---

## cordis.yml 的结构（插件注册的核心）

每个条目声明一个插件的 `id` 和 `name`（指向 npm package 路径）：

```yaml
- id: requirements           # 服务定义
  name: '@comagic/dsh-requirements/service'
- id: requirements-store      # 存储实现
  name: '@comagic/dsh-requirements/store'
- id: requirements-queue      # 队列派发
  name: '@comagic/dsh-requirements/queue'
- id: tool-requirements       # Agent 工具
  name: '@comagic/dsh-requirements/tools'
- id: requirements-prompt     # 提示词注入
  name: '@comagic/dsh-requirements/prompt'
```

宿主 harness 在自身的 `cordis.yml` 中引用：

```yaml
- id: requirements-bundle
  name: ./plugins/dsh-requirements-bundle/cordis.yml
```

---

## package.json 的 exports 映射

```json
{
  "name": "@comagic/dsh-requirements",
  "version": "2.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
    "./service": "./dist/service.js",
    "./store": "./dist/store.js",
    "./queue": "./dist/queue.js",
    "./tools": "./dist/tools.js",
    "./prompt": "./dist/prompt.js"
  },
  "files": ["src", "dist", "cordis.yml", "README.md"],
  "peerDependencies": {
    "@deepseek-ai/dsh": ">=1.0.0",
    "cordis": ">=0.0.0"
  }
}
```

---

## 每个 Consumer 模块必须导出的三件套

```typescript
export const name = '@comagic/dsh-requirements/xxx'   // 唯一标识
export const inject = ['requirements', 'subagents']   // 依赖注入声明
export function apply(ctx: Context, options?: {}) {   // 插件入口函数
  // 通过 ctx.xxx 访问注入的依赖
  // 通过 ctx.on('event') 监听事件
}
```

---

## 各源文件职责详解

### src/types.ts — 领域模型与接口契约

- 定义所有核心类型：`Requirement`、`RequirementStage`、`Priority`、`RequirementElement`、`AcceptanceItem`、`ExecutionRecord`、`AcceptanceRecord`
- 定义队列状态：`QueueState { backlog, execQueue }`
- 定义存储 Seam 接口：`RequirementsStore`（save/get/update/remove/list/readQueues/writeQueues）
- 定义领域事件：`RequirementsEvents`（created/queued/executing/accepting/accepted/rework）

### src/service.ts — 业务状态机

- `RequirementsService` 类：消费 `RequirementsStore` + 事件 `emit`
- 需求层：`create()` → 自动拆解构成要素 + 生成验收要素 → 进入 backlog
- 队列调度：`dispatchToExec()`、`recallFromExec()`、`moveExec()`、`moveExecTop()`、`dequeueExec()`、`enqueueExec()`
- 执行层：`startExecution()`、`recordAction()`、`completeExecution()`
- 验收层：`submitAcceptance()` → 通过则 accepted，失败则自动返工重入队列（≤5 次）
- 查询：`get()`、`update()`、`list()`、`remove()`

### src/store.ts — 持久化 Provider

- `JsonlRequirementsStore`：实现 `RequirementsStore` 接口
- 数据目录：`~/.dsh/requirements/`（可通过 `DSH_REQUIREMENTS_DIR` 覆盖）
- 需求数据：JSONL 格式（`requirements.jsonl`）
- 队列数据：JSON 格式（`queues.json`）
- 可替换为 SQLite / 远程后端，消费方零修改

### src/queue.ts — 任务队列派发器

- 监听 `requirement/queued` 和 `requirement/rework` 事件
- 串行 FIFO 派发，`busy` 标志确保同时只有一个 executing
- 通过 `ctx.subagents.start()` 派发到子 agent 新会话执行
- 执行完成即释放队列，待验收不阻塞后续任务

### src/tools.ts — Agent 工具（6 个）

- `propose_requirement` — 提出需求 → backlog
- `dispatch_requirement` — backlog → 执行队列
- `list_requirements` — 按阶段查询
- `get_requirement` — 查看单个需求完整上下文
- `complete_execution` — 标记执行完成 → 待验收
- `submit_acceptance` — 逐项验收，失败自动返工

### src/prompt.ts — 三段式系统提示词注入

- 每次 `agent/pre-step` 注入：
  1. 五列状态概览（backlog/queued/executing/accepting/accepted）
  2. 当前执行中需求的完整上下文（构成要素 + 验收要素 + 返工历史）
  3. 待验收需求的验收指南

---

## 动态插件模式（dsh-task-panel 当前实现）

当前实现采用了 **动态 Cordis 插件** 模式，通过 `cordis_define` / `cordis_run` 加载，更加精简：

| 文件 | 角色 |
|------|------|
| `src/host.js` | Host 半 — 整合了 types + service + store + queue + tools 的全部逻辑 |
| `src/client.js` | Client 半 — 六列看板 UI（固定高对比按钮 + 对话跳转） |
| `package.json` | 声明 peerDependencies |
| `scripts/check-syntax.js` | 语法校验脚本 |
| `test/simulate-host.js` | 全流程模拟测试（16 项断言） |

不需要 `cordis.yml`、不需要 TypeScript 编译、不需要 `export.sh`。

---

## 最少文件集合对比

### 标准插件安装（方式 A：本地插件包）

```
dsh-requirements-bundle/
├── cordis.yml          ← 必须
├── package.json        ← 必须
├── export.sh           ← 可选
├── README.md           ← 可选
└── src/
    ├── types.ts        ← 必须
    ├── service.ts      ← 必须
    ├── store.ts        ← 必须
    ├── queue.ts        ← 必须
    ├── tools.ts        ← 必须
    ├── prompt.ts       ← 必须
    └── index.ts        ← 可选
```

### 动态插件安装（cordis_define）

```
dsh-task-panel/
├── package.json        ← 必须
├── README.md           ← 可选
├── src/
│   ├── host.js         ← 必须（整合了所有逻辑）
│   └── client.js       ← 必须（UI 层）
├── scripts/
│   └── check-syntax.js ← 可选
└── test/
    └── simulate-host.js ← 可选
```

### 绝对核心（任何模式都需要）

1. **`package.json`** — 声明 peerDependencies（`@deepseek-ai/dsh`、`cordis`）
2. **`cordis.yml`** — 插件组合清单（标准模式）或在代码中直接 `cordis_define`（动态模式）
3. **至少一个模块** — 导出 `name` + `inject` + `apply`（标准模式）或全文粘贴 Host/Client（动态模式）

---

## 安装方式总结

| 方式 | 适用场景 | 额外文件 |
|------|---------|---------|
| 方式 A：本地插件包 | DeepSeek Harness 本地开发 | `cordis.yml` + `src/` 全部源文件 |
| 方式 B：npm 包 | 发布到 registry 后安装 | `package.json` exports + `dist/` 编译产物 |
| 方式 C：tarball 分发 | 离线部署 | `export.sh` 生成 `.tar.gz` |
| 方式 D：动态插件 | 快速迭代、无需编译 | `src/host.js` + `src/client.js` |
