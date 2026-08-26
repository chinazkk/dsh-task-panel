// @ts-nocheck — the plugin body below is JS-style (ported from the dynamic client body).
// dsh-task-panel · Client half (bundle form)
// Converts the dynamic-plugin client body into a standard Cordis browser bundle.
// `host.call` is bridged to the host half over the `/plugins/dsh-task-panel/rpc`
// route registered by the host half; `React` is the platform module; the
// injected `slots`/`sessions` come from the client runtime.
import * as React from 'react';
const styles = {
    insert(css) {
        const el = document.createElement('style');
        el.textContent = css;
        document.head.appendChild(el);
        return () => { el.remove(); };
    },
};
const host = {
    call: (method, args) => fetch('/plugins/dsh-task-panel/rpc', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method, args: args ?? null }),
    }).then((r) => r.json()),
};
const plugin = (() => {
    // ─────────────────────────────────────────────────────────────
    // dsh-task-panel · Client 半
    // 六列看板：需求队列 → 执行队列 → 执行中 → 已暂停 → 待验收 → 验收完成
    //   · 新增 / 编辑 / 删除需求
    //   · 丢执行 / 置顶 / 撤回
    //   · 验收：一句话产物 + 查看对话（跳转真实子代理会话）+ 通过/返工反馈
    //   · 执行中：实时进度预览 + 查看进度（一键直达子代理会话——会话即实时进度）
    //   · 工作目录：目录选择器（browse 浏览 / native 系统选择器）
    //   · 验收完成产物默认收起（点击展开）
    // 入口：与「对话 / 轨迹」同级的会话视图标签页（conversation.view）。
    // 样式：主题令牌（--dsw-alias-*）+ 精致卡片/列/按钮/弹窗；
    //       按钮使用固定高对比配色（不依赖主题变量，任何主题下都清晰）。
    // ─────────────────────────────────────────────────────────────
    return {
        // 注意：不要声明未使用的 inject 服务——应用级 client 运行时没有 'timer' 服务，
        // 多余声明会让插件永久停在 PENDING（面板标签不出现）。
        inject: [],
        apply(ctx) {
            const slots = ctx.get('slots');
            if (!slots)
                return;
            const sessions = ctx.get('sessions');
            const h = React.createElement;
            // 定时器：应用级 client 上下文没有 ctx.interval/ctx.timeout（那是动态运行器的
            // timer mixin），bundle 直接用浏览器原生 setInterval/setTimeout 并返回清理函数。
            const interval = (fn, ms) => { const id = setInterval(fn, ms); return () => clearInterval(id); };
            const timeout = (fn, ms) => { const id = setTimeout(fn, ms); return () => clearTimeout(id); };
            const pad2 = (n) => String(n).padStart(2, '0');
            const toDateTimeLocalValue = (ms) => {
                if (!ms)
                    return '';
                const d = new Date(ms);
                if (Number.isNaN(d.getTime()))
                    return '';
                return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + 'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
            };
            const parseDateTimeLocalValue = (value) => {
                const text = String(value || '').trim();
                if (!text)
                    return null;
                const ms = Date.parse(text);
                return Number.isFinite(ms) ? ms : null;
            };
            const formatScheduledAt = (ms) => {
                if (!ms)
                    return '';
                const d = new Date(ms);
                if (Number.isNaN(d.getTime()))
                    return '';
                return d.toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
            };
            styles.insert(`
      .dtp-root { --dtp-accent: #a9b8cc; --dtp-accent-soft: rgba(169,184,204,.18); --dtp-glass: rgba(255,255,255,.075); --dtp-glass-strong: rgba(255,255,255,.115); --dtp-hairline: rgba(255,255,255,.14); --dtp-text: rgba(248,250,252,.96); --dtp-muted: rgba(203,213,225,.68); --dtp-faint: rgba(148,163,184,.48); --dtp-ok: #b8c9c1; --dtp-warn: #cbc1aa; --dtp-danger: #c9aeb2; --dtp-shadow: 0 18px 48px rgba(0,0,0,.28); --dtp-soft-shadow: 0 10px 30px rgba(0,0,0,.18); position: relative; display: flex; flex-direction: column; height: 100%; min-height: 0; overflow: hidden; color: var(--dtp-text); background: linear-gradient(180deg, rgba(255,255,255,.035), transparent 18%), radial-gradient(circle at 52% -26%, rgba(169,184,204,.18), transparent 32%), linear-gradient(135deg, #090d13 0%, #111821 48%, #090e14 100%); }
      .dtp-root::before { content: ''; position: absolute; inset: 0; pointer-events: none; background-image: linear-gradient(rgba(255,255,255,.026) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.024) 1px, transparent 1px); background-size: 32px 32px; mask-image: linear-gradient(180deg, rgba(0,0,0,.42), transparent 70%); }
      .dtp-header { position: relative; flex: 0 0 auto; display: flex; align-items: center; gap: 14px; padding: 13px 18px; border-bottom: 1px solid rgba(255,255,255,.105); background: linear-gradient(180deg, rgba(255,255,255,.105), rgba(255,255,255,.052)); backdrop-filter: blur(30px) saturate(135%); -webkit-backdrop-filter: blur(30px) saturate(135%); box-shadow: 0 1px 0 rgba(255,255,255,.09) inset; z-index: 1; }
      .dtp-title { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0; }
      .dtp-logo { width: 34px; height: 34px; border-radius: 9px; display: flex; align-items: center; justify-content: center; font-size: 16px; color: #f8fafc; background: linear-gradient(145deg, rgba(255,255,255,.22), rgba(255,255,255,.055)), rgba(169,184,204,.12); border: 1px solid rgba(255,255,255,.22); box-shadow: 0 10px 24px rgba(0,0,0,.20), 0 1px 0 rgba(255,255,255,.34) inset; flex: 0 0 auto; }
      .dtp-title h1 { font-size: 15px; margin: 0; font-weight: 760; letter-spacing: 0; color: var(--dtp-text); }
      .dtp-title .sub { font-size: 11px; color: var(--dtp-muted); margin-top: 2px; }
      .dtp-header-stats { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; margin-right: 2px; }
      .dtp-stat { display: inline-flex; align-items: center; gap: 6px; min-height: 24px; padding: 0 9px; border-radius: 8px; font-size: 11px; font-weight: 650; color: rgba(248,250,252,.84); background: rgba(255,255,255,.065); border: 1px solid rgba(255,255,255,.115); box-shadow: 0 1px 0 rgba(255,255,255,.10) inset; white-space: nowrap; }
      .dtp-stat::before { content: ''; width: 5px; height: 5px; border-radius: 50%; background: rgba(169,184,204,.72); }
      .dtp-btn { display: inline-flex; align-items: center; justify-content: center; gap: 5px; min-height: 30px; border-radius: 8px; padding: 6px 12px; font-size: 12px; font-weight: 650; border: 1px solid rgba(255,255,255,.14); background: linear-gradient(180deg, rgba(255,255,255,.125), rgba(255,255,255,.055)); color: rgba(248,250,252,.92); cursor: pointer; transition: transform .16s ease, box-shadow .16s ease, border-color .16s ease, background .16s ease, opacity .16s ease; box-shadow: 0 1px 0 rgba(255,255,255,.13) inset, 0 8px 18px rgba(0,0,0,.16); backdrop-filter: blur(18px) saturate(135%); -webkit-backdrop-filter: blur(18px) saturate(135%); }
      .dtp-btn:hover:not(:disabled) { border-color: rgba(255,255,255,.26); background: linear-gradient(180deg, rgba(255,255,255,.17), rgba(255,255,255,.075)); transform: translateY(-1px); box-shadow: 0 1px 0 rgba(255,255,255,.18) inset, 0 12px 24px rgba(0,0,0,.22); }
      .dtp-btn:active:not(:disabled) { transform: translateY(0) scale(.98); }
      .dtp-btn:disabled { cursor: not-allowed; opacity: .48; box-shadow: none; }
      .dtp-btn.primary { background: linear-gradient(180deg, #d4dce8, #8fa0b8); border-color: rgba(226,232,240,.46); color: #07111f; box-shadow: 0 1px 0 rgba(255,255,255,.42) inset, 0 12px 26px rgba(61,76,98,.30); }
      .dtp-btn.primary:hover:not(:disabled) { filter: brightness(1.06); }
      .dtp-btn.ok { background: linear-gradient(180deg, #c7d2cc, #7f9189); border-color: rgba(226,232,240,.34); color: #07140f; box-shadow: 0 1px 0 rgba(255,255,255,.30) inset, 0 12px 22px rgba(43,61,55,.20); }
      .dtp-btn.ok:hover:not(:disabled) { filter: brightness(1.06); }
      .dtp-btn.danger { background: linear-gradient(180deg, #c8b2b5, #8b646a); border-color: rgba(226,232,240,.24); color: #fff; box-shadow: 0 1px 0 rgba(255,255,255,.24) inset, 0 12px 22px rgba(77,42,48,.22); }
      .dtp-btn.danger:hover:not(:disabled) { filter: brightness(1.06); }
      .dtp-btn.ghost { background: rgba(255,255,255,.05); border-color: rgba(255,255,255,.12); color: #dfe7f5; box-shadow: none; }
      .dtp-btn.ghost:hover:not(:disabled) { background: rgba(255,255,255,.10); border-color: rgba(255,255,255,.24); }
      .dtp-btn.small { min-height: 25px; padding: 3px 10px; font-size: 11px; border-radius: 8px; }
      .dtp-board { position: relative; z-index: 1; flex: 1; min-height: 0; display: grid; grid-template-columns: repeat(7, minmax(172px, 1fr)); gap: 10px; padding: 14px 16px 16px; overflow: auto; }
      .dtp-col { position: relative; background: linear-gradient(180deg, rgba(255,255,255,.10), rgba(255,255,255,.045)); border: 1px solid rgba(255,255,255,.13); border-radius: 12px; display: flex; flex-direction: column; min-height: 0; overflow: hidden; box-shadow: var(--dtp-soft-shadow), 0 1px 0 rgba(255,255,255,.10) inset; backdrop-filter: blur(24px) saturate(130%); -webkit-backdrop-filter: blur(24px) saturate(130%); }
      .dtp-col::before { content: ''; position: absolute; inset: 0 0 auto; height: 2px; background: linear-gradient(90deg, transparent, var(--dtp-accent), transparent); opacity: .42; pointer-events: none; }
      .dtp-col-head { position: sticky; top: 0; z-index: 2; padding: 11px 11px 8px; display: flex; align-items: center; gap: 8px; background: linear-gradient(180deg, rgba(12,18,27,.68), rgba(12,18,27,.28)); backdrop-filter: blur(18px) saturate(130%); -webkit-backdrop-filter: blur(18px) saturate(130%); border-bottom: 1px solid rgba(255,255,255,.07); }
      .dtp-dot { width: 6px; height: 6px; border-radius: 50%; box-shadow: 0 0 10px rgba(226,232,240,.12); flex: 0 0 auto; opacity: .68; }
      .dtp-col-head .name { font-size: 12px; font-weight: 720; color: rgba(248,250,252,.93); flex: 1; letter-spacing: 0; }
      .dtp-count { font-size: 11px; font-weight: 720; padding: 1px 8px; border-radius: 8px; background: rgba(255,255,255,.075); color: rgba(226,232,240,.86); border: 1px solid rgba(255,255,255,.10); font-variant-numeric: tabular-nums; }
      .dtp-col-body { flex: 1; min-height: 0; padding: 6px 7px 9px; overflow-y: auto; display: flex; flex-direction: column; gap: 7px; }
      .dtp-card { background: linear-gradient(180deg, rgba(255,255,255,.115), rgba(255,255,255,.058)); border: 1px solid rgba(255,255,255,.12); border-radius: 10px; padding: 9px 10px; transition: border-color .16s ease, transform .16s ease, box-shadow .16s ease, background .16s ease; box-shadow: 0 1px 0 rgba(255,255,255,.10) inset, 0 7px 16px rgba(0,0,0,.14); backdrop-filter: blur(16px) saturate(130%); -webkit-backdrop-filter: blur(16px) saturate(130%); }
      .dtp-card:hover { border-color: rgba(255,255,255,.24); transform: translateY(-1px); box-shadow: 0 1px 0 rgba(255,255,255,.15) inset, 0 14px 28px rgba(0,0,0,.22); background: linear-gradient(180deg, rgba(255,255,255,.145), rgba(255,255,255,.072)); }
      .dtp-card-title { font-weight: 690; font-size: 12.5px; color: rgba(248,250,252,.96); margin-bottom: 6px; word-break: break-word; line-height: 1.42; }
      .dtp-card-meta { color: rgba(203,213,225,.74); font-size: 10.5px; margin-bottom: 8px; display: flex; flex-wrap: wrap; gap: 4px 7px; align-items: center; }
      .dtp-card-meta > span { padding: 1px 6px; border-radius: 7px; background: rgba(255,255,255,.045); border: 1px solid rgba(255,255,255,.07); }
      .dtp-pri { display: inline-flex; align-items: center; gap: 5px; border-radius: 7px; padding: 1px 8px; font-size: 10px; font-weight: 720; letter-spacing: 0; border: 1px solid rgba(255,255,255,.10); box-shadow: 0 1px 0 rgba(255,255,255,.08) inset; text-transform: uppercase; }
      .dtp-pri::before { content: ''; width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
      .dtp-pri-critical { background: rgba(201, 174, 178, .15); color: rgba(239,218,221,.92); }
      .dtp-pri-high { background: rgba(203, 193, 170, .13); color: rgba(236,230,213,.92); }
      .dtp-pri-medium { background: rgba(169, 184, 204, .14); color: rgba(224,232,244,.94); }
      .dtp-pri-low { background: rgba(148, 163, 184, .14); color: #cbd5e1; }
      .dtp-deliverable { display: flex; gap: 7px; align-items: flex-start; margin: 2px 0 8px; padding: 8px 9px; border-radius: 9px; background: rgba(184, 201, 193, .095); border: 1px solid rgba(226,232,240,.13); color: rgba(224,238,232,.92); font-size: 11px; line-height: 1.5; word-break: break-word; box-shadow: 0 1px 0 rgba(255,255,255,.08) inset; }
      .dtp-deliverable .lab { font-weight: 700; flex: 0 0 auto; }
      .dtp-deliverable-collapsed { cursor: pointer; align-items: center; opacity: .90; transition: opacity .15s, border-color .15s, background .15s; }
      .dtp-deliverable-collapsed:hover { opacity: 1; border-color: rgba(209, 250, 229, .34); background: rgba(169, 200, 187, .16); }
      .dtp-actions { display: flex; flex-wrap: wrap; gap: 6px; }
      .dtp-status-line { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; flex-basis: 100%; padding: 5px 8px; border-radius: 8px; background: rgba(255,255,255,.055); border: 1px solid rgba(255,255,255,.085); color: rgba(226,232,240,.82); }
      .dtp-spin { display: inline-block; width: 11px; height: 11px; border: 2px solid var(--dtp-warn); border-top-color: transparent; border-radius: 50%; animation: dtp-spin .8s linear infinite; vertical-align: middle; margin-right: 6px; }
      @keyframes dtp-spin { to { transform: rotate(360deg); } }
      .dtp-progress { margin: 4px 0 8px; padding: 8px 9px; border-radius: 9px; background: rgba(203, 193, 170, .082); border: 1px solid rgba(226,232,240,.12); font-size: 11px; color: rgba(226,232,240,.84); line-height: 1.5; max-height: 102px; overflow: hidden; box-shadow: 0 1px 0 rgba(255,255,255,.07) inset; }
      .dtp-progress .prow { display: flex; gap: 6px; align-items: baseline; margin-bottom: 2px; }
      .dtp-progress .pwho { flex: 0 0 auto; font-weight: 700; color: rgba(236,230,213,.92); font-size: 10px; }
      .dtp-progress .ptxt { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .dtp-progress .pmeta { font-size: 10px; color: var(--dsw-alias-label-secondary, #8b8f9c); margin-bottom: 4px; }
      .dtp-progress.jumpable { cursor: pointer; transition: border-color .15s, background .15s, transform .15s; }
      .dtp-progress.jumpable:hover { border-color: rgba(226,232,240,.22); background: rgba(203, 193, 170, .12); transform: translateY(-1px); }
      .dtp-progress.jumpable::after { content: '查看进度 / 进入会话'; display: block; margin-top: 4px; font-size: 10px; font-weight: 700; color: rgba(236,230,213,.90); }
      .dtp-review { display: flex; gap: 7px; align-items: flex-start; margin: 2px 0 8px; padding: 8px 10px; border-radius: 10px; font-size: 11px; line-height: 1.5; word-break: break-word; box-shadow: 0 1px 0 rgba(255,255,255,.08) inset; }
      .dtp-review.ok { background: rgba(184, 201, 193, .095); border: 1px solid rgba(226,232,240,.13); color: rgba(224,238,232,.92); }
      .dtp-review.bad { background: rgba(201, 174, 178, .11); border: 1px solid rgba(226,232,240,.13); color: rgba(239,218,221,.92); }
      .dtp-review .lab { font-weight: 700; flex: 0 0 auto; }
      .dtp-session-list { display: flex; flex-direction: column; gap: 6px; max-height: 150px; overflow: auto; }
      .dtp-session-option { display: flex; gap: 8px; align-items: flex-start; padding: 8px 9px; border: 1px solid rgba(255,255,255,.14); border-radius: 10px; background: rgba(255,255,255,.07); cursor: pointer; transition: background .15s, border-color .15s; }
      .dtp-session-option:hover { background: rgba(255,255,255,.11); border-color: rgba(255,255,255,.24); }
      .dtp-session-option input { width: 14px; height: 14px; margin-top: 2px; flex: 0 0 auto; accent-color: #9db7df; }
      .dtp-session-option .main { flex: 1; min-width: 0; }
      .dtp-session-option .sid { color: rgba(248,250,252,.94); font-size: 11px; font-weight: 680; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .dtp-session-option .snip { color: rgba(203,213,225,.72); font-size: 10.5px; line-height: 1.4; margin-top: 2px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
      .dtp-pulse { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--dtp-warn); margin-right: 6px; animation: dtp-pulse 1.2s ease-in-out infinite; }
      @keyframes dtp-pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: .35; transform: scale(.8); } }
      .dtp-badge { font-size: 11px; color: rgba(224,238,232,.92); font-weight: 700; padding: 2px 8px; border-radius: 7px; background: rgba(184,201,193,.10); border: 1px solid rgba(226,232,240,.13); }
      .dtp-empty { color: rgba(203,213,225,.58); font-size: 11px; text-align: center; padding: 20px 10px; border-radius: 12px; background: rgba(255,255,255,.035); border: 1px dashed rgba(255,255,255,.12); }
      .dtp-modal-backdrop { position: fixed; inset: 0; background: rgba(3,7,13,.58); backdrop-filter: blur(22px) saturate(125%); -webkit-backdrop-filter: blur(22px) saturate(125%); display: flex; align-items: center; justify-content: center; z-index: 10000; padding: 18px; }
      .dtp-modal { background: linear-gradient(180deg, rgba(28,36,48,.84), rgba(11,17,25,.78)); border: 1px solid rgba(255,255,255,.15); border-radius: 14px; padding: 18px 20px; width: 540px; max-width: 92vw; max-height: 84vh; overflow: auto; box-shadow: 0 34px 90px rgba(0,0,0,.52), 0 1px 0 rgba(255,255,255,.14) inset; backdrop-filter: blur(30px) saturate(130%); -webkit-backdrop-filter: blur(30px) saturate(130%); }
      .dtp-modal h2 { font-size: 14px; margin: 0 0 14px; color: rgba(248,250,252,.96); font-weight: 750; letter-spacing: 0; }
      .dtp-field { margin-bottom: 12px; }
      .dtp-field label { display: block; font-size: 11px; color: rgba(203,213,225,.74); margin-bottom: 5px; font-weight: 650; }
      .dtp-field input, .dtp-field select, .dtp-field textarea { width: 100%; box-sizing: border-box; background: rgba(255,255,255,.065); color: rgba(248,250,252,.96); border: 1px solid rgba(255,255,255,.12); border-radius: 9px; padding: 8px 10px; font-size: 12px; outline: none; transition: border-color .15s, background .15s, box-shadow .15s; box-shadow: 0 1px 0 rgba(255,255,255,.07) inset; }
      .dtp-field input:focus, .dtp-field select:focus, .dtp-field textarea:focus { border-color: rgba(169,184,204,.58); background: rgba(255,255,255,.10); box-shadow: 0 0 0 3px rgba(169,184,204,.14), 0 1px 0 rgba(255,255,255,.09) inset; }
      .dtp-field input::placeholder, .dtp-field textarea::placeholder { color: rgba(203,213,225,.44); }
      .dtp-check { display: flex; align-items: flex-start; gap: 9px; padding: 10px 11px; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.12); border-radius: 9px; }
      .dtp-check input { width: 16px; height: 16px; margin: 1px 0 0; flex: 0 0 auto; accent-color: #a9b8cc; }
      .dtp-check .txt { flex: 1; min-width: 0; color: rgba(248,250,252,.94); font-size: 12px; font-weight: 700; }
      .dtp-check .hint { display: block; margin-top: 2px; color: rgba(203,213,225,.70); font-size: 11px; font-weight: 400; line-height: 1.4; }
      .dtp-workdir-row { display: flex; gap: 6px; }
      .dtp-workdir-row input { flex: 1; min-width: 0; }
      .dtp-workdir-row .dtp-btn { flex: 0 0 auto; }
      .dtp-dirbrowser { display: flex; flex-direction: column; gap: 8px; min-height: 320px; }
      .dtp-dircrumbs { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; font-size: 11px; }
      .dtp-dircrumb { cursor: pointer; color: rgba(226,232,240,.90); padding: 3px 7px; border-radius: 7px; background: rgba(169,184,204,.10); border: 1px solid rgba(169,184,204,.16); }
      .dtp-dircrumb:hover { background: rgba(169,184,204,.16); }
      .dtp-dircrumb.last { color: rgba(248,250,252,.94); cursor: default; background: rgba(255,255,255,.06); border-color: rgba(255,255,255,.10); }
      .dtp-dirsep { color: rgba(203,213,225,.60); }
      .dtp-direntries { flex: 1; min-height: 0; overflow-y: auto; border: 1px solid rgba(255,255,255,.12); border-radius: 10px; background: rgba(255,255,255,.055); }
      .dtp-direntry { display: flex; align-items: center; gap: 8px; padding: 8px 12px; cursor: pointer; font-size: 12px; border-bottom: 1px solid rgba(255,255,255,.08); color: rgba(248,250,252,.94); transition: background .15s; }
      .dtp-direntry:hover { background: rgba(169,184,204,.10); }
      .dtp-direntry .ic { flex: 0 0 auto; font-size: 13px; }
      .dtp-dirselect { margin-left: auto; flex: 0 0 auto; }
      .dtp-dirpath { font-size: 11px; color: rgba(203,213,225,.76); word-break: break-word; padding: 7px 10px; background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.10); border-radius: 10px; }
      .dtp-modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
      .dtp-transcript { display: flex; flex-direction: column; gap: 8px; }
      .dtp-msg { border-radius: 12px; padding: 10px 12px; font-size: 12px; white-space: pre-wrap; word-break: break-word; line-height: 1.55; border: 1px solid rgba(255,255,255,.12); }
      .dtp-msg.user { background: rgba(169, 184, 204, .12); border-left: 3px solid rgba(169,184,204,.58); }
      .dtp-msg.assistant { background: rgba(255,255,255,.08); border-left: 3px solid rgba(226,232,240,.42); }
      .dtp-msg.tool { background: rgba(148, 163, 184, .12); border-left: 3px solid rgba(148,163,184,.46); color: rgba(203,213,225,.76); font-size: 11px; }
      .dtp-msg .who { font-weight: 750; display: block; margin-bottom: 3px; color: rgba(248,250,252,.94); }
      .dtp-toast { position: fixed; bottom: 26px; right: 26px; z-index: 10001; background: rgba(13,19,28,.82); color: rgba(248,250,252,.96); border: 1px solid rgba(255,255,255,.15); border-radius: 10px; padding: 10px 15px; font-size: 12px; box-shadow: 0 20px 50px rgba(0,0,0,.40), 0 1px 0 rgba(255,255,255,.10) inset; backdrop-filter: blur(24px) saturate(130%); -webkit-backdrop-filter: blur(24px) saturate(130%); }
      .dtp-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
      .dtp-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,.18); border-radius: 99px; border: 2px solid transparent; background-clip: padding-box; }
      .dtp-scroll::-webkit-scrollbar-track { background: transparent; }
      @media (max-width: 980px) { .dtp-header { align-items: flex-start; flex-wrap: wrap; } .dtp-header-stats { order: 3; width: 100%; justify-content: flex-start; } .dtp-board { grid-template-columns: repeat(7, minmax(210px, 72vw)); } }
    `);
            // ── 数据轮询 ──
            function usePanelData() {
                const [data, setData] = React.useState(null);
                const refresh = React.useCallback(() => {
                    host.call('state').then((d) => { if (d)
                        setData(d); }).catch(() => { });
                }, []);
                React.useEffect(() => {
                    refresh();
                    const disposer = interval(() => refresh(), 1500);
                    return () => { if (typeof disposer === 'function')
                        disposer(); };
                }, [refresh]);
                return [data, refresh];
            }
            // ── 实时执行进度轮询（executing 需求的会话/父会话/最近对话） ──
            function useExecProgress() {
                const [progress, setProgress] = React.useState([]);
                React.useEffect(() => {
                    const load = () => {
                        host.call('progress').then((list) => { if (Array.isArray(list))
                            setProgress(list); }).catch(() => { });
                    };
                    load();
                    const disposer = interval(() => load(), 1500);
                    return () => { if (typeof disposer === 'function')
                        disposer(); };
                }, []);
                return progress;
            }
            function useEscape(onClose) {
                React.useEffect(() => {
                    const onKey = (e) => {
                        if (e && e.key === 'Escape')
                            onClose();
                    };
                    document.addEventListener('keydown', onKey);
                    return () => document.removeEventListener('keydown', onKey);
                }, [onClose]);
            }
            // ── 跳转到真实子代理会话（失败回退 false → 显示对话摘要弹窗） ──
            async function openAgentConversation(sessionId, parentSessionId) {
                if (!sessions || !sessionId)
                    return false;
                const parent = parentSessionId || null;
                try {
                    if (parent && typeof sessions.refreshSubagents === 'function') {
                        try {
                            await sessions.refreshSubagents(parent);
                        }
                        catch (e) { /* noop */ }
                    }
                    if (parent && typeof sessions.subagentAddress === 'function') {
                        const known = sessions.subagentAddress(sessionId);
                        if (known) {
                            sessions.openSubagent(known);
                            return true;
                        }
                    }
                    if (parent && typeof sessions.openSubagent === 'function') {
                        sessions.openSubagent({ parentSessionId: parent, childSessionId: sessionId, mode: 'one-shot' });
                        return true;
                    }
                    if (typeof sessions.open === 'function') {
                        sessions.open(sessionId);
                        return true;
                    }
                }
                catch (e) { /* fallthrough */ }
                return false;
            }
            // ── 主干组件（渲染在会话视图标签页内） ──
            function TaskPanel(props) {
                const [data, refresh] = usePanelData();
                const progress = useExecProgress();
                const [formReq, setFormReq] = React.useState(null); // null | {mode:'create'} | {mode:'edit', id}
                const [reworkReq, setReworkReq] = React.useState(null); // null | {id,title}
                const [convReq, setConvReq] = React.useState(null); // null | {id,title,sessionId}
                const [toast, setToast] = React.useState(null);
                const [acceptedExpanded, setAcceptedExpanded] = React.useState(false);
                React.useEffect(() => {
                    if (!toast)
                        return;
                    const disposer = timeout(() => setToast(null), 2600);
                    return () => { if (typeof disposer === 'function')
                        disposer(); };
                }, [toast]);
                const byStage = (s) => (data ? data.requirements.filter((r) => r.stage === s) : []);
                const columns = [
                    { stage: 'backlog', title: '需求队列', color: 'rgba(226,232,240,.46)', count: byStage('backlog').length },
                    { stage: 'queued', title: '执行队列', color: 'rgba(226,232,240,.46)', count: byStage('queued').length },
                    { stage: 'executing', title: '执行中', color: 'rgba(203,193,170,.54)', count: byStage('executing').length },
                    { stage: 'reviewing', title: '自动复核', color: 'rgba(184,196,214,.52)', count: byStage('reviewing').length },
                    { stage: 'paused', title: '已暂停', color: 'rgba(148,163,184,.42)', count: byStage('paused').length },
                    { stage: 'accepting', title: '待验收', color: 'rgba(184,201,193,.50)', count: byStage('accepting').length },
                    { stage: 'accepted', title: '验收完成', color: 'rgba(226,232,240,.46)', count: byStage('accepted').length },
                ];
                const doCall = (method, args) => {
                    host.call(method, args).then(() => refresh()).catch((e) => setToast('操作失败：' + (e && e.message ? e.message : String(e))));
                };
                // 查看对话：优先跳转真实子代理会话；不可跳转时回退到对话摘要弹窗
                const viewConversation = (r) => {
                    openAgentConversation(r.lastSessionId, r.lastParentSessionId).then((ok) => {
                        if (!ok)
                            setConvReq({ id: r.id, title: r.title, sessionId: r.lastSessionId });
                    });
                };
                // 执行中「查看进度」= 直达子代理会话（会话即实时进度，无需再开弹窗）。
                // 进度实时数据里带 sessionId/parentSessionId；子会话尚未建立或跳转不可用时，
                // 回退到对话摘要弹窗看已捕获的实时对话。
                const jumpSession = (p) => {
                    if (!p || !p.sessionId) {
                        setToast('子会话尚未建立，稍后再试');
                        return;
                    }
                    openAgentConversation(p.sessionId, p.parentSessionId).then((ok) => {
                        if (!ok)
                            setConvReq({ id: p.id, title: p.title, sessionId: p.sessionId });
                    });
                };
                const total = data ? data.requirements.length : 0;
                const executing = byStage('executing').length;
                const reviewing = byStage('reviewing').length;
                const accepting = byStage('accepting').length;
                const queued = byStage('queued').length;
                const accepted = byStage('accepted').length;
                return h('div', { className: 'dtp-root' }, h('div', { className: 'dtp-header' }, h('div', { className: 'dtp-title' }, h('div', { className: 'dtp-logo' }, '▦'), h('div', null, h('h1', null, '任务面板'), h('div', { className: 'sub' }, total + ' 条需求' + (executing ? ' · ' + executing + ' 执行中' : '') + (reviewing ? ' · ' + reviewing + ' 复核中' : '') + (accepting ? ' · ' + accepting + ' 待验收' : '') + ' · 队列在子 session 自动执行'))), h('div', { className: 'dtp-header-stats' }, h('span', { className: 'dtp-stat' }, '队列 ' + queued), h('span', { className: 'dtp-stat' }, '执行 ' + executing), h('span', { className: 'dtp-stat' }, '复核 ' + reviewing), h('span', { className: 'dtp-stat' }, '验收 ' + accepting), h('span', { className: 'dtp-stat' }, '完成 ' + accepted)), h('button', { className: 'dtp-btn primary', onClick: () => setFormReq({ mode: 'create' }) }, '新建需求')), h('div', { className: 'dtp-board dtp-scroll' }, columns.map((col) => {
                    const items = byStage(col.stage);
                    const hiddenAccepted = col.stage === 'accepted' && !acceptedExpanded && items.length > 5;
                    const visibleItems = hiddenAccepted ? items.slice(0, 5) : items;
                    return h('div', { className: 'dtp-col', key: col.stage, style: { '--dtp-accent': col.color } }, h('div', { className: 'dtp-col-head' }, h('span', { className: 'dtp-dot', style: { color: col.color, background: col.color } }), h('span', { className: 'name' }, col.title), h('span', { className: 'dtp-count' }, String(col.count))), h('div', { className: 'dtp-col-body dtp-scroll' }, items.length === 0
                        ? h('div', { className: 'dtp-empty' }, '— 暂无需求 —')
                        : [
                            ...visibleItems.map((r) => h(Card, {
                                key: r.id,
                                req: r,
                                stage: col.stage,
                                progress: (progress || []).find((p) => p.id === r.id) || null,
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
                                onJumpSession: () => jumpSession((progress || []).find((p) => p.id === r.id) || null),
                            })),
                            col.stage === 'accepted' && items.length > 5
                                ? h('button', {
                                    key: 'accepted-more',
                                    className: 'dtp-btn small',
                                    style: { width: '100%', justifyContent: 'center' },
                                    onClick: () => setAcceptedExpanded(!acceptedExpanded),
                                    title: acceptedExpanded ? '收起验收完成列表' : '展示更多验收完成任务',
                                }, acceptedExpanded ? '收起' : '展示更多（还有 ' + (items.length - 5) + ' 条）')
                                : null,
                        ]));
                })), formReq ? h(RequirementForm, {
                    req: formReq.mode === 'edit' && data ? data.requirements.find((x) => x.id === formReq.id) : null,
                    lastWorkdir: data ? data.lastWorkdir : null,
                    onClose: () => setFormReq(null),
                    onSaved: () => { setFormReq(null); refresh(); },
                    onToast: (m) => setToast(m),
                }) : null, reworkReq ? h(ReworkModal, {
                    req: reworkReq,
                    onClose: () => setReworkReq(null),
                    onDone: () => { setReworkReq(null); refresh(); },
                    onToast: (m) => setToast(m),
                }) : null, convReq ? h(ConversationModal, {
                    req: convReq,
                    onClose: () => setConvReq(null),
                }) : null, toast ? h('div', { className: 'dtp-toast' }, toast) : null);
            }
            // ── 需求卡片 ──
            function Card(props) {
                const { req, stage, progress, onEdit, onDelete, onDispatch, onRecall, onTop, onAccept, onRework, onPause, onStop, onResume, onConv, onJumpSession } = props;
                const [confirmDel, setConfirmDel] = React.useState(false);
                const [deliverableOpen, setDeliverableOpen] = React.useState(stage !== 'accepted');
                React.useEffect(() => {
                    if (!confirmDel)
                        return;
                    const disposer = timeout(() => setConfirmDel(false), 2500);
                    return () => { if (typeof disposer === 'function')
                        disposer(); };
                }, [confirmDel]);
                React.useEffect(() => {
                    setDeliverableOpen(stage !== 'accepted');
                }, [stage]);
                const delBtn = h('button', { className: 'dtp-btn small danger', onClick: () => { if (confirmDel) {
                        setConfirmDel(false);
                        onDelete();
                    }
                    else
                        setConfirmDel(true); } }, confirmDel ? '确认删除?' : '删除');
                let actions = null;
                if (stage === 'backlog') {
                    actions = h('div', { className: 'dtp-actions' }, h('button', { className: 'dtp-btn small primary', onClick: onDispatch }, '丢执行'), h('button', { className: 'dtp-btn small', onClick: onEdit }, '编辑'), delBtn);
                }
                else if (stage === 'queued') {
                    actions = h('div', { className: 'dtp-actions' }, h('button', { className: 'dtp-btn small', onClick: onTop }, '置顶'), h('button', { className: 'dtp-btn small', onClick: onRecall }, '撤回'), delBtn);
                }
                else if (stage === 'executing') {
                    actions = h('div', { className: 'dtp-actions' }, h('span', { className: 'dtp-status-line' }, h('span', { className: 'dtp-pulse' }), '子 agent 执行中' + (progress && progress.sessionId ? ' · ' + String(progress.sessionId).slice(0, 8) : '') + (progress ? ' · ' + Math.round((progress.elapsedMs || 0) / 1000) + 's' : '')), h('button', {
                        className: 'dtp-btn small ok',
                        onClick: onJumpSession,
                        disabled: !(progress && progress.sessionId),
                        title: progress && progress.sessionId ? '查看进度 = 跳转到对应子代理会话（实时进度）' : '子会话尚未建立',
                    }, '查看进度'), h('button', { className: 'dtp-btn small', onClick: onPause }, '暂停'), h('button', { className: 'dtp-btn small danger', onClick: onStop }, '停止'));
                }
                else if (stage === 'reviewing') {
                    actions = h('div', { className: 'dtp-actions' }, h('span', { className: 'dtp-status-line' }, h('span', { className: 'dtp-pulse', style: { background: 'var(--dtp-accent)' } }), '复核 agent 检查中' + (progress && progress.sessionId ? ' · ' + String(progress.sessionId).slice(0, 8) : '') + (progress ? ' · ' + Math.round((progress.elapsedMs || 0) / 1000) + 's' : '')), h('button', {
                        className: 'dtp-btn small ok',
                        onClick: onJumpSession,
                        disabled: !(progress && progress.sessionId),
                        title: progress && progress.sessionId ? '查看复核进度 = 跳转到对应子代理会话' : '复核子会话尚未建立',
                    }, '查看复核'), h('button', { className: 'dtp-btn small', onClick: onPause }, '暂停'), h('button', { className: 'dtp-btn small danger', onClick: onStop }, '停止'));
                }
                else if (stage === 'paused') {
                    actions = h('div', { className: 'dtp-actions' }, h('button', { className: 'dtp-btn small primary', onClick: onResume }, '恢复'), h('button', { className: 'dtp-btn small danger', onClick: () => { if (confirmDel) {
                            setConfirmDel(false);
                            onDelete();
                        }
                        else
                            setConfirmDel(true); } }, confirmDel ? '确认删除?' : '删除'));
                }
                else if (stage === 'accepting') {
                    actions = h('div', { className: 'dtp-actions' }, h('button', { className: 'dtp-btn small', onClick: onConv }, '查看对话'), h('button', { className: 'dtp-btn small ok', onClick: onAccept }, '通过'), h('button', { className: 'dtp-btn small danger', onClick: onRework }, '返工'));
                }
                else if (stage === 'accepted') {
                    actions = h('div', { className: 'dtp-actions' }, h('button', { className: 'dtp-btn small', onClick: onConv }, '查看对话'), h('span', { className: 'dtp-badge' }, '验收通过'));
                }
                const pri = String(req.priority || 'medium');
                // 执行中实时进度预览（最近 3 条）
                let progressBlock = null;
                if ((stage === 'executing' || stage === 'reviewing') && progress && Array.isArray(progress.recent) && progress.recent.length) {
                    const who = { user: '用户', assistant: 'Agent', tool: '工具' };
                    const jumpable = !!(progress.sessionId);
                    // 进度预览可直接点击跳转到对应子代理会话
                    progressBlock = h('div', {
                        className: 'dtp-progress' + (jumpable ? ' jumpable' : ''),
                        title: jumpable ? '点击跳转到对应子代理会话' : '子会话尚未建立',
                        onClick: jumpable ? onJumpSession : undefined,
                    }, progress.workdir
                        ? h('div', { className: 'pmeta', title: progress.workdir }, '目录 ' + progress.workdir)
                        : null, progress.recent.slice(-3).map((m, i) => h('div', { className: 'prow', key: i }, h('span', { className: 'pwho' }, who[m.role] || m.role), h('span', { className: 'ptxt' }, String(m.text || '').slice(0, 90)))));
                }
                let reviewBlock = null;
                if ((stage === 'accepting' || stage === 'accepted') && req.reviewCount) {
                    const passed = req.reviewPassed === true;
                    const issues = Array.isArray(req.reviewIssues) ? req.reviewIssues : [];
                    const text = (req.reviewVerdict || (passed ? '自动复核通过' : '自动复核发现问题')) +
                        (!passed && issues.length ? '；问题：' + issues.slice(0, 3).join('；') : '');
                    reviewBlock = h('div', { className: 'dtp-review ' + (passed ? 'ok' : 'bad'), title: '自动复核结论' }, h('span', { className: 'lab' }, passed ? '复核通过' : '复核注意'), h('span', null, text));
                }
                // 产物块：待验收展开；验收完成默认收起（点击展开/收起）
                let deliverableBlock = null;
                if ((stage === 'accepting' || stage === 'accepted') && req.deliverable) {
                    if (deliverableOpen) {
                        deliverableBlock = h('div', {
                            className: 'dtp-deliverable' + (stage === 'accepted' ? ' dtp-deliverable-collapsed' : ''),
                            title: stage === 'accepted' ? '点击收起验收产物' : '验收产物（一句话）',
                            onClick: stage === 'accepted' ? () => setDeliverableOpen(false) : undefined,
                        }, h('span', { className: 'lab' }, '产物'), req.deliverable);
                    }
                    else {
                        deliverableBlock = h('div', {
                            className: 'dtp-deliverable dtp-deliverable-collapsed',
                            title: '点击展开验收产物',
                            onClick: () => setDeliverableOpen(true),
                        }, h('span', { className: 'lab' }, '产物'), h('span', { className: 'ptxt', style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, String(req.deliverable).slice(0, 60) + (String(req.deliverable).length > 60 ? '…' : '')));
                    }
                }
                return h('div', { className: 'dtp-card' }, h('div', { className: 'dtp-card-title' }, h('span', { className: 'dtp-pri dtp-pri-' + pri }, pri), ' ', req.title), h('div', { className: 'dtp-card-meta' }, h('span', null, req.id), h('span', null, '要素 ' + req.elementCount), h('span', null, '验收 ' + req.criterionCount), h('span', { title: req.autoReview === false ? '执行完成后不启动复核 agent' : '执行完成后自动启动复核 agent', style: { color: req.autoReview === false ? 'rgba(236,230,213,.92)' : 'rgba(217,227,242,.90)' } }, req.autoReview === false ? '免复核' : '自动复核'), req.contextAnchors && req.contextAnchors.length ? h('span', { title: '已关联历史会话', style: { color: 'rgba(224,238,232,.90)' } }, '会话 ' + req.contextAnchors.length) : null, req.workdir ? h('span', { title: '绑定工作目录', style: { color: 'rgba(203,213,225,.72)', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, '目录 ' + req.workdir) : h('span', { style: { color: 'rgba(236,230,213,.92)' } }, '未绑定目录'), req.scheduledAt ? h('span', { title: '计划执行时间', style: { color: req.scheduledAt > Date.now() ? 'rgba(217,227,242,.90)' : 'rgba(224,238,232,.90)' } }, '定时 ' + formatScheduledAt(req.scheduledAt)) : null, req.reworkCount ? h('span', { style: { color: 'rgba(236,230,213,.92)' } }, '返工 ' + req.reworkCount) : null), progressBlock, reviewBlock, deliverableBlock, actions);
            }
            // ── 新建 / 编辑表单 ──
            function RequirementForm(props) {
                const { req, lastWorkdir, onClose, onSaved, onToast } = props;
                const isEdit = !!req;
                const [title, setTitle] = React.useState(req ? req.title : '');
                const [description, setDescription] = React.useState(req ? req.description : '');
                const [priority, setPriority] = React.useState(req ? req.priority : 'medium');
                const [scope, setScope] = React.useState(req ? (req.scope || []).join(', ') : '');
                const [command, setCommand] = React.useState(req ? req.command || '' : '');
                // 工作目录：编辑沿用需求绑定；新建默认用上次绑定（无则空，提示绑定）
                const [workdir, setWorkdir] = React.useState(req ? (req.workdir || '') : (lastWorkdir || ''));
                const [scheduledAt, setScheduledAt] = React.useState(req ? toDateTimeLocalValue(req.scheduledAt) : '');
                const [autoReview, setAutoReview] = React.useState(req ? req.autoReview !== false : true);
                const [sessionCandidates, setSessionCandidates] = React.useState(req && Array.isArray(req.contextAnchors) ? req.contextAnchors : []);
                const [selectedSessionIds, setSelectedSessionIds] = React.useState(req && Array.isArray(req.contextAnchors) ? req.contextAnchors.map((s) => s.sessionId) : []);
                const [sessionLoading, setSessionLoading] = React.useState(false);
                const [dirPickerOpen, setDirPickerOpen] = React.useState(false);
                const [busy, setBusy] = React.useState(false);
                useEscape(onClose);
                const loadSessionCandidates = React.useCallback(() => {
                    const qTitle = title.trim();
                    const qDesc = description.trim();
                    if (!qTitle && !qDesc)
                        return;
                    setSessionLoading(true);
                    host.call('suggest-sessions', {
                        title: qTitle,
                        description: qDesc,
                        scope: scope.split(',').map((s) => s.trim()).filter(Boolean),
                        limit: 6,
                    }).then((r) => {
                        setSessionLoading(false);
                        const items = r && Array.isArray(r.items) ? r.items : [];
                        setSessionCandidates((prev) => {
                            const map = new Map();
                            for (const item of [...(prev || []), ...items])
                                if (item && item.sessionId)
                                    map.set(item.sessionId, item);
                            return Array.from(map.values()).slice(0, 8);
                        });
                        if (!isEdit && selectedSessionIds.length === 0) {
                            setSelectedSessionIds(items.slice(0, 3).map((x) => x.sessionId).filter(Boolean));
                        }
                    }).catch(() => setSessionLoading(false));
                }, [title, description, scope, isEdit, selectedSessionIds.length]);
                React.useEffect(() => {
                    if (isEdit)
                        return;
                    const disposer = timeout(() => loadSessionCandidates(), 500);
                    return () => { if (typeof disposer === 'function')
                        disposer(); };
                }, [isEdit, loadSessionCandidates]);
                const toggleSession = (sessionId) => {
                    setSelectedSessionIds((prev) => prev.includes(sessionId) ? prev.filter((id) => id !== sessionId) : [...prev, sessionId]);
                };
                const save = () => {
                    if (!title.trim()) {
                        onToast('标题不能为空');
                        return;
                    }
                    if (!workdir.trim()) {
                        onToast('请绑定工作目录（子 agent 将在此目录执行）');
                        return;
                    }
                    setBusy(true);
                    const args = {
                        title: title.trim(),
                        description,
                        priority,
                        scope: scope.split(',').map((s) => s.trim()).filter(Boolean),
                        command: command.trim() || null,
                        workdir: workdir.trim(),
                        scheduledAt: parseDateTimeLocalValue(scheduledAt),
                        autoReview,
                    };
                    if (sessionCandidates.length > 0) {
                        args.contextAnchors = sessionCandidates.filter((s) => selectedSessionIds.includes(s.sessionId));
                    }
                    const method = isEdit ? 'update' : 'create';
                    if (isEdit)
                        args.id = req.id;
                    host.call(method, args).then(() => {
                        setBusy(false);
                        onSaved();
                    }).catch((e) => {
                        setBusy(false);
                        onToast('保存失败：' + (e && e.message ? e.message : String(e)));
                    });
                };
                return h('div', { className: 'dtp-modal-backdrop', onClick: onClose }, h('div', { className: 'dtp-modal', onClick: (e) => e.stopPropagation() }, h('h2', null, isEdit ? '编辑需求 ' + req.id : '新建需求'), !isEdit && !workdir
                    ? h('div', { className: 'dtp-field', style: { background: 'rgba(203,193,170,.10)', border: '1px solid rgba(226,232,240,.14)', borderRadius: 9, padding: '7px 10px', color: 'rgba(236,230,213,.92)', fontSize: 11 } }, '尚未绑定工作目录，子 agent 执行时无法确定落盘位置，请选择或填写「绑定工作目录」。')
                    : null, h('div', { className: 'dtp-field' }, h('label', null, '标题 *'), h('input', { value: title, onChange: (e) => setTitle(e.target.value), placeholder: '一句话描述需求' })), h('div', { className: 'dtp-field' }, h('label', null, '详细描述'), h('textarea', { value: description, onChange: (e) => setDescription(e.target.value), rows: 3, placeholder: '背景 / 目标 / 约束' })), h('div', { className: 'dtp-field' }, h('label', null, '优先级'), h('select', { value: priority, onChange: (e) => setPriority(e.target.value) }, ['critical', 'high', 'medium', 'low'].map((p) => h('option', { key: p, value: p }, p)))), h('div', { className: 'dtp-field' }, h('label', null, '绑定工作目录 *'), h('div', { className: 'dtp-workdir-row' }, h('input', { value: workdir, onChange: (e) => setWorkdir(e.target.value), placeholder: '如: /path/to/project（子 agent 在此目录执行）' }), h('button', { className: 'dtp-btn', onClick: () => setDirPickerOpen(true) }, '浏览'))), h('div', { className: 'dtp-field' }, h('label', null, '涉及范围（逗号分隔）'), h('input', { value: scope, onChange: (e) => setScope(e.target.value), placeholder: '如: src/, docs/' })), h('div', { className: 'dtp-field' }, h('label', null, '执行命令（可选）'), h('input', { value: command, onChange: (e) => setCommand(e.target.value), placeholder: '如: npm test' })), h('div', { className: 'dtp-field' }, h('label', null, '计划执行时间（可选）'), h('input', {
                    type: 'datetime-local',
                    value: scheduledAt,
                    onChange: (e) => setScheduledAt(e.target.value),
                    title: '留空则进入执行队列后立即执行',
                })), h('div', { className: 'dtp-field' }, h('label', { className: 'dtp-check' }, h('input', {
                    type: 'checkbox',
                    checked: autoReview,
                    onChange: (e) => setAutoReview(e.target.checked),
                }), h('span', { className: 'txt' }, '自动复核', h('span', { className: 'hint' }, autoReview ? '执行完成后启动复核 agent，再进入待验收。' : '执行完成后直接进入待验收，不启动复核 agent。')))), h('div', { className: 'dtp-field' }, h('label', null, '关联历史会话（可选）'), h('div', { style: { display: 'flex', gap: 8, marginBottom: 7 } }, h('button', { className: 'dtp-btn small', onClick: loadSessionCandidates, disabled: sessionLoading }, sessionLoading ? '扫描中…' : '扫描相关会话'), h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary, #9297a5)', alignSelf: 'center' } }, selectedSessionIds.length ? '已选 ' + selectedSessionIds.length + ' 条' : '未选择')), h('div', { className: 'dtp-session-list dtp-scroll' }, sessionCandidates.length === 0
                    ? h('div', { className: 'dtp-empty', style: { padding: '8px 0' } }, sessionLoading ? '正在扫描…' : '暂无候选会话')
                    : sessionCandidates.map((s) => h('label', { className: 'dtp-session-option', key: s.sessionId }, h('input', {
                        type: 'checkbox',
                        checked: selectedSessionIds.includes(s.sessionId),
                        onChange: () => toggleSession(s.sessionId),
                    }), h('span', { className: 'main' }, h('span', { className: 'sid', title: s.sessionId }, (s.title ? s.title + ' · ' : '') + s.sessionId), h('span', { className: 'snip' }, s.snippet || s.cwd || '（无摘要）')))))), h('div', { className: 'dtp-modal-actions' }, h('button', { className: 'dtp-btn', onClick: onClose }, '取消'), h('button', { className: 'dtp-btn primary', onClick: save, disabled: busy }, busy ? '保存中…' : '保存'))), dirPickerOpen ? h(DirectoryPickerModal, {
                    initial: workdir,
                    onClose: () => setDirPickerOpen(false),
                    onPick: (path) => { setWorkdir(path); setDirPickerOpen(false); },
                    onToast,
                }) : null);
            }
            // ── 目录选择弹窗（绑定工作目录用；browse 浏览 / native 系统选择器） ──
            function DirectoryPickerModal(props) {
                const { initial, onClose, onPick, onToast } = props;
                const [mode, setMode] = React.useState(null); // null | 'browse' | 'native'
                const [path, setPath] = React.useState(initial || '');
                const [crumbs, setCrumbs] = React.useState([]);
                const [entries, setEntries] = React.useState([]);
                const [loading, setLoading] = React.useState(false);
                const [error, setError] = React.useState(null);
                useEscape(onClose);
                // 打开时探测能力：先试 browse，失败再试 native
                React.useEffect(() => {
                    let cancelled = false;
                    host.call('browse-dir', { path: initial || undefined }).then((r) => {
                        if (cancelled)
                            return;
                        if (r && r.ok) {
                            setMode('browse');
                            setCrumbs(r.crumbs || []);
                            setEntries(r.entries || []);
                            setPath(r.path || initial || '');
                        }
                        else if (r && r.native) {
                            setMode('native');
                            setError(null);
                        }
                        else {
                            setMode('browse');
                            setError((r && r.error ? r.error : '目录浏览不可用') + '；也可以关闭弹窗后直接在输入框粘贴路径。');
                        }
                    }).catch(() => { if (!cancelled)
                        setMode('browse'); });
                    return () => { cancelled = true; };
                }, []);
                const openDir = (p) => {
                    setLoading(true);
                    setError(null);
                    host.call('browse-dir', { path: p }).then((r) => {
                        setLoading(false);
                        if (r && r.ok) {
                            setCrumbs(r.crumbs || []);
                            setEntries(r.entries || []);
                            setPath(r.path || p);
                        }
                        else {
                            setError(r && r.error ? r.error : '无法打开目录');
                        }
                    }).catch(() => { setLoading(false); setError('无法打开目录'); });
                };
                const pickNative = () => {
                    setLoading(true);
                    setError(null);
                    host.call('pick-dir', {}).then((r) => {
                        setLoading(false);
                        if (r && r.ok && r.path)
                            onPick(r.path);
                        else
                            setError(r && r.error ? r.error : '已取消或不可用');
                    }).catch(() => { setLoading(false); setError('目录选择失败'); });
                };
                return h('div', { className: 'dtp-modal-backdrop', onClick: onClose }, h('div', { className: 'dtp-modal', style: { width: 560 }, onClick: (e) => e.stopPropagation() }, h('h2', null, '选择工作目录'), h('div', { className: 'dtp-dirbrowser' }, h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } }, mode === 'native'
                    ? h('button', { className: 'dtp-btn primary', onClick: pickNative, disabled: loading }, loading ? '打开选择器…' : '打开系统目录选择器')
                    : h('button', { className: 'dtp-btn', onClick: () => openDir(initial || undefined), disabled: loading }, '刷新'), h('button', { className: 'dtp-btn', onClick: () => openDir(undefined) }, '主目录')), error ? h('div', { style: { fontSize: 11, color: 'rgba(239,218,221,.92)', padding: '6px 10px', background: 'rgba(201,174,178,.10)', border: '1px solid rgba(226,232,240,.13)', borderRadius: 9 } }, error) : null, mode !== 'native'
                    ? h('div', { className: 'dtp-dircrumbs' }, (crumbs.length ? crumbs : [{ name: '…', path: undefined }]).map((c, i) => {
                        const isLast = i === crumbs.length - 1;
                        return h('span', { key: i, style: { display: 'inline-flex', alignItems: 'center', gap: 4 } }, h('span', { className: 'dtp-dircrumb' + (isLast ? ' last' : ''), onClick: () => { if (!isLast && c.path)
                                openDir(c.path); } }, c.name), !isLast ? h('span', { className: 'dtp-dirsep' }, '›') : null);
                    }))
                    : null, mode !== 'native'
                    ? h('div', { className: 'dtp-direntries' }, loading
                        ? h('div', { className: 'dtp-empty' }, h('span', { className: 'dtp-spin' }), '加载中…')
                        : entries.length === 0
                            ? h('div', { className: 'dtp-empty' }, '（无子目录）')
                            : entries.map((e, i) => h('div', { className: 'dtp-direntry', key: i, onClick: () => openDir(e.path) }, h('span', { className: 'ic' }, e.hidden ? '隐' : '目录'), h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, e.name), h('button', { className: 'dtp-btn small dtp-dirselect', onClick: (ev) => { ev.stopPropagation(); onPick(e.path); } }, '选用'))))
                    : null, h('div', { className: 'dtp-dirpath' }, '当前：' + (path || '（未选择）'))), h('div', { className: 'dtp-modal-actions' }, h('button', { className: 'dtp-btn', onClick: onClose }, '取消'), h('button', { className: 'dtp-btn primary', onClick: () => { if (path)
                        onPick(path); }, disabled: !path }, '选用当前目录'))));
            }
            // ── 返工反馈 ──
            function ReworkModal(props) {
                const { req, onClose, onDone, onToast } = props;
                const [feedback, setFeedback] = React.useState('');
                const [busy, setBusy] = React.useState(false);
                useEscape(onClose);
                const submit = () => {
                    if (!feedback.trim()) {
                        onToast('请填写验收反馈（返工原因）');
                        return;
                    }
                    setBusy(true);
                    host.call('rework', { id: req.id, feedback: feedback.trim() }).then(() => {
                        setBusy(false);
                        onDone();
                    }).catch((e) => {
                        setBusy(false);
                        onToast('返工失败：' + (e && e.message ? e.message : String(e)));
                    });
                };
                return h('div', { className: 'dtp-modal-backdrop', onClick: onClose }, h('div', { className: 'dtp-modal', onClick: (e) => e.stopPropagation() }, h('h2', null, '验收反馈 · ' + req.title), h('div', { className: 'dtp-field' }, h('label', null, '反馈内容（作为返工原因，将带着它重入执行队列重新执行）'), h('textarea', { value: feedback, onChange: (e) => setFeedback(e.target.value), rows: 4, placeholder: '如：产物缺少测试用例，请补充单测并验证通过' })), h('div', { className: 'dtp-modal-actions' }, h('button', { className: 'dtp-btn', onClick: onClose }, '取消'), h('button', { className: 'dtp-btn danger', onClick: submit, disabled: busy }, busy ? '提交中…' : '确认返工'))));
            }
            // ── 对话摘要弹窗（跳转真实子代理会话不可用时回退） ──
            function ConversationModal(props) {
                const { req, onClose } = props;
                const [detail, setDetail] = React.useState(null);
                useEscape(onClose);
                React.useEffect(() => {
                    let cancelled = false;
                    host.call('conversation', { id: req.id, sessionId: req.sessionId }).then((d) => {
                        if (!cancelled)
                            setDetail(d);
                    }).catch(() => { if (!cancelled)
                        setDetail({ transcript: [] }); });
                    return () => { cancelled = true; };
                }, [req.id, req.sessionId]);
                const who = { user: '用户输入', assistant: 'Agent 回复', tool: '工具调用' };
                const rows = detail && Array.isArray(detail.transcript) ? detail.transcript : [];
                return h('div', { className: 'dtp-modal-backdrop', onClick: onClose }, h('div', { className: 'dtp-modal', style: { width: 640 }, onClick: (e) => e.stopPropagation() }, h('h2', null, 'Agent 对话摘要 · ' + req.title), h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary, #9297a5)', marginBottom: 10 } }, 'sessionId: ' + (detail && detail.sessionId ? detail.sessionId : '（无）') + ' · 共 ' + rows.length + ' 条消息' +
                    '（会话已不可直接跳转，展示已捕获的摘要）'), rows.length === 0
                    ? h('div', { className: 'dtp-empty' }, '（暂无对话记录）')
                    : h('div', { className: 'dtp-transcript dtp-scroll' }, rows.map((m, i) => h('div', { className: 'dtp-msg ' + m.role, key: i }, h('span', { className: 'who' }, who[m.role] || m.role), m.text))), h('div', { className: 'dtp-modal-actions' }, h('button', { className: 'dtp-btn', onClick: onClose }, '关闭'))));
            }
            // ── 注册：会话视图标签页（与「对话 / 轨迹」同级） ──
            slots.inject('conversation.view', () => slots.register({ name: 'conversation.view', id: 'dsh-task-panel', label: '任务面板', order: 20 }, (props) => h(TaskPanel, props)));
        },
    };
})();
export const name = 'dsh-task-panel';
export const inject = ['slots', 'sessions', ...plugin.inject];
export function apply(ctx) {
    return plugin.apply(ctx);
}
