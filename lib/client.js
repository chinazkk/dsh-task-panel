window.__ModuleLoader__.load({
	id: "dsh-task-panel",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region \0rolldown/runtime.js
		var __create = Object.create;
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __getProtoOf = Object.getPrototypeOf;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __copyProps = (to, from, except, desc) => {
			if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
				key = keys[i];
				if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
					get: ((k) => from[k]).bind(null, key),
					enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
				});
			}
			return to;
		};
		var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
			value: mod,
			enumerable: true
		}) : target, mod));
		//#endregion
		let react = require("react");
		react = __toESM(react, 1);
		//#region lib/client/index.js
		const styles = { insert(css) {
			const el = document.createElement("style");
			el.textContent = css;
			document.head.appendChild(el);
			return () => {
				el.remove();
			};
		} };
		const host = { call: (method, args) => fetch("/plugins/dsh-task-panel/rpc", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				method,
				args: args ?? null
			})
		}).then((r) => r.json()).then((d) => {
			if (d && d.error !== void 0) throw new Error(String(d.error));
			return d;
		}) };
		const plugin = (() => {
			return {
				inject: [],
				apply(ctx) {
					const slots = ctx.get("slots");
					if (!slots) return;
					const sessions = ctx.get("sessions");
					const h = react.createElement;
					const interval = (fn, ms) => {
						const id = setInterval(fn, ms);
						return () => clearInterval(id);
					};
					const timeout = (fn, ms) => {
						const id = setTimeout(fn, ms);
						return () => clearTimeout(id);
					};
					const pad2 = (n) => String(n).padStart(2, "0");
					const toDateTimeLocalValue = (ms) => {
						if (!ms) return "";
						const d = new Date(ms);
						if (Number.isNaN(d.getTime())) return "";
						return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) + "T" + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
					};
					const parseDateTimeLocalValue = (value) => {
						const text = String(value || "").trim();
						if (!text) return null;
						const ms = Date.parse(text);
						return Number.isFinite(ms) ? ms : null;
					};
					const formatScheduledAt = (ms) => {
						if (!ms) return "";
						const d = new Date(ms);
						if (Number.isNaN(d.getTime())) return "";
						return d.toLocaleString([], {
							month: "2-digit",
							day: "2-digit",
							hour: "2-digit",
							minute: "2-digit"
						});
					};
					styles.insert(`
      .dtp-root { --dtp-accent: var(--dtp-accent); --dtp-accent-soft: var(--dtp-accent-soft); --dtp-glass: var(--dtp-glass-1); --dtp-glass-strong: var(--dtp-glass-2); --dtp-hairline: var(--dtp-hairline); --dtp-text: var(--dtp-text); --dtp-muted: var(--dtp-muted); --dtp-faint: var(--dtp-faint); --dtp-ok: #b8c9c1; --dtp-warn: #cbc1aa; --dtp-danger: #c9aeb2; --dtp-shadow: 0 18px 48px var(--dtp-shadow-ink); --dtp-soft-shadow: 0 10px 30px var(--dtp-shadow-ink); position: relative; display: flex; flex-direction: column; height: 100%; min-height: 0; overflow: hidden; color: var(--dtp-text); background: linear-gradient(180deg, var(--dtp-glass-0), transparent 18%), radial-gradient(circle at 52% -26%, var(--dtp-accent-soft), transparent 32%), linear-gradient(135deg, var(--dtp-solid-b) 0%, var(--dtp-solid-c) 48%, var(--dtp-solid-a) 100%); }
      .dtp-root::before { content: ''; position: absolute; inset: 0; pointer-events: none; background-image: linear-gradient(var(--dtp-glass-0) 1px, transparent 1px), linear-gradient(90deg, var(--dtp-glass-0) 1px, transparent 1px); background-size: 32px 32px; mask-image: linear-gradient(180deg, rgba(0,0,0,.42), transparent 70%); }
      .dtp-header { position: relative; flex: 0 0 auto; display: flex; align-items: center; gap: 14px; padding: 13px 18px; border-bottom: 1px solid var(--dtp-glass-2); background: var(--dtp-header-bg); backdrop-filter: blur(30px) saturate(135%); -webkit-backdrop-filter: blur(30px) saturate(135%); box-shadow: 0 1px 0 var(--dtp-glass-1) inset; z-index: 1; }
      .dtp-title { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0; }
      .dtp-logo { width: 34px; height: 34px; border-radius: 9px; display: flex; align-items: center; justify-content: center; font-size: 16px; color: var(--dtp-text); background: linear-gradient(145deg, var(--dtp-glass-3), var(--dtp-glass-0)), var(--dtp-accent-soft); border: 1px solid var(--dtp-glass-3); box-shadow: 0 10px 24px var(--dtp-shadow-ink), 0 1px 0 var(--dtp-glass-3) inset; flex: 0 0 auto; }
      .dtp-title h1 { font-size: 15px; margin: 0; font-weight: 760; letter-spacing: 0; color: var(--dtp-text); }
      .dtp-title .sub { font-size: 11px; color: var(--dtp-muted); margin-top: 2px; }
      .dtp-header-stats { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; margin-right: 2px; }
      .dtp-stat { display: inline-flex; align-items: center; gap: 6px; min-height: 24px; padding: 0 9px; border-radius: 8px; font-size: 11px; font-weight: 650; color: var(--dtp-text); background: var(--dtp-glass-1); border: 1px solid var(--dtp-glass-2); box-shadow: 0 1px 0 var(--dtp-glass-2) inset; white-space: nowrap; }
      .dtp-stat::before { content: ''; width: 5px; height: 5px; border-radius: 50%; background: var(--dsw-alias-link); }
      .dtp-btn { display: inline-flex; align-items: center; justify-content: center; gap: 5px; min-height: 30px; border-radius: 8px; padding: 6px 12px; font-size: 12px; font-weight: 650; border: 1px solid var(--dtp-hairline); background: var(--dtp-btn-bg); color: var(--dtp-text); cursor: pointer; transition: transform .16s ease, box-shadow .16s ease, border-color .16s ease, background .16s ease, opacity .16s ease; box-shadow: 0 1px 0 var(--dtp-glass-2) inset, 0 8px 18px var(--dtp-shadow-ink); backdrop-filter: blur(18px) saturate(135%); -webkit-backdrop-filter: blur(18px) saturate(135%); }
      .dtp-btn:hover:not(:disabled) { border-color: var(--dtp-glass-3); background: linear-gradient(180deg, var(--dtp-glass-3), var(--dtp-glass-1)); transform: translateY(-1px); box-shadow: 0 1px 0 var(--dtp-glass-3) inset, 0 12px 24px var(--dtp-shadow-ink); }
      .dtp-btn:active:not(:disabled) { transform: translateY(0) scale(.98); }
      .dtp-btn:disabled { cursor: not-allowed; opacity: .48; box-shadow: none; }
      .dtp-btn.primary { background: var(--dsw-alias-button-info-fill, #4176e6); border-color: var(--dtp-faint); color: #fff; box-shadow: 0 1px 0 var(--dtp-glass-3) inset, 0 12px 26px var(--dtp-shadow-ink); }
      .dtp-btn.primary:hover:not(:disabled) { filter: brightness(1.06); }
      .dtp-btn.ok { background: var(--dsw-alias-state-success-primary, #22c55e); border-color: var(--dtp-hairline); color: #fff; box-shadow: 0 1px 0 var(--dtp-glass-3) inset, 0 12px 22px var(--dtp-shadow-ink); }
      .dtp-btn.ok:hover:not(:disabled) { filter: brightness(1.06); }
      .dtp-btn.danger { background: var(--dsw-alias-state-error-primary, #ef4444); border-color: var(--dtp-hairline); color: #fff; box-shadow: 0 1px 0 var(--dtp-glass-3) inset, 0 12px 22px var(--dtp-shadow-ink); }
      .dtp-btn.danger:hover:not(:disabled) { filter: brightness(1.06); }
      .dtp-btn.ghost { background: var(--dtp-glass-0); border-color: var(--dtp-glass-2); color: var(--dsw-alias-label-secondary); box-shadow: none; }
      .dtp-btn.ghost:hover:not(:disabled) { background: var(--dtp-glass-2); border-color: var(--dtp-glass-3); }
      .dtp-btn.small { min-height: 25px; padding: 3px 10px; font-size: 11px; border-radius: 8px; }
      .dtp-board { position: relative; z-index: 1; flex: 1; min-height: 0; display: grid; grid-template-columns: repeat(7, minmax(172px, 1fr)); gap: 10px; padding: 14px 16px 16px; overflow: auto; }
      .dtp-col { position: relative; background: var(--dtp-col-bg); border: 1px solid var(--dtp-glass-2); border-radius: 12px; display: flex; flex-direction: column; min-height: 0; overflow: hidden; box-shadow: var(--dtp-soft-shadow), 0 1px 0 var(--dtp-glass-2) inset; backdrop-filter: blur(24px) saturate(130%); -webkit-backdrop-filter: blur(24px) saturate(130%); }
      .dtp-col::before { content: ''; position: absolute; inset: 0 0 auto; height: 2px; background: linear-gradient(90deg, transparent, var(--dtp-accent), transparent); opacity: .42; pointer-events: none; }
      .dtp-col-head { position: sticky; top: 0; z-index: 2; padding: 11px 11px 8px; display: flex; align-items: center; gap: 8px; background: var(--dtp-colhead-bg); backdrop-filter: blur(18px) saturate(130%); -webkit-backdrop-filter: blur(18px) saturate(130%); border-bottom: 1px solid var(--dtp-glass-1); }
      .dtp-dot { width: 6px; height: 6px; border-radius: 50%; box-shadow: 0 0 10px var(--dtp-hairline); flex: 0 0 auto; opacity: .68; }
      .dtp-col-head .name { font-size: 12px; font-weight: 720; color: var(--dtp-text); flex: 1; letter-spacing: 0; }
      .dtp-count { font-size: 11px; font-weight: 720; padding: 1px 8px; border-radius: 8px; background: var(--dtp-glass-1); color: var(--dsw-alias-label-secondary); border: 1px solid var(--dtp-glass-2); font-variant-numeric: tabular-nums; }
      .dtp-col-body { flex: 1; min-height: 0; padding: 6px 7px 9px; overflow-y: auto; display: flex; flex-direction: column; gap: 7px; }
      .dtp-card { background: linear-gradient(180deg, var(--dtp-glass-2), var(--dtp-glass-0)); border: 1px solid var(--dtp-glass-2); border-radius: 10px; padding: 9px 10px; transition: border-color .16s ease, transform .16s ease, box-shadow .16s ease, background .16s ease; box-shadow: 0 1px 0 var(--dtp-glass-2) inset, 0 7px 16px var(--dtp-shadow-ink); backdrop-filter: blur(16px) saturate(130%); -webkit-backdrop-filter: blur(16px) saturate(130%); }
      .dtp-card:hover { border-color: var(--dtp-glass-3); transform: translateY(-1px); box-shadow: 0 1px 0 var(--dtp-glass-2) inset, 0 14px 28px var(--dtp-shadow-ink); background: linear-gradient(180deg, var(--dtp-glass-2), var(--dtp-glass-1)); }
      .dtp-card-title { font-weight: 690; font-size: 12.5px; color: var(--dtp-text); margin-bottom: 6px; word-break: break-word; line-height: 1.42; }
      .dtp-card-meta { color: var(--dtp-muted); font-size: 10.5px; margin-bottom: 8px; display: flex; flex-wrap: wrap; gap: 4px 7px; align-items: center; }
      .dtp-card-meta > span { padding: 1px 6px; border-radius: 7px; background: var(--dtp-glass-0); border: 1px solid var(--dtp-glass-1); }
      .dtp-pri { display: inline-flex; align-items: center; gap: 5px; border-radius: 7px; padding: 1px 8px; font-size: 10px; font-weight: 720; letter-spacing: 0; border: 1px solid var(--dtp-glass-2); box-shadow: 0 1px 0 var(--dtp-glass-1) inset; text-transform: uppercase; }
      .dtp-pri::before { content: ''; width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
      .dtp-pri-critical { background: var(--dsw-alias-state-error-tertiary); color: var(--dsw-alias-state-error-primary); }
      .dtp-pri-high { background: var(--dsw-alias-state-warn-tertiary); color: var(--dsw-alias-state-warn-primary); }
      .dtp-pri-medium { background: var(--dsw-alias-state-business-tertiary); color: var(--dsw-alias-link); }
      .dtp-pri-low { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); }
      .dtp-deliverable { display: flex; gap: 7px; align-items: flex-start; margin: 2px 0 8px; padding: 8px 9px; border-radius: 9px; background: var(--dsw-alias-state-success-tertiary); border: 1px solid var(--dtp-hairline); color: var(--dsw-alias-state-success-primary); font-size: 11px; line-height: 1.5; word-break: break-word; box-shadow: 0 1px 0 var(--dtp-glass-1) inset; }
      .dtp-deliverable .lab { font-weight: 700; flex: 0 0 auto; }
      .dtp-deliverable-collapsed { cursor: pointer; align-items: center; opacity: .90; transition: opacity .15s, border-color .15s, background .15s; }
      .dtp-deliverable-collapsed:hover { opacity: 1; border-color: var(--dsw-alias-state-success-secondary); background: var(--dsw-alias-state-success-tertiary); }
      .dtp-actions { display: flex; flex-wrap: wrap; gap: 6px; }
      .dtp-status-line { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; flex-basis: 100%; padding: 5px 8px; border-radius: 8px; background: var(--dtp-glass-0); border: 1px solid var(--dtp-glass-1); color: var(--dsw-alias-label-secondary); }
      .dtp-spin { display: inline-block; width: 11px; height: 11px; border: 2px solid var(--dtp-warn); border-top-color: transparent; border-radius: 50%; animation: dtp-spin .8s linear infinite; vertical-align: middle; margin-right: 6px; }
      @keyframes dtp-spin { to { transform: rotate(360deg); } }
      .dtp-progress { margin: 4px 0 8px; padding: 8px 9px; border-radius: 9px; background: var(--dsw-alias-state-warn-tertiary); border: 1px solid var(--dtp-hairline); font-size: 11px; color: var(--dsw-alias-label-secondary); line-height: 1.5; max-height: 102px; overflow: hidden; box-shadow: 0 1px 0 var(--dtp-glass-1) inset; }
      .dtp-progress .prow { display: flex; gap: 6px; align-items: baseline; margin-bottom: 2px; }
      .dtp-progress .pwho { flex: 0 0 auto; font-weight: 700; color: var(--dsw-alias-state-warn-primary); font-size: 10px; }
      .dtp-progress .ptxt { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .dtp-progress .pmeta { font-size: 10px; color: var(--dsw-alias-label-secondary, #8b8f9c); margin-bottom: 4px; }
      .dtp-progress.jumpable { cursor: pointer; transition: border-color .15s, background .15s, transform .15s; }
      .dtp-progress.jumpable:hover { border-color: var(--dtp-hairline); background: var(--dsw-alias-state-warn-tertiary); transform: translateY(-1px); }
      .dtp-progress.jumpable::after { content: '查看进度 / 进入会话'; display: block; margin-top: 4px; font-size: 10px; font-weight: 700; color: var(--dsw-alias-state-warn-primary); }
      .dtp-review { display: flex; gap: 7px; align-items: flex-start; margin: 2px 0 8px; padding: 8px 10px; border-radius: 10px; font-size: 11px; line-height: 1.5; word-break: break-word; box-shadow: 0 1px 0 var(--dtp-glass-1) inset; }
      .dtp-review.ok { background: var(--dsw-alias-state-success-tertiary); border: 1px solid var(--dtp-hairline); color: var(--dsw-alias-state-success-primary); }
      .dtp-review.bad { background: var(--dsw-alias-state-error-tertiary); border: 1px solid var(--dtp-hairline); color: var(--dsw-alias-state-error-primary); }
      .dtp-review .lab { font-weight: 700; flex: 0 0 auto; }
      .dtp-session-list { display: flex; flex-direction: column; gap: 6px; max-height: 150px; overflow: auto; }
      .dtp-session-option { display: flex; gap: 8px; align-items: flex-start; padding: 8px 9px; border: 1px solid var(--dtp-hairline); border-radius: 10px; background: var(--dtp-glass-1); cursor: pointer; transition: background .15s, border-color .15s; }
      .dtp-session-option:hover { background: var(--dtp-glass-2); border-color: var(--dtp-glass-3); }
      .dtp-session-option input { width: 14px; height: 14px; margin-top: 2px; flex: 0 0 auto; accent-color: #9db7df; }
      .dtp-session-option .main { flex: 1; min-width: 0; }
      .dtp-session-option .sid { color: var(--dtp-text); font-size: 11px; font-weight: 680; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .dtp-session-option .snip { color: var(--dtp-muted); font-size: 10.5px; line-height: 1.4; margin-top: 2px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
      .dtp-pulse { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--dtp-warn); margin-right: 6px; animation: dtp-pulse 1.2s ease-in-out infinite; }
      @keyframes dtp-pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: .35; transform: scale(.8); } }
      .dtp-badge { font-size: 11px; color: var(--dsw-alias-state-success-primary); font-weight: 700; padding: 2px 8px; border-radius: 7px; background: var(--dsw-alias-state-success-tertiary); border: 1px solid var(--dtp-hairline); }
      .dtp-empty { color: var(--dtp-muted); font-size: 11px; text-align: center; padding: 20px 10px; border-radius: 12px; background: var(--dtp-glass-0); border: 1px dashed var(--dtp-glass-2); }
      .dtp-modal-backdrop { position: fixed; inset: 0; background: rgba(3,7,13,.58); backdrop-filter: blur(22px) saturate(125%); -webkit-backdrop-filter: blur(22px) saturate(125%); display: flex; align-items: center; justify-content: center; z-index: 10000; padding: 18px; }
      .dtp-modal { background: linear-gradient(180deg, var(--dtp-solid-c), var(--dtp-solid-b)); border: 1px solid var(--dtp-glass-2); border-radius: 14px; padding: 18px 20px; width: 540px; max-width: 92vw; max-height: 84vh; overflow: auto; box-shadow: 0 34px 90px var(--dtp-shadow-ink), 0 1px 0 var(--dtp-hairline) inset; backdrop-filter: blur(30px) saturate(130%); -webkit-backdrop-filter: blur(30px) saturate(130%); }
      .dtp-modal h2 { font-size: 14px; margin: 0 0 14px; color: var(--dtp-text); font-weight: 750; letter-spacing: 0; }
      .dtp-field { margin-bottom: 12px; }
      .dtp-field label { display: block; font-size: 11px; color: var(--dtp-muted); margin-bottom: 5px; font-weight: 650; }
      .dtp-field input, .dtp-field select, .dtp-field textarea { width: 100%; box-sizing: border-box; background: var(--dtp-glass-1); color: var(--dtp-text); border: 1px solid var(--dtp-glass-2); border-radius: 9px; padding: 8px 10px; font-size: 12px; outline: none; transition: border-color .15s, background .15s, box-shadow .15s; box-shadow: 0 1px 0 var(--dtp-glass-1) inset; }
      .dtp-field input:focus, .dtp-field select:focus, .dtp-field textarea:focus { border-color: var(--dtp-accent); background: var(--dtp-glass-2); box-shadow: 0 0 0 3px var(--dtp-accent-soft), 0 1px 0 var(--dtp-glass-1) inset; }
      .dtp-field input::placeholder, .dtp-field textarea::placeholder { color: var(--dtp-muted); }
      .dtp-check { display: flex; align-items: flex-start; gap: 9px; padding: 10px 11px; background: var(--dtp-glass-1); border: 1px solid var(--dtp-glass-2); border-radius: 9px; }
      .dtp-check input { width: 16px; height: 16px; margin: 1px 0 0; flex: 0 0 auto; accent-color: var(--dtp-accent); }
      .dtp-check .txt { flex: 1; min-width: 0; color: var(--dtp-text); font-size: 12px; font-weight: 700; }
      .dtp-check .hint { display: block; margin-top: 2px; color: var(--dtp-muted); font-size: 11px; font-weight: 400; line-height: 1.4; }
      .dtp-workdir-row { display: flex; gap: 6px; }
      .dtp-workdir-row input { flex: 1; min-width: 0; }
      .dtp-workdir-row .dtp-btn { flex: 0 0 auto; }
      .dtp-dirbrowser { display: flex; flex-direction: column; gap: 8px; min-height: 320px; }
      .dtp-dircrumbs { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; font-size: 11px; }
      .dtp-dircrumb { cursor: pointer; color: var(--dsw-alias-label-secondary); padding: 3px 7px; border-radius: 7px; background: var(--dtp-accent-soft); border: 1px solid var(--dtp-accent-soft); }
      .dtp-dircrumb:hover { background: var(--dtp-accent-soft); }
      .dtp-dircrumb.last { color: var(--dtp-text); cursor: default; background: var(--dtp-glass-1); border-color: var(--dtp-glass-2); }
      .dtp-dirsep { color: var(--dtp-muted); }
      .dtp-direntries { flex: 1; min-height: 0; overflow-y: auto; border: 1px solid var(--dtp-glass-2); border-radius: 10px; background: var(--dtp-glass-0); }
      .dtp-direntry { display: flex; align-items: center; gap: 8px; padding: 8px 12px; cursor: pointer; font-size: 12px; border-bottom: 1px solid var(--dtp-glass-1); color: var(--dtp-text); transition: background .15s; }
      .dtp-direntry:hover { background: var(--dtp-accent-soft); }
      .dtp-direntry .ic { flex: 0 0 auto; font-size: 13px; }
      .dtp-dirselect { margin-left: auto; flex: 0 0 auto; }
      .dtp-dirpath { font-size: 11px; color: var(--dtp-muted); word-break: break-word; padding: 7px 10px; background: var(--dtp-glass-1); border: 1px solid var(--dtp-glass-2); border-radius: 10px; }
      .dtp-modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
      .dtp-transcript { display: flex; flex-direction: column; gap: 8px; }
      .dtp-msg { border-radius: 12px; padding: 10px 12px; font-size: 12px; white-space: pre-wrap; word-break: break-word; line-height: 1.55; border: 1px solid var(--dtp-glass-2); }
      .dtp-msg.user { background: var(--dsw-alias-state-business-tertiary); border-left: 3px solid var(--dtp-accent); }
      .dtp-msg.assistant { background: var(--dtp-glass-1); border-left: 3px solid var(--dsw-alias-label-tertiary); }
      .dtp-msg.tool { background: var(--dsw-alias-interactive-bg-hover); border-left: 3px solid var(--dtp-faint); color: var(--dtp-muted); font-size: 11px; }
      .dtp-msg .who { font-weight: 750; display: block; margin-bottom: 3px; color: var(--dtp-text); }
      .dtp-toast { position: fixed; bottom: 26px; right: 26px; z-index: 10001; background: var(--dsw-alias-toast-bg, rgba(13,19,28,.82)); color: #fff; border: 1px solid var(--dtp-glass-2); border-radius: 10px; padding: 10px 15px; font-size: 12px; box-shadow: 0 20px 50px var(--dtp-shadow-ink), 0 1px 0 var(--dtp-glass-2) inset; backdrop-filter: blur(24px) saturate(130%); -webkit-backdrop-filter: blur(24px) saturate(130%); }
      .dtp-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
      .dtp-scroll::-webkit-scrollbar-thumb { background: var(--dtp-glass-3); border-radius: 99px; border: 2px solid transparent; background-clip: padding-box; }
      .dtp-scroll::-webkit-scrollbar-track { background: transparent; }
      @media (max-width: 980px) { .dtp-header { align-items: flex-start; flex-wrap: wrap; } .dtp-header-stats { order: 3; width: 100%; justify-content: flex-start; } .dtp-board { grid-template-columns: repeat(7, minmax(210px, 72vw)); } }
    `);
					function usePanelData() {
						const [data, setData] = react.useState(null);
						const refresh = react.useCallback(() => {
							host.call("state").then((d) => {
								if (d) setData(d);
							}).catch(() => {});
						}, []);
						react.useEffect(() => {
							refresh();
							const disposer = interval(() => refresh(), 1500);
							return () => {
								if (typeof disposer === "function") disposer();
							};
						}, [refresh]);
						return [data, refresh];
					}
					function useExecProgress() {
						const [progress, setProgress] = react.useState([]);
						react.useEffect(() => {
							const load = () => {
								host.call("progress").then((list) => {
									if (Array.isArray(list)) setProgress(list);
								}).catch(() => {});
							};
							load();
							const disposer = interval(() => load(), 1500);
							return () => {
								if (typeof disposer === "function") disposer();
							};
						}, []);
						return progress;
					}
					function useEscape(onClose) {
						react.useEffect(() => {
							const onKey = (e) => {
								if (e && e.key === "Escape") onClose();
							};
							document.addEventListener("keydown", onKey);
							return () => document.removeEventListener("keydown", onKey);
						}, [onClose]);
					}
					async function openAgentConversation(sessionId, parentSessionId) {
						if (!sessions || !sessionId) return false;
						const parent = parentSessionId || null;
						try {
							if (parent && typeof sessions.refreshSubagents === "function") try {
								await sessions.refreshSubagents(parent);
							} catch (e) {}
							if (parent && typeof sessions.subagentAddress === "function") {
								const known = sessions.subagentAddress(sessionId);
								if (known) {
									sessions.openSubagent(known);
									return true;
								}
							}
							if (parent && typeof sessions.openSubagent === "function") {
								sessions.openSubagent({
									parentSessionId: parent,
									childSessionId: sessionId,
									mode: "one-shot"
								});
								return true;
							}
							if (typeof sessions.open === "function") {
								sessions.open(sessionId);
								return true;
							}
						} catch (e) {}
						return false;
					}
					function TaskPanel(props) {
						const [data, refresh] = usePanelData();
						const progress = useExecProgress();
						const [formReq, setFormReq] = react.useState(null);
						const [reworkReq, setReworkReq] = react.useState(null);
						const [convReq, setConvReq] = react.useState(null);
						const [toast, setToast] = react.useState(null);
						const [acceptedExpanded, setAcceptedExpanded] = react.useState(false);
						react.useEffect(() => {
							if (!toast) return;
							const disposer = timeout(() => setToast(null), 2600);
							return () => {
								if (typeof disposer === "function") disposer();
							};
						}, [toast]);
						const byStage = (s) => data ? data.requirements.filter((r) => r.stage === s) : [];
						const columns = [
							{
								stage: "backlog",
								title: "需求队列",
								color: "var(--dtp-faint)",
								count: byStage("backlog").length
							},
							{
								stage: "queued",
								title: "执行队列",
								color: "var(--dtp-faint)",
								count: byStage("queued").length
							},
							{
								stage: "executing",
								title: "执行中",
								color: "var(--dsw-alias-state-warn-primary)",
								count: byStage("executing").length
							},
							{
								stage: "reviewing",
								title: "自动复核",
								color: "var(--dsw-alias-label-tertiary)",
								count: byStage("reviewing").length
							},
							{
								stage: "paused",
								title: "已暂停",
								color: "var(--dtp-faint)",
								count: byStage("paused").length
							},
							{
								stage: "accepting",
								title: "待验收",
								color: "var(--dtp-ok)",
								count: byStage("accepting").length
							},
							{
								stage: "accepted",
								title: "验收完成",
								color: "var(--dtp-faint)",
								count: byStage("accepted").length
							}
						];
						const doCall = (method, args) => {
							host.call(method, args).then(() => refresh()).catch((e) => setToast("操作失败：" + (e && e.message ? e.message : String(e))));
						};
						const viewConversation = (r) => {
							openAgentConversation(r.lastSessionId, r.lastParentSessionId).then((ok) => {
								if (!ok) setConvReq({
									id: r.id,
									title: r.title,
									sessionId: r.lastSessionId
								});
							});
						};
						const jumpSession = (p) => {
							if (!p || !p.sessionId) {
								setToast("子会话尚未建立，稍后再试");
								return;
							}
							openAgentConversation(p.sessionId, p.parentSessionId).then((ok) => {
								if (!ok) setConvReq({
									id: p.id,
									title: p.title,
									sessionId: p.sessionId
								});
							});
						};
						const total = data ? data.requirements.length : 0;
						const executing = byStage("executing").length;
						const reviewing = byStage("reviewing").length;
						const accepting = byStage("accepting").length;
						const queued = byStage("queued").length;
						const accepted = byStage("accepted").length;
						return h("div", { className: "dtp-root" }, h("div", { className: "dtp-header" }, h("div", { className: "dtp-title" }, h("div", { className: "dtp-logo" }, "▦"), h("div", null, h("h1", null, "任务面板"), h("div", { className: "sub" }, total + " 条需求" + (executing ? " · " + executing + " 执行中" : "") + (reviewing ? " · " + reviewing + " 复核中" : "") + (accepting ? " · " + accepting + " 待验收" : "") + " · 队列在子 session 自动执行"))), h("div", { className: "dtp-header-stats" }, h("span", { className: "dtp-stat" }, "队列 " + queued), h("span", { className: "dtp-stat" }, "执行 " + executing), h("span", { className: "dtp-stat" }, "复核 " + reviewing), h("span", { className: "dtp-stat" }, "验收 " + accepting), h("span", { className: "dtp-stat" }, "完成 " + accepted)), h("button", {
							className: "dtp-btn primary",
							onClick: () => setFormReq({ mode: "create" })
						}, "新建需求")), h("div", { className: "dtp-board dtp-scroll" }, columns.map((col) => {
							const items = byStage(col.stage);
							const visibleItems = col.stage === "accepted" && !acceptedExpanded && items.length > 5 ? items.slice(0, 5) : items;
							return h("div", {
								className: "dtp-col",
								key: col.stage,
								style: { "--dtp-accent": col.color }
							}, h("div", { className: "dtp-col-head" }, h("span", {
								className: "dtp-dot",
								style: {
									color: col.color,
									background: col.color
								}
							}), h("span", { className: "name" }, col.title), h("span", { className: "dtp-count" }, String(col.count))), h("div", { className: "dtp-col-body dtp-scroll" }, items.length === 0 ? h("div", { className: "dtp-empty" }, "— 暂无需求 —") : [...visibleItems.map((r) => h(Card, {
								key: r.id,
								req: r,
								stage: col.stage,
								progress: (progress || []).find((p) => p.id === r.id) || null,
								onEdit: () => setFormReq({
									mode: "edit",
									id: r.id
								}),
								onDelete: () => doCall("remove", { id: r.id }),
								onDispatch: () => doCall("dispatch", { id: r.id }),
								onRecall: () => doCall("recall", { id: r.id }),
								onTop: () => doCall("top", { id: r.id }),
								onAccept: () => doCall("accept", { id: r.id }),
								onRework: () => setReworkReq({
									id: r.id,
									title: r.title
								}),
								onPause: () => doCall("pause", { id: r.id }),
								onStop: () => doCall("stop", { id: r.id }),
								onResume: () => doCall("resume", { id: r.id }),
								onConv: () => viewConversation(r),
								onJumpSession: () => jumpSession((progress || []).find((p) => p.id === r.id) || null)
							})), col.stage === "accepted" && items.length > 5 ? h("button", {
								key: "accepted-more",
								className: "dtp-btn small",
								style: {
									width: "100%",
									justifyContent: "center"
								},
								onClick: () => setAcceptedExpanded(!acceptedExpanded),
								title: acceptedExpanded ? "收起验收完成列表" : "展示更多验收完成任务"
							}, acceptedExpanded ? "收起" : "展示更多（还有 " + (items.length - 5) + " 条）") : null]));
						})), formReq ? h(RequirementForm, {
							req: formReq.mode === "edit" && data ? data.requirements.find((x) => x.id === formReq.id) : null,
							lastWorkdir: data ? data.lastWorkdir : null,
							onClose: () => setFormReq(null),
							onSaved: () => {
								setFormReq(null);
								refresh();
							},
							onToast: (m) => setToast(m)
						}) : null, reworkReq ? h(ReworkModal, {
							req: reworkReq,
							onClose: () => setReworkReq(null),
							onDone: () => {
								setReworkReq(null);
								refresh();
							},
							onToast: (m) => setToast(m)
						}) : null, convReq ? h(ConversationModal, {
							req: convReq,
							onClose: () => setConvReq(null)
						}) : null, toast ? h("div", { className: "dtp-toast" }, toast) : null);
					}
					function Card(props) {
						const { req, stage, progress, onEdit, onDelete, onDispatch, onRecall, onTop, onAccept, onRework, onPause, onStop, onResume, onConv, onJumpSession } = props;
						const [confirmDel, setConfirmDel] = react.useState(false);
						const [deliverableOpen, setDeliverableOpen] = react.useState(stage !== "accepted");
						react.useEffect(() => {
							if (!confirmDel) return;
							const disposer = timeout(() => setConfirmDel(false), 2500);
							return () => {
								if (typeof disposer === "function") disposer();
							};
						}, [confirmDel]);
						react.useEffect(() => {
							setDeliverableOpen(stage !== "accepted");
						}, [stage]);
						const delBtn = h("button", {
							className: "dtp-btn small danger",
							onClick: () => {
								if (confirmDel) {
									setConfirmDel(false);
									onDelete();
								} else setConfirmDel(true);
							}
						}, confirmDel ? "确认删除?" : "删除");
						let actions = null;
						if (stage === "backlog") actions = h("div", { className: "dtp-actions" }, h("button", {
							className: "dtp-btn small primary",
							onClick: onDispatch
						}, "丢执行"), h("button", {
							className: "dtp-btn small",
							onClick: onEdit
						}, "编辑"), delBtn);
						else if (stage === "queued") actions = h("div", { className: "dtp-actions" }, h("button", {
							className: "dtp-btn small",
							onClick: onTop
						}, "置顶"), h("button", {
							className: "dtp-btn small",
							onClick: onRecall
						}, "撤回"), delBtn);
						else if (stage === "executing") actions = h("div", { className: "dtp-actions" }, h("span", { className: "dtp-status-line" }, h("span", { className: "dtp-pulse" }), "子 agent 执行中" + (progress && progress.sessionId ? " · " + String(progress.sessionId).slice(0, 8) : "") + (progress ? " · " + Math.round((progress.elapsedMs || 0) / 1e3) + "s" : "")), h("button", {
							className: "dtp-btn small ok",
							onClick: onJumpSession,
							disabled: !(progress && progress.sessionId),
							title: progress && progress.sessionId ? "查看进度 = 跳转到对应子代理会话（实时进度）" : "子会话尚未建立"
						}, "查看进度"), h("button", {
							className: "dtp-btn small",
							onClick: onPause
						}, "暂停"), h("button", {
							className: "dtp-btn small danger",
							onClick: onStop
						}, "停止"));
						else if (stage === "reviewing") actions = h("div", { className: "dtp-actions" }, h("span", { className: "dtp-status-line" }, h("span", {
							className: "dtp-pulse",
							style: { background: "var(--dtp-accent)" }
						}), "复核 agent 检查中" + (progress && progress.sessionId ? " · " + String(progress.sessionId).slice(0, 8) : "") + (progress ? " · " + Math.round((progress.elapsedMs || 0) / 1e3) + "s" : "")), h("button", {
							className: "dtp-btn small ok",
							onClick: onJumpSession,
							disabled: !(progress && progress.sessionId),
							title: progress && progress.sessionId ? "查看复核进度 = 跳转到对应子代理会话" : "复核子会话尚未建立"
						}, "查看复核"), h("button", {
							className: "dtp-btn small",
							onClick: onPause
						}, "暂停"), h("button", {
							className: "dtp-btn small danger",
							onClick: onStop
						}, "停止"));
						else if (stage === "paused") actions = h("div", { className: "dtp-actions" }, h("button", {
							className: "dtp-btn small primary",
							onClick: onResume
						}, "恢复"), h("button", {
							className: "dtp-btn small danger",
							onClick: () => {
								if (confirmDel) {
									setConfirmDel(false);
									onDelete();
								} else setConfirmDel(true);
							}
						}, confirmDel ? "确认删除?" : "删除"));
						else if (stage === "accepting") actions = h("div", { className: "dtp-actions" }, h("button", {
							className: "dtp-btn small",
							onClick: onConv
						}, "查看对话"), h("button", {
							className: "dtp-btn small ok",
							onClick: onAccept
						}, "通过"), h("button", {
							className: "dtp-btn small danger",
							onClick: onRework
						}, "返工"));
						else if (stage === "accepted") actions = h("div", { className: "dtp-actions" }, h("button", {
							className: "dtp-btn small",
							onClick: onConv
						}, "查看对话"), h("span", { className: "dtp-badge" }, "验收通过"));
						const pri = String(req.priority || "medium");
						let progressBlock = null;
						if ((stage === "executing" || stage === "reviewing") && progress && Array.isArray(progress.recent) && progress.recent.length) {
							const who = {
								user: "用户",
								assistant: "Agent",
								tool: "工具"
							};
							const jumpable = !!progress.sessionId;
							progressBlock = h("div", {
								className: "dtp-progress" + (jumpable ? " jumpable" : ""),
								title: jumpable ? "点击跳转到对应子代理会话" : "子会话尚未建立",
								onClick: jumpable ? onJumpSession : void 0
							}, progress.workdir ? h("div", {
								className: "pmeta",
								title: progress.workdir
							}, "目录 " + progress.workdir) : null, progress.recent.slice(-3).map((m, i) => h("div", {
								className: "prow",
								key: i
							}, h("span", { className: "pwho" }, who[m.role] || m.role), h("span", { className: "ptxt" }, String(m.text || "").slice(0, 90)))));
						}
						let reviewBlock = null;
						if ((stage === "accepting" || stage === "accepted") && req.reviewCount) {
							const passed = req.reviewPassed === true;
							const issues = Array.isArray(req.reviewIssues) ? req.reviewIssues : [];
							const text = (req.reviewVerdict || (passed ? "自动复核通过" : "自动复核发现问题")) + (!passed && issues.length ? "；问题：" + issues.slice(0, 3).join("；") : "");
							reviewBlock = h("div", {
								className: "dtp-review " + (passed ? "ok" : "bad"),
								title: "自动复核结论"
							}, h("span", { className: "lab" }, passed ? "复核通过" : "复核注意"), h("span", null, text));
						}
						let deliverableBlock = null;
						if ((stage === "accepting" || stage === "accepted") && req.deliverable) if (deliverableOpen) deliverableBlock = h("div", {
							className: "dtp-deliverable" + (stage === "accepted" ? " dtp-deliverable-collapsed" : ""),
							title: stage === "accepted" ? "点击收起验收产物" : "验收产物（一句话）",
							onClick: stage === "accepted" ? () => setDeliverableOpen(false) : void 0
						}, h("span", { className: "lab" }, "产物"), req.deliverable);
						else deliverableBlock = h("div", {
							className: "dtp-deliverable dtp-deliverable-collapsed",
							title: "点击展开验收产物",
							onClick: () => setDeliverableOpen(true)
						}, h("span", { className: "lab" }, "产物"), h("span", {
							className: "ptxt",
							style: {
								flex: 1,
								minWidth: 0,
								overflow: "hidden",
								textOverflow: "ellipsis",
								whiteSpace: "nowrap"
							}
						}, String(req.deliverable).slice(0, 60) + (String(req.deliverable).length > 60 ? "…" : "")));
						return h("div", { className: "dtp-card" }, h("div", { className: "dtp-card-title" }, h("span", { className: "dtp-pri dtp-pri-" + pri }, pri), " ", req.title), h("div", { className: "dtp-card-meta" }, h("span", null, req.id), h("span", null, "要素 " + req.elementCount), h("span", null, "验收 " + req.criterionCount), h("span", {
							title: req.autoReview === false ? "执行完成后不启动复核 agent" : "执行完成后自动启动复核 agent",
							style: { color: req.autoReview === false ? "var(--dsw-alias-state-warn-primary)" : "var(--dsw-alias-link)" }
						}, req.autoReview === false ? "免复核" : "自动复核"), req.contextAnchors && req.contextAnchors.length ? h("span", {
							title: "已关联历史会话",
							style: { color: "var(--dsw-alias-state-success-primary)" }
						}, "会话 " + req.contextAnchors.length) : null, req.workdir ? h("span", {
							title: "绑定工作目录",
							style: {
								color: "var(--dtp-muted)",
								maxWidth: 150,
								overflow: "hidden",
								textOverflow: "ellipsis",
								whiteSpace: "nowrap"
							}
						}, "目录 " + req.workdir) : h("span", { style: { color: "var(--dsw-alias-state-warn-primary)" } }, "未绑定目录"), req.scheduledAt ? h("span", {
							title: "计划执行时间",
							style: { color: req.scheduledAt > Date.now() ? "var(--dsw-alias-link)" : "var(--dsw-alias-state-success-primary)" }
						}, "定时 " + formatScheduledAt(req.scheduledAt)) : null, req.reworkCount ? h("span", { style: { color: "var(--dsw-alias-state-warn-primary)" } }, "返工 " + req.reworkCount) : null), progressBlock, reviewBlock, deliverableBlock, actions);
					}
					function RequirementForm(props) {
						const { req, lastWorkdir, onClose, onSaved, onToast } = props;
						const isEdit = !!req;
						const [title, setTitle] = react.useState(req ? req.title : "");
						const [description, setDescription] = react.useState(req ? req.description : "");
						const [priority, setPriority] = react.useState(req ? req.priority : "medium");
						const [scope, setScope] = react.useState(req ? (req.scope || []).join(", ") : "");
						const [command, setCommand] = react.useState(req ? req.command || "" : "");
						const [workdir, setWorkdir] = react.useState(req ? req.workdir || "" : lastWorkdir || "");
						const [scheduledAt, setScheduledAt] = react.useState(req ? toDateTimeLocalValue(req.scheduledAt) : "");
						const [autoReview, setAutoReview] = react.useState(req ? req.autoReview !== false : true);
						const [sessionCandidates, setSessionCandidates] = react.useState(req && Array.isArray(req.contextAnchors) ? req.contextAnchors : []);
						const [selectedSessionIds, setSelectedSessionIds] = react.useState(req && Array.isArray(req.contextAnchors) ? req.contextAnchors.map((s) => s.sessionId) : []);
						const [sessionLoading, setSessionLoading] = react.useState(false);
						const [dirPickerOpen, setDirPickerOpen] = react.useState(false);
						const [busy, setBusy] = react.useState(false);
						useEscape(onClose);
						const loadSessionCandidates = react.useCallback(() => {
							const qTitle = title.trim();
							const qDesc = description.trim();
							if (!qTitle && !qDesc) return;
							setSessionLoading(true);
							host.call("suggest-sessions", {
								title: qTitle,
								description: qDesc,
								scope: scope.split(",").map((s) => s.trim()).filter(Boolean),
								limit: 6
							}).then((r) => {
								setSessionLoading(false);
								const items = r && Array.isArray(r.items) ? r.items : [];
								setSessionCandidates((prev) => {
									const map = /* @__PURE__ */ new Map();
									for (const item of [...prev || [], ...items]) if (item && item.sessionId) map.set(item.sessionId, item);
									return Array.from(map.values()).slice(0, 8);
								});
								if (!isEdit && selectedSessionIds.length === 0) setSelectedSessionIds(items.slice(0, 3).map((x) => x.sessionId).filter(Boolean));
							}).catch(() => setSessionLoading(false));
						}, [
							title,
							description,
							scope,
							isEdit,
							selectedSessionIds.length
						]);
						react.useEffect(() => {
							if (isEdit) return;
							const disposer = timeout(() => loadSessionCandidates(), 500);
							return () => {
								if (typeof disposer === "function") disposer();
							};
						}, [isEdit, loadSessionCandidates]);
						const toggleSession = (sessionId) => {
							setSelectedSessionIds((prev) => prev.includes(sessionId) ? prev.filter((id) => id !== sessionId) : [...prev, sessionId]);
						};
						const save = () => {
							if (!title.trim()) {
								onToast("标题不能为空");
								return;
							}
							if (!workdir.trim()) {
								onToast("请绑定工作目录（子 agent 将在此目录执行）");
								return;
							}
							setBusy(true);
							const args = {
								title: title.trim(),
								description,
								priority,
								scope: scope.split(",").map((s) => s.trim()).filter(Boolean),
								command: command.trim() || null,
								workdir: workdir.trim(),
								scheduledAt: parseDateTimeLocalValue(scheduledAt),
								autoReview
							};
							if (sessionCandidates.length > 0) args.contextAnchors = sessionCandidates.filter((s) => selectedSessionIds.includes(s.sessionId));
							const method = isEdit ? "update" : "create";
							if (isEdit) args.id = req.id;
							host.call(method, args).then(() => {
								setBusy(false);
								onSaved();
							}).catch((e) => {
								setBusy(false);
								onToast("保存失败：" + (e && e.message ? e.message : String(e)));
							});
						};
						return h("div", {
							className: "dtp-modal-backdrop",
							onClick: onClose
						}, h("div", {
							className: "dtp-modal",
							onClick: (e) => e.stopPropagation()
						}, h("h2", null, isEdit ? "编辑需求 " + req.id : "新建需求"), !isEdit && !workdir ? h("div", {
							className: "dtp-field",
							style: {
								background: "var(--dsw-alias-state-warn-tertiary)",
								border: "1px solid var(--dtp-hairline)",
								borderRadius: 9,
								padding: "7px 10px",
								color: "var(--dsw-alias-state-warn-primary)",
								fontSize: 11
							}
						}, "尚未绑定工作目录，子 agent 执行时无法确定落盘位置，请选择或填写「绑定工作目录」。") : null, h("div", { className: "dtp-field" }, h("label", null, "标题 *"), h("input", {
							value: title,
							onChange: (e) => setTitle(e.target.value),
							placeholder: "一句话描述需求"
						})), h("div", { className: "dtp-field" }, h("label", null, "详细描述"), h("textarea", {
							value: description,
							onChange: (e) => setDescription(e.target.value),
							rows: 3,
							placeholder: "背景 / 目标 / 约束"
						})), h("div", { className: "dtp-field" }, h("label", null, "优先级"), h("select", {
							value: priority,
							onChange: (e) => setPriority(e.target.value)
						}, [
							"critical",
							"high",
							"medium",
							"low"
						].map((p) => h("option", {
							key: p,
							value: p
						}, p)))), h("div", { className: "dtp-field" }, h("label", null, "绑定工作目录 *"), h("div", { className: "dtp-workdir-row" }, h("input", {
							value: workdir,
							onChange: (e) => setWorkdir(e.target.value),
							placeholder: "如: /path/to/project（子 agent 在此目录执行）"
						}), h("button", {
							className: "dtp-btn",
							onClick: () => setDirPickerOpen(true)
						}, "浏览"))), h("div", { className: "dtp-field" }, h("label", null, "涉及范围（逗号分隔）"), h("input", {
							value: scope,
							onChange: (e) => setScope(e.target.value),
							placeholder: "如: src/, docs/"
						})), h("div", { className: "dtp-field" }, h("label", null, "执行命令（可选）"), h("input", {
							value: command,
							onChange: (e) => setCommand(e.target.value),
							placeholder: "如: npm test"
						})), h("div", { className: "dtp-field" }, h("label", null, "计划执行时间（可选）"), h("input", {
							type: "datetime-local",
							value: scheduledAt,
							onChange: (e) => setScheduledAt(e.target.value),
							title: "留空则进入执行队列后立即执行"
						})), h("div", { className: "dtp-field" }, h("label", { className: "dtp-check" }, h("input", {
							type: "checkbox",
							checked: autoReview,
							onChange: (e) => setAutoReview(e.target.checked)
						}), h("span", { className: "txt" }, "自动复核", h("span", { className: "hint" }, autoReview ? "执行完成后启动复核 agent，再进入待验收。" : "执行完成后直接进入待验收，不启动复核 agent。")))), h("div", { className: "dtp-field" }, h("label", null, "关联历史会话（可选）"), h("div", { style: {
							display: "flex",
							gap: 8,
							marginBottom: 7
						} }, h("button", {
							className: "dtp-btn small",
							onClick: loadSessionCandidates,
							disabled: sessionLoading
						}, sessionLoading ? "扫描中…" : "扫描相关会话"), h("span", { style: {
							fontSize: 11,
							color: "var(--dsw-alias-label-secondary, #9297a5)",
							alignSelf: "center"
						} }, selectedSessionIds.length ? "已选 " + selectedSessionIds.length + " 条" : "未选择")), h("div", { className: "dtp-session-list dtp-scroll" }, sessionCandidates.length === 0 ? h("div", {
							className: "dtp-empty",
							style: { padding: "8px 0" }
						}, sessionLoading ? "正在扫描…" : "暂无候选会话") : sessionCandidates.map((s) => h("label", {
							className: "dtp-session-option",
							key: s.sessionId
						}, h("input", {
							type: "checkbox",
							checked: selectedSessionIds.includes(s.sessionId),
							onChange: () => toggleSession(s.sessionId)
						}), h("span", { className: "main" }, h("span", {
							className: "sid",
							title: s.sessionId
						}, (s.title ? s.title + " · " : "") + s.sessionId), h("span", { className: "snip" }, s.snippet || s.cwd || "（无摘要）")))))), h("div", { className: "dtp-modal-actions" }, h("button", {
							className: "dtp-btn",
							onClick: onClose
						}, "取消"), h("button", {
							className: "dtp-btn primary",
							onClick: save,
							disabled: busy
						}, busy ? "保存中…" : "保存"))), dirPickerOpen ? h(DirectoryPickerModal, {
							initial: workdir,
							onClose: () => setDirPickerOpen(false),
							onPick: (path) => {
								setWorkdir(path);
								setDirPickerOpen(false);
							},
							onToast
						}) : null);
					}
					function DirectoryPickerModal(props) {
						const { initial, onClose, onPick, onToast } = props;
						const [mode, setMode] = react.useState(null);
						const [path, setPath] = react.useState(initial || "");
						const [crumbs, setCrumbs] = react.useState([]);
						const [entries, setEntries] = react.useState([]);
						const [loading, setLoading] = react.useState(false);
						const [error, setError] = react.useState(null);
						useEscape(onClose);
						react.useEffect(() => {
							let cancelled = false;
							host.call("browse-dir", { path: initial || void 0 }).then((r) => {
								if (cancelled) return;
								if (r && r.ok) {
									setMode("browse");
									setCrumbs(r.crumbs || []);
									setEntries(r.entries || []);
									setPath(r.path || initial || "");
								} else if (r && r.native) {
									setMode("native");
									setError(null);
								} else {
									setMode("browse");
									setError((r && r.error ? r.error : "目录浏览不可用") + "；也可以关闭弹窗后直接在输入框粘贴路径。");
								}
							}).catch(() => {
								if (!cancelled) setMode("browse");
							});
							return () => {
								cancelled = true;
							};
						}, []);
						const openDir = (p) => {
							setLoading(true);
							setError(null);
							host.call("browse-dir", { path: p }).then((r) => {
								setLoading(false);
								if (r && r.ok) {
									setCrumbs(r.crumbs || []);
									setEntries(r.entries || []);
									setPath(r.path || p);
								} else setError(r && r.error ? r.error : "无法打开目录");
							}).catch(() => {
								setLoading(false);
								setError("无法打开目录");
							});
						};
						const pickNative = () => {
							setLoading(true);
							setError(null);
							host.call("pick-dir", {}).then((r) => {
								setLoading(false);
								if (r && r.ok && r.path) onPick(r.path);
								else setError(r && r.error ? r.error : "已取消或不可用");
							}).catch(() => {
								setLoading(false);
								setError("目录选择失败");
							});
						};
						return h("div", {
							className: "dtp-modal-backdrop",
							onClick: onClose
						}, h("div", {
							className: "dtp-modal",
							style: { width: 560 },
							onClick: (e) => e.stopPropagation()
						}, h("h2", null, "选择工作目录"), h("div", { className: "dtp-dirbrowser" }, h("div", { style: {
							display: "flex",
							gap: 8,
							alignItems: "center"
						} }, mode === "native" ? h("button", {
							className: "dtp-btn primary",
							onClick: pickNative,
							disabled: loading
						}, loading ? "打开选择器…" : "打开系统目录选择器") : h("button", {
							className: "dtp-btn",
							onClick: () => openDir(initial || void 0),
							disabled: loading
						}, "刷新"), h("button", {
							className: "dtp-btn",
							onClick: () => openDir(void 0)
						}, "主目录")), error ? h("div", { style: {
							fontSize: 11,
							color: "var(--dsw-alias-state-error-primary)",
							padding: "6px 10px",
							background: "var(--dsw-alias-state-error-tertiary)",
							border: "1px solid var(--dtp-hairline)",
							borderRadius: 9
						} }, error) : null, mode !== "native" ? h("div", { className: "dtp-dircrumbs" }, (crumbs.length ? crumbs : [{
							name: "…",
							path: void 0
						}]).map((c, i) => {
							const isLast = i === crumbs.length - 1;
							return h("span", {
								key: i,
								style: {
									display: "inline-flex",
									alignItems: "center",
									gap: 4
								}
							}, h("span", {
								className: "dtp-dircrumb" + (isLast ? " last" : ""),
								onClick: () => {
									if (!isLast && c.path) openDir(c.path);
								}
							}, c.name), !isLast ? h("span", { className: "dtp-dirsep" }, "›") : null);
						})) : null, mode !== "native" ? h("div", { className: "dtp-direntries" }, loading ? h("div", { className: "dtp-empty" }, h("span", { className: "dtp-spin" }), "加载中…") : entries.length === 0 ? h("div", { className: "dtp-empty" }, "（无子目录）") : entries.map((e, i) => h("div", {
							className: "dtp-direntry",
							key: i,
							onClick: () => openDir(e.path)
						}, h("span", { className: "ic" }, e.hidden ? "隐" : "目录"), h("span", { style: {
							overflow: "hidden",
							textOverflow: "ellipsis",
							whiteSpace: "nowrap"
						} }, e.name), h("button", {
							className: "dtp-btn small dtp-dirselect",
							onClick: (ev) => {
								ev.stopPropagation();
								onPick(e.path);
							}
						}, "选用")))) : null, h("div", { className: "dtp-dirpath" }, "当前：" + (path || "（未选择）"))), h("div", { className: "dtp-modal-actions" }, h("button", {
							className: "dtp-btn",
							onClick: onClose
						}, "取消"), h("button", {
							className: "dtp-btn primary",
							onClick: () => {
								if (path) onPick(path);
							},
							disabled: !path
						}, "选用当前目录"))));
					}
					function ReworkModal(props) {
						const { req, onClose, onDone, onToast } = props;
						const [feedback, setFeedback] = react.useState("");
						const [busy, setBusy] = react.useState(false);
						useEscape(onClose);
						const submit = () => {
							if (!feedback.trim()) {
								onToast("请填写验收反馈（返工原因）");
								return;
							}
							setBusy(true);
							host.call("rework", {
								id: req.id,
								feedback: feedback.trim()
							}).then(() => {
								setBusy(false);
								onDone();
							}).catch((e) => {
								setBusy(false);
								onToast("返工失败：" + (e && e.message ? e.message : String(e)));
							});
						};
						return h("div", {
							className: "dtp-modal-backdrop",
							onClick: onClose
						}, h("div", {
							className: "dtp-modal",
							onClick: (e) => e.stopPropagation()
						}, h("h2", null, "验收反馈 · " + req.title), h("div", { className: "dtp-field" }, h("label", null, "反馈内容（作为返工原因，将带着它重入执行队列重新执行）"), h("textarea", {
							value: feedback,
							onChange: (e) => setFeedback(e.target.value),
							rows: 4,
							placeholder: "如：产物缺少测试用例，请补充单测并验证通过"
						})), h("div", { className: "dtp-modal-actions" }, h("button", {
							className: "dtp-btn",
							onClick: onClose
						}, "取消"), h("button", {
							className: "dtp-btn danger",
							onClick: submit,
							disabled: busy
						}, busy ? "提交中…" : "确认返工"))));
					}
					function ConversationModal(props) {
						const { req, onClose } = props;
						const [detail, setDetail] = react.useState(null);
						useEscape(onClose);
						react.useEffect(() => {
							let cancelled = false;
							host.call("conversation", {
								id: req.id,
								sessionId: req.sessionId
							}).then((d) => {
								if (!cancelled) setDetail(d);
							}).catch(() => {
								if (!cancelled) setDetail({ transcript: [] });
							});
							return () => {
								cancelled = true;
							};
						}, [req.id, req.sessionId]);
						const who = {
							user: "用户输入",
							assistant: "Agent 回复",
							tool: "工具调用"
						};
						const rows = detail && Array.isArray(detail.transcript) ? detail.transcript : [];
						return h("div", {
							className: "dtp-modal-backdrop",
							onClick: onClose
						}, h("div", {
							className: "dtp-modal",
							style: { width: 640 },
							onClick: (e) => e.stopPropagation()
						}, h("h2", null, "Agent 对话摘要 · " + req.title), h("div", { style: {
							fontSize: 11,
							color: "var(--dsw-alias-label-secondary, #9297a5)",
							marginBottom: 10
						} }, "sessionId: " + (detail && detail.sessionId ? detail.sessionId : "（无）") + " · 共 " + rows.length + " 条消息（会话已不可直接跳转，展示已捕获的摘要）"), rows.length === 0 ? h("div", { className: "dtp-empty" }, "（暂无对话记录）") : h("div", { className: "dtp-transcript dtp-scroll" }, rows.map((m, i) => h("div", {
							className: "dtp-msg " + m.role,
							key: i
						}, h("span", { className: "who" }, who[m.role] || m.role), m.text))), h("div", { className: "dtp-modal-actions" }, h("button", {
							className: "dtp-btn",
							onClick: onClose
						}, "关闭"))));
					}
					slots.inject("conversation.view", () => slots.register({
						name: "conversation.view",
						id: "dsh-task-panel",
						label: "任务面板",
						order: 20
					}, (props) => h(TaskPanel, props)));
				}
			};
		})();
		const name = "dsh-task-panel";
		const inject = [
			"slots",
			"sessions",
			...plugin.inject
		];
		function apply(ctx) {
			return plugin.apply(ctx);
		}
		(function() {
			var css = ".dtp-root{--dtp-text:var(--dsw-alias-label-primary,rgba(248,250,252,.96));--dtp-muted:var(--dsw-alias-label-secondary,rgba(203,213,225,.68));--dtp-faint:var(--dsw-alias-label-tertiary,rgba(148,163,184,.48));--dtp-hairline:var(--dsw-alias-border-l2,rgba(255,255,255,.14));--dtp-glass-0:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.035));--dtp-glass-1:var(--dsw-alias-interactive-bg-active,rgba(255,255,255,.07));--dtp-glass-2:var(--dsw-alias-interactive-bg-hover-accent,rgba(255,255,255,.12));--dtp-glass-3:rgba(30,40,60,.18);--dtp-accent:var(--dsw-alias-link,#a9b8cc);--dtp-accent-soft:var(--dsw-alias-state-business-tertiary,rgba(169,184,204,.18));--dtp-ok:var(--dsw-alias-state-success-primary,#b8c9c1);--dtp-ok-soft:var(--dsw-alias-state-success-tertiary,rgba(184,201,193,.10));--dtp-warn:var(--dsw-alias-state-warn-primary,#cbc1aa);--dtp-danger:var(--dsw-alias-state-error-primary,#c9aeb2);--dtp-solid-a:var(--dsw-alias-bg-base,#090e14);--dtp-solid-b:var(--dsw-alias-bg-layer-1,#090d13);--dtp-solid-c:var(--dsw-alias-bg-layer-2,#111821);--dtp-solid-d:var(--dsw-alias-bg-layer-1,#07140f);--dtp-solid-e:var(--dsw-alias-bg-layer-2,#07111f);--dtp-shadow-ink:rgba(30,40,60,.12);--dtp-header-bg:var(--dsw-alias-bg-base,#090e14);--dtp-col-bg:var(--dsw-alias-bg-base,#090e14);--dtp-colhead-bg:var(--dsw-alias-bg-base,#090e14);--dtp-btn-bg:transparent;}body[data-ds-dark-theme] .dtp-root{--dtp-glass-3:rgba(255,255,255,.28);--dtp-shadow-ink:rgba(0,0,0,.22);--dtp-col-bg:linear-gradient(180deg,rgba(255,255,255,.10),rgba(255,255,255,.045));--dtp-colhead-bg:linear-gradient(180deg,rgba(12,18,27,.68),rgba(12,18,27,.28));--dtp-btn-bg:linear-gradient(180deg,rgba(255,255,255,.125),rgba(255,255,255,.055));}";
			var el = document.createElement("style");
			el.id = "dtp-theme-patch";
			el.textContent = css;
			(document.head || document.documentElement).appendChild(el);
		})();
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map