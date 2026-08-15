# dsh-task-panel 插件启动指南（新会话）

> 适用：DeepSeek Harness (DSH) 任一**新会话**中启动任务面板 Cordis 插件（`reqp-1` / `dsh-task-panel`）。
> 仓库：https://github.com/chinazkk/dsh-task-panel（私有） · 当前运行版本：`pkg-19`

---

## 0. 前置：确认仓库完整

```bash
git clone git@github.com:chinazkk/dsh-task-panel.git
cd dsh-task-panel
npm run check   # 语法 + 依赖审计（零第三方依赖，直接可跑）
npm test        # 19 项断言全流程模拟
```

插件全部代码 = `src/host.js` + `src/client.js`（与运行中版本逐字节一致）。

---

## 1. 首次启动（新会话，插件从未注册过）

在 DSH 会话中依次：

1. **定义插件**（粘贴两半源码）：
   - `cordis_define`
     - `plugin.kind: 'new'`，`idPrefix: 'reqp'`（Host 会分配最终 pluginId，通常为 `reqp-1`）
     - `code.host` ← 粘贴 `src/host.js` 全文
     - `code.client` ← 粘贴 `src/client.js` 全文
2. **运行插件**：
   - `cordis_run(pluginId: 返回的 id, packageId: 返回的 packageId, mode: 'run')`
   - 授权后异步启动；Client 半在浏览器激活
3. **验证**：
   - 会话视图顶部出现「任务面板」标签页（与「对话 / 轨迹」同级）
   - 调用 `list_requirements` 工具 → 输出 `【存储】ok -> …` 与面板 agent 状态

> 注意：授权只需一次（单勾 = 当前版本；双勾 = 未来版本自动授权）。

---

## 2. 同一会话/其他会话再次启动（插件已存在）

插件是 **进程级** 注册：同一 DSH 进程中已注册过 `reqp-1`，任何新会话可直接复用，**无需重新 define**。

- 新会话中直接调用面板工具（`propose_requirement` 等 8 个）即可使用；
- 面板标签页由 Client 半渲染，浏览器打开任意会话即可见。

如果插件被卸载或进程重启后注册丢失，重复「第 1 节」的 define + run 即可（源码在仓库，随时可重建）。

---

## 3. 升级到最新代码（可选）

当前运行版本应保持与仓库一致。若仓库有更新：

1. 读取最新 `src/host.js` / `src/client.js` 全文
2. `cordis_define`（`plugin.kind: 'existing'`，`pluginId: 'reqp-1'`）→ 粘贴新源码 → 得到新 `packageId`
3. `cordis_run(pluginId: 'reqp-1', packageId: 新 id, mode: 'update')`（旧版本自动停止，新版本生效）
4. 验证 `cordis_inspect_self('reqp-1')` 的 `currentPackageId` 与仓库版本一致

---

## 4. 数据与持久化

| 项 | 位置 |
| --- | --- |
| 需求/队列/产物/对话 | `<lastWorkdir>/.dsh-task-panel/requirements.json`（当前 = `/workspace/dsh-task-panel/.dsh-task-panel/requirements.json`） |
| 自动迁移 | 旧数据在 `workspaceRoot` 时，启动自动复制到绑定目录 |
| 注意 | `.dsh-task-panel/` 已被 `.gitignore` 忽略，**运行时数据不入 git** |

---

## 5. 常用工具与入口

- **8 个 Agent 工具**：`propose_requirement` / `edit_requirement` / `delete_requirement` / `dispatch_requirement` / `list_requirements` / `get_requirement` / `complete_execution` / `submit_acceptance`
- **Client RPC**（15）：`state` / `get` / `progress` / `conversation` / `create` / `update` / `remove` / `set-workdir` / `dispatch` / `recall` / `top` / `accept` / `rework` / `pause` / `stop` / `resume` / `browse-dir` / `pick-dir`（17 个 handler）
- **入口**：会话视图标签页「任务面板」（`conversation.view`，与「对话 / 轨迹」同级）

---

## 6. 故障排查

| 现象 | 检查 |
| --- | --- |
| 面板标签页不出现 | 确认 `cordis_run` 成功（Client 半 running）；刷新页面 |
| `list_requirements` 报 `【存储】…` 异常 | 查看 `persistDiag`：数据目录是否可写、`directoryPicker` 是否可用 |
| 执行器未唤醒 | `list_requirements` 看 `【面板agent】` 行：应显示 `created … model=…`；缺 model 说明 `agentDefaultModel` 未注入 |
| 版本对不上 | `cordis_inspect_self('reqp-1')` 对比 `currentPackageId` 与仓库最新提交 |
