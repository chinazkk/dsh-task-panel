// ─────────────────────────────────────────────────────────────
// dsh-task-panel · Client 半
// 六列看板：需求队列 → 执行队列 → 执行中 → 已暂停 → 待验收 → 验收完成
//   · 新增 / 编辑 / 删除需求
//   · 丢执行 / 置顶 / 撤回
//   · 验收：一句话产物 + 查看对话（跳转真实子代理会话）+ 通过/返工反馈
// 入口：与「对话 / 轨迹」同级的会话视图标签页（conversation.view）。
// 样式：主题令牌（--dsw-alias-*）+ 精致卡片/列/按钮/弹窗；
//       按钮使用固定高对比配色（不依赖主题变量，任何主题下都清晰）。
// ─────────────────────────────────────────────────────────────

return {
  inject: ['timer'],
  apply(ctx) {
    const slots = ctx.get('slots')
    if (!slots) return
    const sessions = ctx.get('sessions')
    const h = React.createElement

    styles.insert(`
      .dtp-root { display: flex; flex-direction: column; height: 100%; min-height: 0; overflow: hidden; background: var(--dsw-alias-bg-base, #0f1115); }
      .dtp-header { flex: 0 0 auto; display: flex; align-items: center; gap: 12px; padding: 14px 18px; border-bottom: 1px solid var(--dsw-alias-border-l1, #262a33); background: linear-gradient(180deg, color-mix(in srgb, var(--dsw-alias-bg-layer-1, #171a22) 55%, transparent), transparent); }
      .dtp-title { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; }
      .dtp-logo { width: 34px; height: 34px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 17px; color: #fff; background: linear-gradient(135deg, #3b82f6, #8b5cf6); box-shadow: 0 3px 10px rgba(59, 130, 246, .4); flex: 0 0 auto; }
      .dtp-title h1 { font-size: 15px; margin: 0; font-weight: 700; letter-spacing: .2px; color: var(--dsw-alias-label-primary, #ececf1); }
      .dtp-title .sub { font-size: 11px; color: var(--dsw-alias-label-secondary, #8b8f9c); margin-top: 2px; }
      .dtp-btn { border-radius: 8px; padding: 6px 13px; font-size: 12px; font-weight: 600; border: 1px solid #4a5470; background: linear-gradient(180deg, #343b4e, #262c3c); color: #f2f4f9; cursor: pointer; transition: background .15s, border-color .15s, transform .1s, box-shadow .15s; box-shadow: 0 1px 2px rgba(0,0,0,.35); }
      .dtp-btn:hover { border-color: #6d7899; background: linear-gradient(180deg, #3d455b, #2d3346); }
      .dtp-btn:active { transform: scale(.97); }
      .dtp-btn.primary { background: linear-gradient(180deg, #3b82f6, #2563eb); border-color: #1d4ed8; color: #fff; box-shadow: 0 2px 8px rgba(37, 99, 235, .5); }
      .dtp-btn.primary:hover { filter: brightness(1.14); }
      .dtp-btn.ok { background: linear-gradient(180deg, #10b981, #059669); border-color: #047857; color: #fff; box-shadow: 0 2px 6px rgba(16, 185, 129, .4); }
      .dtp-btn.ok:hover { filter: brightness(1.14); }
      .dtp-btn.danger { background: linear-gradient(180deg, #ef4444, #dc2626); border-color: #b91c1c; color: #fff; box-shadow: 0 2px 6px rgba(239, 68, 68, .4); }
      .dtp-btn.danger:hover { filter: brightness(1.14); }
      .dtp-btn.ghost { background: transparent; border-color: #4a5470; color: #dfe3ee; box-shadow: none; }
      .dtp-btn.ghost:hover { background: rgba(255,255,255,.08); border-color: #6d7899; }
      .dtp-btn.small { padding: 3px 10px; font-size: 11px; border-radius: 7px; }
      .dtp-board { flex: 1; min-height: 0; display: grid; grid-template-columns: repeat(6, minmax(170px, 1fr)); gap: 12px; padding: 14px 18px; overflow: auto; }
      .dtp-col { background: color-mix(in srgb, var(--dsw-alias-bg-layer-1, #171a22) 45%, transparent); border: 1px solid var(--dsw-alias-border-l1, #232735); border-radius: 12px; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
      .dtp-col-head { padding: 11px 12px 9px; display: flex; align-items: center; gap: 8px; }
      .dtp-dot { width: 8px; height: 8px; border-radius: 50%; box-shadow: 0 0 8px currentColor; flex: 0 0 auto; }
      .dtp-col-head .name { font-size: 12px; font-weight: 650; color: var(--dsw-alias-label-primary, #e4e6ec); flex: 1; letter-spacing: .2px; }
      .dtp-count { font-size: 11px; font-weight: 600; padding: 1px 9px; border-radius: 99px; background: var(--dsw-alias-bg-layer-2, #20242f); color: var(--dsw-alias-label-secondary, #9297a5); border: 1px solid var(--dsw-alias-border-l1, #2c3140); }
      .dtp-col-body { flex: 1; min-height: 0; padding: 4px 8px 10px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
      .dtp-card { background: var(--dsw-alias-bg-layer-1, #171a22); border: 1px solid var(--dsw-alias-border-l1, #262b38); border-radius: 10px; padding: 10px 12px; transition: border-color .15s, transform .15s, box-shadow .15s; }
      .dtp-card:hover { border-color: var(--dsw-alias-border-l2, #3d4354); transform: translateY(-1px); box-shadow: 0 6px 16px rgba(0,0,0,.28); }
      .dtp-card-title { font-weight: 600; font-size: 12.5px; color: var(--dsw-alias-label-primary, #ececf1); margin-bottom: 5px; word-break: break-all; line-height: 1.4; }
      .dtp-card-meta { color: var(--dsw-alias-label-secondary, #9297a5); font-size: 10.5px; margin-bottom: 7px; display: flex; flex-wrap: wrap; gap: 3px 8px; align-items: center; }
      .dtp-pri { display: inline-flex; align-items: center; gap: 5px; border-radius: 99px; padding: 1px 9px; font-size: 10px; font-weight: 700; letter-spacing: .3px; }
      .dtp-pri::before { content: ''; width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
      .dtp-pri-critical { background: rgba(239, 68, 68, .16); color: #f87171; }
      .dtp-pri-high { background: rgba(245, 158, 11, .16); color: #fbbf24; }
      .dtp-pri-medium { background: rgba(59, 130, 246, .16); color: #60a5fa; }
      .dtp-pri-low { background: rgba(156, 163, 175, .14); color: #9aa0ac; }
      .dtp-deliverable { display: flex; gap: 6px; align-items: flex-start; margin: 2px 0 8px; padding: 8px 10px; border-radius: 8px; background: rgba(16, 185, 129, .11); border: 1px solid rgba(16, 185, 129, .28); color: #34d399; font-size: 11px; line-height: 1.5; word-break: break-all; }
      .dtp-deliverable .lab { font-weight: 700; flex: 0 0 auto; }
      .dtp-actions { display: flex; flex-wrap: wrap; gap: 5px; }
      .dtp-spin { display: inline-block; width: 11px; height: 11px; border: 2px solid #f59e0b; border-top-color: transparent; border-radius: 50%; animation: dtp-spin .8s linear infinite; vertical-align: middle; margin-right: 6px; }
      @keyframes dtp-spin { to { transform: rotate(360deg); } }
      .dtp-badge { font-size: 11px; color: #34d399; font-weight: 600; }
      .dtp-empty { color: var(--dsw-alias-label-secondary, #6b7080); font-size: 11px; text-align: center; padding: 18px 0; }
      .dtp-modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.55); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; z-index: 10000; }
      .dtp-modal { background: var(--dsw-alias-bg-overlay, #1a1e28); border: 1px solid var(--dsw-alias-border-l2, #3a4052); border-radius: 14px; padding: 18px 20px; width: 540px; max-width: 92vw; max-height: 84vh; overflow: auto; box-shadow: 0 24px 70px rgba(0,0,0,.5); }
      .dtp-modal h2 { font-size: 14px; margin: 0 0 14px; color: var(--dsw-alias-label-primary, #ececf1); font-weight: 650; }
      .dtp-field { margin-bottom: 12px; }
      .dtp-field label { display: block; font-size: 11px; color: var(--dsw-alias-label-secondary, #9297a5); margin-bottom: 5px; font-weight: 550; }
      .dtp-field input, .dtp-field select, .dtp-field textarea { width: 100%; box-sizing: border-box; background: var(--dsw-alias-bg-layer-2, #20242f); color: var(--dsw-alias-label-primary, #ececf1); border: 1px solid var(--dsw-alias-border-l1, #2c3140); border-radius: 8px; padding: 7px 10px; font-size: 12px; outline: none; transition: border-color .15s; }
      .dtp-field input:focus, .dtp-field select:focus, .dtp-field textarea:focus { border-color: #3b82f6; }
      .dtp-modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
      .dtp-transcript { display: flex; flex-direction: column; gap: 8px; }
      .dtp-msg { border-radius: 10px; padding: 9px 12px; font-size: 12px; white-space: pre-wrap; word-break: break-all; line-height: 1.55; }
      .dtp-msg.user { background: rgba(59, 130, 246, .12); border-left: 3px solid #3b82f6; }
      .dtp-msg.assistant { background: rgba(139, 92, 246, .12); border-left: 3px solid #8b5cf6; }
      .dtp-msg.tool { background: rgba(156, 163, 175, .12); border-left: 3px solid #9ca3af; color: var(--dsw-alias-label-secondary, #a0a6b2); font-size: 11px; }
      .dtp-msg .who { font-weight: 700; display: block; margin-bottom: 3px; color: var(--dsw-alias-label-primary, #ececf1); }
      .dtp-toast { position: fixed; bottom: 26px; right: 26px; z-index: 10001; background: var(--dsw-alias-bg-overlay, #1a1e28); color: var(--dsw-alias-label-primary, #ececf1); border: 1px solid var(--dsw-alias-border-l2, #3a4052); border-radius: 10px; padding: 9px 15px; font-size: 12px; box-shadow: 0 10px 30px rgba(0,0,0,.4); }
      .dtp-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
      .dtp-scroll::-webkit-scrollbar-thumb { background: var(--dsw-alias-border-l2, #333948); border-radius: 99px; }
    `)

    // ── 数据轮询 ──
    function usePanelData() {
      const [data, setData] = React.useState(null)
      const refresh = React.useCallback(() => {
        host.call('state').then((d) => { if (d) setData(d) }).catch(() => {})
      }, [])
      React.useEffect(() => {
        refresh()
        const disposer = ctx.interval(() => refresh(), 1500)
        return () => { if (typeof disposer === 'function') disposer() }
      }, [refresh])
      return [data, refresh]
    }

    // ── 跳转到真实子代理会话（失败回退 false → 显示对话摘要弹窗） ──
    async function openAgentConversation(sessionId, parentSessionId) {
      if (!sessions || !sessionId) return false
      const parent = parentSessionId || null
      try {
        if (parent && typeof sessions.refreshSubagents === 'function') {
          try { await sessions.refreshSubagents(parent) } catch (e) { /* noop */ }
        }
        if (parent && typeof sessions.subagentAddress === 'function') {
          const known = sessions.subagentAddress(sessionId)
          if (known) { sessions.openSubagent(known); return true }
        }
        if (parent && typeof sessions.openSubagent === 'function') {
          sessions.openSubagent({ parentSessionId: parent, childSessionId: sessionId, mode: 'one-shot' })
          return true
        }
        if (typeof sessions.open === 'function') { sessions.open(sessionId); return true }
      } catch (e) { /* fallthrough */ }
      return false
    }

    // ── 主干组件（渲染在会话视图标签页内） ──
    function TaskPanel(props) {
      const [data, refresh] = usePanelData()
      const [formReq, setFormReq] = React.useState(null)   // null | {mode:'create'} | {mode:'edit', id}
      const [reworkReq, setReworkReq] = React.useState(null) // null | {id,title}
      const [convReq, setConvReq] = React.useState(null)    // null | {id,title,sessionId}
      const [toast, setToast] = React.useState(null)

      React.useEffect(() => {
        if (!toast) return
        const disposer = ctx.timeout(() => setToast(null), 2600)
        return () => { if (typeof disposer === 'function') disposer() }
      }, [toast])

      const byStage = (s) => (data ? data.requirements.filter((r) => r.stage === s) : [])

      const columns = [
        { stage: 'backlog', title: '需求队列', color: '#3b82f6', count: byStage('backlog').length },
        { stage: 'queued', title: '执行队列', color: '#8b5cf6', count: byStage('queued').length },
        { stage: 'executing', title: '执行中', color: '#f59e0b', count: byStage('executing').length },
        { stage: 'paused', title: '已暂停', color: '#64748b', count: byStage('paused').length },
        { stage: 'accepting', title: '待验收', color: '#10b981', count: byStage('accepting').length },
        { stage: 'accepted', title: '验收完成', color: '#34d399', count: byStage('accepted').length },
      ]

      const doCall = (method, args) => {
        host.call(method, args).then(() => refresh()).catch((e) => setToast('操作失败：' + (e && e.message ? e.message : String(e))))
      }

      // 查看对话：优先跳转真实子代理会话；不可跳转时回退到对话摘要弹窗
      const viewConversation = (r) => {
        openAgentConversation(r.lastSessionId, r.lastParentSessionId).then((ok) => {
          if (!ok) setConvReq({ id: r.id, title: r.title, sessionId: r.lastSessionId })
        })
      }

      const total = data ? data.requirements.length : 0
      const executing = byStage('executing').length
      const accepting = byStage('accepting').length

      return h('div', { className: 'dtp-root' },
        h('div', { className: 'dtp-header' },
          h('div', { className: 'dtp-title' },
            h('div', { className: 'dtp-logo' }, '▦'),
            h('div', null,
              h('h1', null, '任务面板'),
              h('div', { className: 'sub' },
                total + ' 条需求' + (executing ? ' · ' + executing + ' 执行中' : '') + (accepting ? ' · ' + accepting + ' 待验收' : '') + ' · 队列在子 session 自动执行'),
            ),
          ),
          h('button', { className: 'dtp-btn primary', onClick: () => setFormReq({ mode: 'create' }) }, '＋ 新建需求'),
        ),
        h('div', { className: 'dtp-board dtp-scroll' },
          columns.map((col) =>
            h('div', { className: 'dtp-col', key: col.stage, style: { borderTop: '3px solid ' + col.color } },
              h('div', { className: 'dtp-col-head' },
                h('span', { className: 'dtp-dot', style: { color: col.color, background: col.color } }),
                h('span', { className: 'name' }, col.title),
                h('span', { className: 'dtp-count' }, String(col.count)),
              ),
              h('div', { className: 'dtp-col-body dtp-scroll' },
                byStage(col.stage).length === 0
                  ? h('div', { className: 'dtp-empty' }, '— 暂无需求 —')
                  : byStage(col.stage).map((r) =>
                      h(Card, {
                        key: r.id,
                        req: r,
                        stage: col.stage,
                        onEdit: () => setFormReq({ mode: 'edit', id: r.id }),
                        onDelete: () => doCall('remove', { id: r.id }),
                        onDispatch: () => doCall('dispatch', { id: r.id }),
                        onRecall: () => doCall('recall', { id: r.id }),
                        onTop: () => doCall('top', { id: r.id }),
                        onAccept: () => doCall('accept', { id: r.id }),
                        onRework: () => setReworkReq({ id: r.id, title: r.title }),
                        onPause: () => doCall('pause', { id: r.id }),
                        onStop: () => doCall('stop', { id: r.id }),
                        onResume: () => doCall('resume', { id: r.id }),
                        onConv: () => viewConversation(r),
                      }),
                    ),
              ),
            ),
          ),
        ),
        formReq ? h(RequirementForm, {
          req: formReq.mode === 'edit' && data ? data.requirements.find((x) => x.id === formReq.id) : null,
          lastWorkdir: data ? data.lastWorkdir : null,
          onClose: () => setFormReq(null),
          onSaved: () => { setFormReq(null); refresh() },
          onToast: (m) => setToast(m),
        }) : null,
        reworkReq ? h(ReworkModal, {
          req: reworkReq,
          onClose: () => setReworkReq(null),
          onDone: () => { setReworkReq(null); refresh() },
          onToast: (m) => setToast(m),
        }) : null,
        convReq ? h(ConversationModal, {
          req: convReq,
          onClose: () => setConvReq(null),
        }) : null,
        toast ? h('div', { className: 'dtp-toast' }, toast) : null,
      )
    }

    // ── 需求卡片 ──
    function Card(props) {
      const { req, stage, onEdit, onDelete, onDispatch, onRecall, onTop, onAccept, onRework, onPause, onStop, onResume, onConv } = props
      const [confirmDel, setConfirmDel] = React.useState(false)
      React.useEffect(() => {
        if (!confirmDel) return
        const disposer = ctx.timeout(() => setConfirmDel(false), 2500)
        return () => { if (typeof disposer === 'function') disposer() }
      }, [confirmDel])

      const delBtn = h('button', { className: 'dtp-btn small danger', onClick: () => { if (confirmDel) { setConfirmDel(false); onDelete() } else setConfirmDel(true) } }, confirmDel ? '确认删除?' : '删除')

      let actions = null
      if (stage === 'backlog') {
        actions = h('div', { className: 'dtp-actions' },
          h('button', { className: 'dtp-btn small primary', onClick: onDispatch }, '丢执行'),
          h('button', { className: 'dtp-btn small', onClick: onEdit }, '编辑'),
          delBtn,
        )
      } else if (stage === 'queued') {
        actions = h('div', { className: 'dtp-actions' },
          h('button', { className: 'dtp-btn small', onClick: onTop }, '⤒ 置顶'),
          h('button', { className: 'dtp-btn small', onClick: onRecall }, '撤回'),
          delBtn,
        )
      } else if (stage === 'executing') {
        actions = h('div', { className: 'dtp-actions' },
          h('span', { style: { fontSize: 11, color: '#fbbf24', flexBasis: '100%' } }, h('span', { className: 'dtp-spin' }), '子 agent 执行中…'),
          h('button', { className: 'dtp-btn small', onClick: onPause }, '⏸ 暂停'),
          h('button', { className: 'dtp-btn small danger', onClick: onStop }, '⏹ 停止'),
        )
      } else if (stage === 'paused') {
        actions = h('div', { className: 'dtp-actions' },
          h('button', { className: 'dtp-btn small primary', onClick: onResume }, '▶ 恢复'),
          h('button', { className: 'dtp-btn small danger', onClick: () => { if (confirmDel) { setConfirmDel(false); onDelete() } else setConfirmDel(true) } }, confirmDel ? '确认删除?' : '删除'),
        )
      } else if (stage === 'accepting') {
        actions = h('div', { className: 'dtp-actions' },
          h('button', { className: 'dtp-btn small', onClick: onConv }, '查看对话'),
          h('button', { className: 'dtp-btn small ok', onClick: onAccept }, '✓ 通过'),
          h('button', { className: 'dtp-btn small danger', onClick: onRework }, '↻ 返工'),
        )
      } else if (stage === 'accepted') {
        actions = h('div', { className: 'dtp-actions' },
          h('button', { className: 'dtp-btn small', onClick: onConv }, '查看对话'),
          h('span', { className: 'dtp-badge' }, '✓ 验收通过'),
        )
      }

      const pri = String(req.priority || 'medium')

      return h('div', { className: 'dtp-card' },
        h('div', { className: 'dtp-card-title' },
          h('span', { className: 'dtp-pri dtp-pri-' + pri }, pri),
          ' ',
          req.title,
        ),
        h('div', { className: 'dtp-card-meta' },
          h('span', null, req.id),
          h('span', null, '要素 ' + req.elementCount),
          h('span', null, '验收 ' + req.criterionCount),
          req.workdir ? h('span', { title: '绑定工作目录', style: { color: 'var(--dsw-alias-label-secondary, #9297a5)', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, '📁 ' + req.workdir) : h('span', { style: { color: '#fbbf24' } }, '⚠ 未绑定目录'),
          req.reworkCount ? h('span', { style: { color: '#fbbf24' } }, '返工 ' + req.reworkCount) : null,
        ),
        (stage === 'accepting' || stage === 'accepted') && req.deliverable
          ? h('div', { className: 'dtp-deliverable', title: '验收产物（一句话）' },
              h('span', { className: 'lab' }, '产物'),
              req.deliverable,
            )
          : null,
        actions,
      )
    }

    // ── 新建 / 编辑表单 ──
    function RequirementForm(props) {
      const { req, lastWorkdir, onClose, onSaved, onToast } = props
      const isEdit = !!req
      const [title, setTitle] = React.useState(req ? req.title : '')
      const [description, setDescription] = React.useState(req ? req.description : '')
      const [priority, setPriority] = React.useState(req ? req.priority : 'medium')
      const [scope, setScope] = React.useState(req ? (req.scope || []).join(', ') : '')
      const [command, setCommand] = React.useState(req ? req.command || '' : '')
      // 工作目录：编辑沿用需求绑定；新建默认用上次绑定（无则空，提示绑定）
      const [workdir, setWorkdir] = React.useState(req ? (req.workdir || '') : (lastWorkdir || ''))
      const [busy, setBusy] = React.useState(false)

      const save = () => {
        if (!title.trim()) { onToast('标题不能为空'); return }
        if (!workdir.trim()) { onToast('请绑定工作目录（子 agent 将在此目录执行）'); return }
        setBusy(true)
        const args = {
          title: title.trim(),
          description,
          priority,
          scope: scope.split(',').map((s) => s.trim()).filter(Boolean),
          command: command.trim() || null,
          workdir: workdir.trim(),
        }
        const method = isEdit ? 'update' : 'create'
        if (isEdit) args.id = req.id
        host.call(method, args).then(() => {
          setBusy(false)
          onSaved()
        }).catch((e) => {
          setBusy(false)
          onToast('保存失败：' + (e && e.message ? e.message : String(e)))
        })
      }

      return h('div', { className: 'dtp-modal-backdrop', onClick: onClose },
        h('div', { className: 'dtp-modal', onClick: (e) => e.stopPropagation() },
          h('h2', null, isEdit ? '编辑需求 ' + req.id : '新建需求'),
          !isEdit && !workdir
            ? h('div', { className: 'dtp-field', style: { background: 'rgba(245,158,11,.12)', border: '1px solid rgba(245,158,11,.35)', borderRadius: 8, padding: '7px 10px', color: '#fbbf24', fontSize: 11 } },
                '⚠ 尚未绑定工作目录，子 agent 执行时无法确定落盘位置，请填写下方「绑定工作目录」。',
              )
            : null,
          h('div', { className: 'dtp-field' },
            h('label', null, '标题 *'),
            h('input', { value: title, onChange: (e) => setTitle(e.target.value), placeholder: '一句话描述需求' }),
          ),
          h('div', { className: 'dtp-field' },
            h('label', null, '详细描述'),
            h('textarea', { value: description, onChange: (e) => setDescription(e.target.value), rows: 3, placeholder: '背景 / 目标 / 约束' }),
          ),
          h('div', { className: 'dtp-field' },
            h('label', null, '优先级'),
            h('select', { value: priority, onChange: (e) => setPriority(e.target.value) },
              ['critical', 'high', 'medium', 'low'].map((p) => h('option', { key: p, value: p }, p)),
            ),
          ),
          h('div', { className: 'dtp-field' },
            h('label', null, '绑定工作目录 *'),
            h('input', { value: workdir, onChange: (e) => setWorkdir(e.target.value), placeholder: '如: /Users/xxx/project 或 ~/project（子 agent 在此目录执行）' }),
          ),
          h('div', { className: 'dtp-field' },
            h('label', null, '涉及范围（逗号分隔）'),
            h('input', { value: scope, onChange: (e) => setScope(e.target.value), placeholder: '如: src/, docs/' }),
          ),
          h('div', { className: 'dtp-field' },
            h('label', null, '执行命令（可选）'),
            h('input', { value: command, onChange: (e) => setCommand(e.target.value), placeholder: '如: npm test' }),
          ),
          h('div', { className: 'dtp-modal-actions' },
            h('button', { className: 'dtp-btn', onClick: onClose }, '取消'),
            h('button', { className: 'dtp-btn primary', onClick: save, disabled: busy }, busy ? '保存中…' : '保存'),
          ),
        ),
      )
    }

    // ── 返工反馈 ──
    function ReworkModal(props) {
      const { req, onClose, onDone, onToast } = props
      const [feedback, setFeedback] = React.useState('')
      const [busy, setBusy] = React.useState(false)

      const submit = () => {
        if (!feedback.trim()) { onToast('请填写验收反馈（返工原因）'); return }
        setBusy(true)
        host.call('rework', { id: req.id, feedback: feedback.trim() }).then(() => {
          setBusy(false)
          onDone()
        }).catch((e) => {
          setBusy(false)
          onToast('返工失败：' + (e && e.message ? e.message : String(e)))
        })
      }

      return h('div', { className: 'dtp-modal-backdrop', onClick: onClose },
        h('div', { className: 'dtp-modal', onClick: (e) => e.stopPropagation() },
          h('h2', null, '验收反馈 · ' + req.title),
          h('div', { className: 'dtp-field' },
            h('label', null, '反馈内容（作为返工原因，将带着它重入执行队列重新执行）'),
            h('textarea', { value: feedback, onChange: (e) => setFeedback(e.target.value), rows: 4, placeholder: '如：产物缺少测试用例，请补充单测并验证通过' }),
          ),
          h('div', { className: 'dtp-modal-actions' },
            h('button', { className: 'dtp-btn', onClick: onClose }, '取消'),
            h('button', { className: 'dtp-btn danger', onClick: submit, disabled: busy }, busy ? '提交中…' : '确认返工'),
          ),
        ),
      )
    }

    // ── 对话摘要弹窗（跳转真实子代理会话不可用时回退） ──
    function ConversationModal(props) {
      const { req, onClose } = props
      const [detail, setDetail] = React.useState(null)

      React.useEffect(() => {
        let cancelled = false
        host.call('conversation', { id: req.id, sessionId: req.sessionId }).then((d) => {
          if (!cancelled) setDetail(d)
        }).catch(() => { if (!cancelled) setDetail({ transcript: [] }) })
        return () => { cancelled = true }
      }, [req.id, req.sessionId])

      const who = { user: '用户输入', assistant: 'Agent 回复', tool: '工具调用' }
      const rows = detail && Array.isArray(detail.transcript) ? detail.transcript : []

      return h('div', { className: 'dtp-modal-backdrop', onClick: onClose },
        h('div', { className: 'dtp-modal', style: { width: 640 }, onClick: (e) => e.stopPropagation() },
          h('h2', null, 'Agent 对话摘要 · ' + req.title),
          h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary, #9297a5)', marginBottom: 10 } },
            'sessionId: ' + (detail && detail.sessionId ? detail.sessionId : '（无）') + ' · 共 ' + rows.length + ' 条消息' +
            '（会话已不可直接跳转，展示已捕获的摘要）'),
          rows.length === 0
            ? h('div', { className: 'dtp-empty' }, '（暂无对话记录）')
            : h('div', { className: 'dtp-transcript dtp-scroll' },
                rows.map((m, i) =>
                  h('div', { className: 'dtp-msg ' + m.role, key: i },
                    h('span', { className: 'who' }, who[m.role] || m.role),
                    m.text,
                  ),
                ),
              ),
          h('div', { className: 'dtp-modal-actions' },
            h('button', { className: 'dtp-btn', onClick: onClose }, '关闭'),
          ),
        ),
      )
    }

    // ── 注册：会话视图标签页（与「对话 / 轨迹」同级） ──
    slots.inject('conversation.view', () => slots.register(
      { name: 'conversation.view', id: 'dsh-task-panel', label: '任务面板', order: 20 },
      (props) => h(TaskPanel, props),
    ))
  },
}
