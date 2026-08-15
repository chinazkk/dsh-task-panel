# dsh-task-panel 插件安装指南（DSH bundle 形态）

> 适用：DeepSeek Harness (DSH) **标准插件安装方式**——本插件是 **DSH bundle**（`dsh.bundle` + `dsh.client` 双 manifest），
> 用 `dsh plugin add` 一条命令装进任意 profile，**不依赖 cordis_define 动态粘贴**。
> 仓库：https://github.com/chinazkk/dsh-task-panel

---

## 0. 前置：仓库完整性自检

```bash
git clone https://github.com/chinazkk/dsh-task-panel.git
cd dsh-task-panel
npm run check   # build（tsc ×2 + tsdown 出 lib/）+ 15 组断言冒烟测试（bundle host + client）
```

插件全部可部署代码：
- `src/index.ts`（Host 半）→ 构建为 `lib/index.js`
- `src/client/index.ts`（Client 半）→ 经 tsdown 构建为浏览器 bundle `lib/client.js`（`window.__ModuleLoader__.load` 协议）

`lib/` 已随仓库提交，**git 安装无需构建权限**（不依赖 pnpm `prepare`/`allowBuilds`）。

---

## 1. 安装（dsh plugin add）

**从 GitHub 安装**（推荐，即"按 dsh plugin 的方式"）：

```bash
dsh plugin --profile <name> add github:chinazkk/dsh-task-panel
# 示例：装进默认 web profile
dsh plugin --profile web add github:chinazkk/dsh-task-panel
```

**或从本地 checkout 安装**：

```bash
dsh plugin --profile web add /path/to/dsh-task-panel
```

`dsh plugin add` 会：
1. pnpm 安装该包（含 peer 依赖解析）；
2. 因 `package.json` 声明了 `dsh.bundle`，自动把 `dsh-task-panel` 追加进 profile 的 `dsh.profile.bundles`；
3. 因声明了 `dsh.client`（platform=web），web 前端自动挂载浏览器半，`/plugins/dsh-task-panel/client.js` 由 client-modules 服务。

验证层（不启动）：

```bash
dsh --profile web --dump-config   # 输出里应出现 "# == dsh-task-panel" 层
```

启动：

```bash
dsh --profile web                  # 或 pnpm dsh web --profile web
```

## 2. 验证

1. 浏览器打开 Web UI，会话视图顶部出现「任务面板」标签页（与「对话 / 轨迹」同级，order=20）。
2. 主 agent 工具列表出现 8 个面板工具：`propose_requirement` / `edit_requirement` / `delete_requirement` /
   `dispatch_requirement` / `list_requirements` / `get_requirement` / `complete_execution` / `submit_acceptance`。
3. 新建需求 → 丢执行 → 子 session 串行执行 → 待验收（一句话产物 + 查看对话）→ 通过/返工。

## 3. 升级 / 移除

```bash
dsh plugin --profile web remove dsh-task-panel   # 移除依赖 + bundles 层
# 升级：先 remove 再 add（或直接 pnpm update github:chinazkk/dsh-task-panel）
```

> 持久化数据在需求绑定目录 `.dsh-task-panel/requirements.json`（未绑定时回退 `sandboxPolicy.workspaceRoot`），
> 插件重装/升级不影响历史数据。

## 4. 本地开发

```bash
npm install          # 仅需 typescript + tsdown（本仓库 dev 依赖，或指向本地 DSH checkout 的符号链接）
npm run build        # tsc host + tsc client + tsdown → lib/
npm run typecheck
npm test             # 15 组断言冒烟测试（bundle host 全流程 + client handoff）
dsh plugin --profile web add .   # 装本地目录，改代码后重新 build 即可热更新
```

## 5. 排障

| 现象 | 处理 |
| --- | --- |
| `dsh --profile web --dump-config` 无 `dsh-task-panel` 层 | `add` 时 package.json 必须含 `dsh.bundle`；确认装的不是旧版 |
| 浏览器 404 `/plugins/dsh-task-panel/client.js` | 确认 `lib/client.js` 存在（`npm run build`）；确认 profile 已重启 |
| 「任务面板」标签不出现 | 确认 client bundle 由 `__ModuleLoader__.load({id:"dsh-task-panel"})` 注册；看浏览器 console |
| RPC 调用失败 | 确认 Host 半已激活（`webServer` 服务存在，路由 `/plugins/dsh-task-panel/rpc` 已注册） |
