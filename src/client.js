// ─────────────────────────────────────────────────────────────
// dsh-task-panel · Client 半
// 五列看板：需求队列 → 执行队列 → 执行中 → 待验收 → 验收完成
//   · 新增 / 编辑 / 删除需求
//   · 丢执行 / 置顶 / 撤回
//   · 验收：一句话产物 + 点击查看 agent 完整对话 + 通过/返工反馈
// 通过 sidebar 底部按钮开关，面板渲染在 shell.overlay。
// ─────────────────────────────────────────────────────────────

return {
  inject: ['timer'],
  apply(ctx) {
    const slots = ctx.get('slots')
    if (!slots) return
    const h = React.createElement

    styles.insert(`
      .dtp-root { position: fixed; inset: 0; z-index: 9999; pointer-events: auto; display: flex; }
      .dtp-panel { flex: 1; margin: 12px; display: flex; flex-direction: column; background: var(--color-bg-card, #1e1e2e); border: 1px solid var(--color-border, #444); border-radius: 12px; box-shadow: 0 8px 40px rgba(0,0,0,.45); overflow: hidden; }
      .dtp-header { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--color-border, #444); background: color-mix(in srgb, var(--color-bg-card, #1e1e2e) 92%, #000); }
      .dtp-header h1 { font-size: 15px; margin: 0; font-weight: 600; flex: 1; }
      .dtp-btn { background: var(--color-bg-2, #2a2a3a); color: var(--color-text, #eee); border: 1px solid var(--color-border, #444); border-radius: 6px; padding: 4px 10px; font-size: 12px; cursor: pointer; }
      .dtp-btn:hover { background: var(--color-bg-3, #33334a); }
      .dtp-btn.primary { background: #3b82f6; border-color: #3b82f6; color: #fff; }
      .dtp-btn.danger { background: #dc2626; border-color: #dc2626; color: #fff; }
      .dtp-btn.ok { background: #10b981; border-color: #10b981; color: #fff; }
      .dtp-btn.small { padding: 2px 8px; font-size: 11px; }
      .dtp-board { flex: 1; display: grid; grid-template-columns: repeat(5, minmax(190px, 1fr)); gap: 10px; padding: 12px; overflow: auto; }
      .dtp-col { background: var(--color-bg-2, #23233a); border-radius: 10px; border: 1px solid var(--color-border, #333); display: flex; flex-direction: column; min-height: 200px; max-height: 100%; }
      .dtp-col-head { padding: 8px 10px; font-size: 12px; font-weight: 700; border-bottom: 1px solid var(--color-border, #333); display: flex; justify-content: space-between; align-items: center; }
      .dtp-col-body { padding: 8px; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 8px; }
      .dtp-card { background: var(--color-bg-card, #1e1e2e); border: 1px solid var(--color-border, #3a3a4a); border-radius: 8px; padding: 8px 10px; font-size: 12px; }
      .dtp-card-title { font-weight: 600; margin-bottom: 4px; word-break: break-all; }
      .dtp-card-meta { color: var(--color-text-2, #999); font-size: 11px; margin-bottom: 6px; }
      .dtp-pri { display: inline-block; border-radius: 4px; padding: 0 6px; font-size: 10px; font-weight: 700; color: #fff; margin-right: 4px; }
      .dtp-pri-critical { background: #dc2626; } .dtp-pri-high { background: #f59e0b; } .dtp-pri-medium { background: #3b82f6; } .dtp-pri-low { background: #64748b; }
      .dtp-deliverable { background: rgba(16,185,129,.12); border: 1px solid rgba(16,185,129,.35); border-radius: 6px; padding: 6px 8px; margin: 6px 0; color: #34d399; font-size: 11px; word-break: break-all; }
      .dtp-actions { display: flex; flex-wrap: wrap; gap: 4px; }
      .dtp-spin { display: inline-block; width: 10px; height: 10px; border: 2px solid #f59e0b; border-top-color: transparent; border-radius: 50%; animation: dtp-spin 1s linear infinite; vertical-align: middle; }
      @keyframes dtp-spin { to { transform: rotate(360deg); } }
      .dtp-modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.5); display: flex; align-items: center; justify-content: center; z-index: 10000; pointer-events: auto; }
      .dtp-modal { background: var(--color-bg-card, #1e1e2e); border: 1px solid var(--color-border, #444); border-radius: 12px; padding: 16px; width: 520px; max-width: 92vw; max-height: 84vh; overflow: auto; }
      .dtp-modal h2 { font-size: 14px; margin: 0 0 12px; }
      .dtp-field { margin-bottom: 10px; }
      .dtp-field label { display: block; font-size: 11px; color: var(--color-text-2, #999); margin-bottom: 4px; }
      .dtp-field input, .dtp-field select, .dtp-field textarea { width: 100%; box-sizing: border-box; background: var(--color-bg-2, #23233a); color: var(--color-text, #eee); border: 1px solid var(--color-border, #444); border-radius: 6px; padding: 6px 8px; font-size: 12px; }
      .dtp-modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
      .dtp-transcript { display: flex; flex-direction: column; gap: 8px; }
      .dtp-msg { border-radius: 8px; padding: 8px 10px; font-size: 12px; white-space: pre-wrap; word-break: break-all; }
      .dtp-msg.user { background: rgba(59,130,246,.15); border-left: 3px solid #3b82f6; }
      .dtp-msg.assistant { background: rgba(139,92,246,.15); border-left: 3px solid #8b5cf6; }
      .dtp-msg.tool { background: rgba(100,116,139,.15); border-left: 3px solid #64748b; color: var(--color-text-2, #aaa); font-size: 11px; }
      .dtp-msg .who { font-weight: 700; display: block; margin-bottom: 2px; }
      .dtp-empty { color: var(--color-text-2, #777); font-size: 11px; text-align: center; padding: 12px 0; }
      .dtp-toast { position: fixed; bottom: 24px; right: 24px; z-index: 10001; background: #111; color: #eee; border: 1px solid #444; border-radius: 8px; padding: 8px 14px; font-size: 12px; pointer-events: auto; }
    `)

    // ── 面板开关（sidebar 按钮 <-> overlay 共享） ──
    const openStore = { open: true, listeners: [] }
    function setOpen(v) {
      openStore.open = !!v
      for (const l of openStore.listeners) l()
    }
    function useOpen() {
      const [open, setO] = React.useState(openStore.open)
      React.useEffect(() => {
        const l = () => setO(openStore.open)
        openStore.listeners.push(l)
        return () => { openStore.listeners = openStore.listeners.filter((x) => x !== l) }
      }, [])
      return [open, setOpen]
    }

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

    function fmtTime(ts) {
      if (!ts) return ''
      const d = new Date(ts)
      return d.getMonth() + 1 + '-' + d.getDate() + ' ' + d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0')
    }

    // ── 主干组件 ──
    function TaskPanel() {
      const [data, refresh] = usePanelData()
      const [formReq, setFormReq] = React.useState(null)   // null | {mode:'create'} | {mode:'edit', id}
      const [reworkReq, setReworkReq] = React.useState(null) // null | {id,title}
      const [convReq, setConvReq] = React.useState(null)    // null | {id,title,sessionId}
      const [toast, setToast] = React.useState(null)
      const [, setOpenNow] = useOpen()

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
        { stage: 'accepting', title: '待验收', color: '#10b981', count: byStage('accepting').length },
        { stage: 'accepted', title: '验收完成', color: '#64748b', count: byStage('accepted').length },
      ]

      const doCall = (method, args) => {
        host.call(method, args).then(() => refresh()).catch((e) => setToast('操作失败：' + (e && e.message ? e.message : String(e))))
      }

      return h('div', { className: 'dtp-root' },
        h('div', { className: 'dtp-panel' },
          h('div', { className: 'dtp-header' },
            h('h1', null, '任务面板 · 需求面板'),
            h('span', { style: { fontSize: 11, color: '#888' } },
              (data ? data.requirements.length : 0) + ' 条需求 · 队列自动在子 session 执行'),
            h('button', { className: 'dtp-btn primary', onClick: () => setFormReq({ mode: 'create' }) }, '＋ 新建需求'),
            h('button', { className: 'dtp-btn', onClick: () => setOpen(false) }, '收起'),
          ),
          h('div', { className: 'dtp-board' },
            columns.map((col) =>
              h('div', { className: 'dtp-col', key: col.stage, style: { borderTop: '3px solid ' + col.color } },
                h('div', { className: 'dtp-col-head' },
                  h('span', null, col.title),
                  h('span', { style: { color: '#888' } }, String(col.count)),
                ),
                h('div', { className: 'dtp-col-body' },
                  byStage(col.stage).length === 0
                    ? h('div', { className: 'dtp-empty' }, '— 空 —')
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
                          onConv: () => setConvReq({ id: r.id, title: r.title, sessionId: r.lastSessionId }),
                        }),
                      ),
                ),
              ),
            ),
          ),
        ),
        formReq ? h(RequirementForm, {
          req: formReq.mode === 'edit' && data ? data.requirements.find((r) => r.id === formReq.id) : null,
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
      const { req, stage, onEdit, onDelete, onDispatch, onRecall, onTop, onAccept, onRework, onConv } = props
      const [confirmDel, setConfirmDel] = React.useState(false)
      React.useEffect(() => {
        if (!confirmDel) return
        const disposer = ctx.timeout(() => setConfirmDel(false), 2500)
        return () => { if (typeof disposer === 'function') disposer() }
      }, [confirmDel])

      let actions = null
      if (stage === 'backlog') {
        actions = h('div', { className: 'dtp-actions' },
          h('button', { className: 'dtp-btn small primary', onClick: onDispatch }, '丢执行'),
          h('button', { className: 'dtp-btn small', onClick: onEdit }, '编辑'),
          h('button', { className: 'dtp-btn small danger', onClick: () => { if (confirmDel) { setConfirmDel(false); onDelete() } else setConfirmDel(true) } }, confirmDel ? '确认删除?' : '删除'),
        )
      } else if (stage === 'queued') {
        actions = h('div', { className: 'dtp-actions' },
          h('button', { className: 'dtp-btn small', onClick: onTop }, '⤒ 置顶'),
          h('button', { className: 'dtp-btn small', onClick: onRecall }, '撤回'),
          h('button', { className: 'dtp-btn small danger', onClick: () => { if (confirmDel) { setConfirmDel(false); onDelete() } else setConfirmDel(true) } }, confirmDel ? '确认删除?' : '删除'),
        )
      } else if (stage === 'executing') {
        actions = h('div', { className: 'dtp-actions' },
          h('span', { style: { fontSize: 11, color: '#f59e0b' } }, h('span', { className: 'dtp-spin' }), ' 子 agent 执行中…'),
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
          h('span', { style: { fontSize: 11, color: '#34d399' } }, '✓ 验收通过'),
        )
      }

      const pri = String(req.priority || 'medium')

      return h('div', { className: 'dtp-card' },
        h('div', { className: 'dtp-card-title' },
          h('span', { className: 'dtp-pri dtp-pri-' + pri }, pri),
          req.title,
        ),
        h('div', { className: 'dtp-card-meta' },
          req.id + ' · 要素' + req.elementCount + ' · 验收' + req.criterionCount +
          (req.reworkCount ? ' · 返工' + req.reworkCount : '') +
          (req.reworkReason ? ' · ' + String(req.reworkReason).slice(0, 24) : ''),
        ),
        (stage === 'accepting' || stage === 'accepted') && req.deliverable
          ? h('div', { className: 'dtp-deliverable', title: '验收产物（一句话）' },
              '产物：' + req.deliverable,
            )
          : null,
        actions,
      )
    }

    // ── 新建 / 编辑表单 ──
    function RequirementForm(props) {
      const { req, onClose, onSaved, onToast } = props
      const isEdit = !!req
      const [title, setTitle] = React.useState(req ? req.title : '')
      const [description, setDescription] = React.useState(req ? req.description : '')
      const [priority, setPriority] = React.useState(req ? req.priority : 'medium')
      const [scope, setScope] = React.useState(req ? (req.scope || []).join(', ') : '')
      const [command, setCommand] = React.useState(req ? req.command || '' : '')
      const [busy, setBusy] = React.useState(false)

      const save = () => {
        if (!title.trim()) { onToast('标题不能为空'); return }
        setBusy(true)
        const args = {
          title: title.trim(),
          description,
          priority,
          scope: scope.split(',').map((s) => s.trim()).filter(Boolean),
          command: command.trim() || null,
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

    // ── 查看 agent 对话 ──
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
          h('h2', null, 'Agent 执行对话 · ' + req.title),
          h('div', { style: { fontSize: 11, color: '#888', marginBottom: 8 } },
            'sessionId: ' + (detail && detail.sessionId ? detail.sessionId : '（无）') + ' · 共 ' + rows.length + ' 条消息'),
          rows.length === 0
            ? h('div', { className: 'dtp-empty' }, '（暂无对话记录）')
            : h('div', { className: 'dtp-transcript' },
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

    // ── 注册 UI ──
    slots.inject('sidebar.footer.action', () => slots.register(
      { name: 'sidebar.footer.action', id: 'dsh-task-panel', label: '任务面板', order: 10 },
      (props) => {
        const [open] = useOpen()
        const label = props && props.wide ? (open ? '任务面板 ✓' : '任务面板') : '面板'
        return h('button', {
          className: 'dtp-sidebar-btn',
          title: '任务面板',
          onClick: () => setOpen(!openStore.open),
          style: {
            display: 'flex', alignItems: 'center', gap: 6, width: '100%', boxSizing: 'border-box',
            background: 'transparent', color: 'var(--color-text, #ddd)', border: 'none', padding: '8px 10px',
            cursor: 'pointer', fontSize: 12, borderRadius: 6,
          },
        }, h('span', { style: { fontSize: 14 } }, '▦'), label)
      },
    ))

    slots.inject('shell.overlay', () => slots.register(
      { name: 'shell.overlay', id: 'dsh-task-panel', label: '任务面板', order: 100 },
      () => {
        const [open] = useOpen()
        if (!open) return null
        return h(TaskPanel)
      },
    ))
  },
}
