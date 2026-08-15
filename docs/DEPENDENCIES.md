# 依赖清单（Dependencies）

> 本插件是 DeepSeek Harness (DSH) 的 **bundle 插件**（`dsh.bundle` + `dsh.client`），
> 通过 `dsh plugin add` 安装。运行时依赖全部由宿主 DSH 提供（peer 依赖），
> 构建期依赖仅 `typescript` + `tsdown`。依赖分三层：

| 层 | 依赖 | 是否随仓库打包 | 提供方 | 说明 |
| --- | --- | --- | --- | --- |
| npm peer 依赖 | `@deepseek-ai/cordis` | 否 | 宿主 DSH | 插件运行时形状（`inject`/`apply`/`ctx.on`/`ctx.effect`） |
| npm peer 依赖 | `@deepseek-ai/dsh-tools` | 否 | 宿主 DSH | `defineTool`：工具定义 DSL（`src/index.ts` 的 `harness.defineTool` 桥） |
| npm peer 依赖 | `@deepseek-ai/dsh-client-runtime` | 否 | 宿主 DSH | Client 半运行环境（提供 `slots`/`sessions` 服务；`dsh.client.inject` 声明） |
| npm peer 依赖 | `react`（>=18） | 否 | 宿主 DSH | Client 半 UI 渲染（浏览器模块表提供） |
| 构建期 | `typescript`、`tsdown` | 否 | devDependencies | `tsc` 出 host 入口 + `tsdown` 出浏览器 client bundle |
| 运行时服务 | 见下方「Host 服务」 | 否 | 宿主注入 | `ctx.get('...')` / inject 注入，DSH 插件协议的一部分 |

---

## 1. npm peer 依赖（宿主提供，不打包）

```json
"peerDependencies": {
  "@deepseek-ai/cordis": ">=0.1.0",
  "@deepseek-ai/dsh-tools": ">=0.1.0",
  "@deepseek-ai/dsh-client-runtime": ">=0.1.0",
  "react": ">=18.0.0"
}
```

- **`@deepseek-ai/cordis`**：插件框架。`export const inject` / `export function apply(ctx)`，`ctx.on`/`ctx.effect`。
- **`@deepseek-ai/dsh-tools`**：Host 半工具注册。`src/index.ts` 用 `defineTool` 把 JSON-Schema 形态参数归一化为 DSL property map 后 `ctx.tools.register`。
- **`@deepseek-ai/dsh-client-runtime`**：Client 半运行环境。`dsh.client.inject` 声明依赖，浏览器模块表提供 `slots`/`sessions` 服务。
- **`react`**：Client 半 UI（六列看板）。浏览器模块表外部模块，bundle 内 `require('react')`。

## 2. Host 服务（宿主注入）

Host 半 `inject: ['subagents', 'agents', 'tools']`，另用 `ctx.get()` 探测：

| 服务 | 用途 |
| --- | --- |
| `subagents` | 队列 worker 派发子 agent（`list`/`start`） |
| `agents` | 根 agent 解析 + 面板专用主 agent 创建（`roots`/`list`/`create`） |
| `tools` | 8 个面板工具注册（`ctx.tools.register`） |
| `sessionQuery` | 子 agent 会话 transcript 回读（`readSession`） |
| `fs` | 状态持久化读写（`resolve`/`readText`/`writeText`） |
| `sandboxPolicy` | workspaceRoot 回退 + `workspace-write` 写盘策略解析 |
| `systemPrompt` | 面板状态提示词段落（`section`） |
| `agentPresets` | 面板 agent 继承根 agent 装配（`composeFrom`） |
| `agentDefaultModel` | 面板 agent 模型选择（`currentSelection`） |
| `directoryPicker` | 目录选择器（`capability`/`list`/`pick`） |
| `webServer` | Client↔Host RPC 路由（`register`，路径 `/plugins/dsh-task-panel/rpc`） |

## 3. Client 服务（宿主注入）

Client 半 `inject: ['slots', 'sessions', 'timer']`：

| 服务 | 用途 |
| --- | --- |
| `slots` | 会话视图标签页注册（`slots.inject('conversation.view', …)` + `slots.register`） |
| `sessions` | 「查看对话」跳转真实子代理会话（`sessions.openSubagent`） |
| `timer` | Client 轮询定时器 |

## 4. 构建期（仅本地开发/发布）

- **`typescript`**：`tsc -p tsconfig.json`（Host 半 → `lib/index.js` + `lib/types`）、`tsc -p tsconfig.client.json`（Client 半 → `lib/client/index.js`）。
- **`tsdown`**：`tsdown.config.ts` 把 `lib/client/index.js` 打包为浏览器 bundle `lib/client.js`
  （`window.__ModuleLoader__.load({id:"dsh-task-panel", factory})`，react/cordis 等平台模块保持 external）。

> 说明：`lib/`（含 `lib/client.js`）**随仓库提交**，因此 `dsh plugin add github:chinazkk/dsh-task-panel`
> 的 git 安装直接可用，无需 pnpm `prepare` 构建权限。
