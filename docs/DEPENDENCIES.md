# 依赖清单（Dependencies）

> 需求 #RQ-MSTX2QMA-2「整理该插件需要的依赖」的交付文档。
> 本插件是 DeepSeek Harness (DSH) 的**动态 Cordis 插件**：`src/host.js` + `src/client.js`
> 即全部可部署代码，**零第三方运行时依赖**（无 `dependencies`），
> 运行所需的全部服务由宿主 DSH 注入。仓库的依赖分三层：

| 层 | 依赖 | 是否随仓库打包 | 提供方 | 说明 |
| --- | --- | --- | --- | --- |
| npm peer 依赖 | `@deepseek-ai/dsh`（>=1.0.0） | 否 | 宿主 DSH | 提供 subagents/agents 等全部 Host 服务 |
| npm peer 依赖 | `cordis`（>=0.0.0） | 否 | 宿主 DSH | 插件运行时形状（`inject`/`apply`/`ctx.on`/`ctx.effect`） |
| 运行时服务 | 见下方「Host 服务依赖」 | 否 | 宿主注入 | `ctx.get('...')` 注入，DSH 动态插件协议的一部分 |
| 开发/校验 | 无（`devDependencies` 为空） | — | Node 内置 | `npm run check` / `npm test` 仅用 Node 内置模块 |

自动审计：`npm run check:deps`（`scripts/check-deps.js`）会扫描全部源码的
`import`/`require` 外部说明符，确认它们都已声明在 `package.json`，
并输出实际消费的 Host 服务清单——依赖声明与源码消费保持一致。

---

## 1. npm peer 依赖（宿主提供，不打包）

```json
"peerDependencies": {
  "@deepseek-ai/dsh": ">=1.0.0",
  "cordis": ">=0.0.0"
}
```

- **`@deepseek-ai/dsh`**：宿主 harness。插件运行期消费的 `subagents`、`agents`、
  `sessionQuery`、`fs`、`sandboxPolicy`、`systemPrompt`、`agentPresets`、
  `agentDefaultModel` 以及工具注册/Client RPC 等全部能力都由它提供。
- **`cordis`**：插件运行时协议（插件以 `{ inject, apply(ctx) }` 形状交付，
  使用 `ctx.on` / `ctx.effect` 等 Cordis API）。
- 两者都是 **peerDependencies**：声明「宿主必须满足的协议版本」，npm 不会把它们
  装进本仓库的 `node_modules`——DSH 动态插件没有独立安装包，`cordis_define` 时
  整文件粘贴 `src/host.js` / `src/client.js` 即可。

## 2. Host 服务依赖（运行期注入）

插件通过 `inject` 声明与 `ctx.get('...')` 读取宿主服务（`npm run check:deps` 自动审计）：

### Host 半（src/host.js）

| 服务 | 消费方式 | 用途 |
| --- | --- | --- |
| `subagents` | `ctx.subagents` | 执行队列子 session 派发（`start` + `list`） |
| `agents` | `ctx.agents` | 面板专用主 agent 创建（`create`/`roots`/`list`/`currentInitiator`） |
| `sessionQuery` | `ctx.get('sessionQuery')` | 回读子 agent 会话 transcript（`readSession`） |
| `fs` | `ctx.get('fs')` | 状态持久化（`.dsh-task-panel/requirements.json`） |
| `sandboxPolicy` | `ctx.get('sandboxPolicy')` | 解析 `workspace-write` 写盘策略 |
| `systemPrompt` | `ctx.get('systemPrompt')` | 注入需求面板状态段落（`section`） |
| `agentPresets` | `ctx.get('agentPresets')` | 面板 agent 继承根 agent 装配（`composeFrom`） |
| `agentDefaultModel` | `ctx.get('agentDefaultModel')` | 继承根 agent 的模型选择（`currentSelection`） |

### Client 半（src/client.js）

| 服务 | 消费方式 | 用途 |
| --- | --- | --- |
| `slots` | `ctx.get('slots')` | 会话视图标签页挂载点（入口：与「对话 / 轨迹」同级） |
| `sessions` | `ctx.get('sessions')` | 跳转真实子代理会话（`openSubagent`） |

> 沙箱适配：宿主沙箱没有 `AbortController`，Host 从 `agent/pre-step` 与
> `tools/execute` 事件的 `signal` 捕获 `AbortSignal` 构造器，用
> `AbortSignal.any([])` 生成「永不中断」的子 agent 信号；捕获不到时回退到
> 语义等价的鸭子类型信号（见 `src/host.js` 的 `makeNeverAbortSignal`），
> 执行器初始化不依赖任何 npm 包。

## 3. Node 内置模块（脚本/测试用，非插件运行依赖）

| 模块 | 使用处 | 用途 |
| --- | --- | --- |
| `node:fs` / `node:path` / `node:url` | `test/simulate-host.js`、`scripts/*.js` | 读取源码、解析路径 |
| `node:vm` | `test/simulate-host.js` | 以沙箱方式加载真实 `src/host.js` 做全流程模拟 |

`src/host.js` / `src/client.js` 本体**不 import 任何模块**——插件代码完全自包含。

## 4. 开发/校验工具

- `npm run check`：语法校验（`scripts/check-syntax.js`）+ 依赖审计（`scripts/check-deps.js`）。
- `npm run check:deps`：单独跑依赖审计。
- `npm test`：17 项断言的 Host 全流程模拟测试（`test/simulate-host.js`）。
- 均只依赖 Node 内置模块，无需 `npm install`（Node >= 18，见 `engines`）。

## 5. 依赖审计规则（scripts/check-deps.js）

1. 扫描 `src/`、`test/`、`scripts/` 中全部 `import` / `require` / `export-from` 说明符；
2. 相对路径（`./`、`../`）与 Node 内置模块（`node:*` 或内置名）跳过；
3. 其余外部说明符必须命中 `package.json` 的 `dependencies` / `peerDependencies` /
   `devDependencies`，否则审计失败（退出码 1）；
4. 校验 `package.json` 的 `scripts` 引用的脚本文件存在；
5. 输出 Host/Client 实际消费的服务清单，供人工核对本文档。

> 为什么不需要 `dependencies`：插件无任何第三方库；`@deepseek-ai/dsh` 与 `cordis`
> 由宿主满足 peer 协议，`fs`/`subagents` 等由宿主注入——若把它们装进仓库反而会
> 产生与宿主版本不一致的双份依赖。
