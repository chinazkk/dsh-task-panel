# About dsh-task-panel

`dsh-task-panel` 是一个面向 DeepSeek Harness Web 的任务面板插件。它把一次次聊天里的零散需求整理成可排队、可执行、可复核、可验收的看板流程，让 DSH 更适合处理连续、多步骤、需要留痕的 AI 编程任务。

## 一句话介绍

把 DSH 会话升级成 AI 任务看板：排队执行、定时低峰运行、自动复核、验收返工、历史会话关联，一屏闭环。

## 核心卖点

- 七列看板覆盖需求队列、执行队列、执行中、自动复核、已暂停、待验收、验收完成。
- 子 agent 串行执行任务，减少并发任务互相影响，也方便定位每个任务的真实子会话。
- 支持计划执行时间，适合把耗资源任务安排到低峰窗口。
- 每条任务可单独开启或关闭自动复核，复核只给结论，最终验收权仍在用户手里。
- 新建需求可自动扫描相关历史会话，用户勾选后会把摘要和 sessionId 注入执行 prompt。
- 失败、暂停、停止、返工、复核结论、测试证据都会留下记录，方便回看和排障。

## 适合谁

- 经常在 DSH 里连续安排多个编码任务的用户。
- 希望把 AI 任务从聊天记录升级为可追踪流程的小团队或独立开发者。
- 需要在夜间、低峰时段或固定窗口执行耗资源任务的人。
- 希望保留验收、返工、失败原因和子会话证据的插件/脚本/网站维护者。

## 用户能获得什么

安装后，会话视图会出现「任务面板」标签页。用户可以新建需求、绑定工作目录、设置执行时间、关联历史会话，然后把任务丢进执行队列。任务会由子 agent 串行处理，执行完可自动进入复核，随后进入待验收。用户可以通过、返工、暂停、停止或恢复任务。

## 推荐 GitHub About

- Description: `DSH Web task panel for queued sub-agent execution, scheduled runs, auto review, acceptance, rework, and historical session context.`
- Website: `https://github.com/chinazkk/dsh-task-panel#readme`
- Topics: `dsh`, `dsh-plugin`, `deepseek-harness`, `task-panel`, `kanban`, `subagent`, `agent-workflow`, `scheduled-tasks`, `auto-review`, `requirements-management`
