// Layout chrome for the unified config shell. Relies on the design tokens
// (--bg, --panel, --accent, …) defined by ESLINT_CSS, which is injected first.
export const CONFIG_CSS = `
.cfg {
	position: relative;
	z-index: 1;
	display: flex;
	align-items: stretch;
	min-height: 100vh;
}

.cfg-nav {
	flex: 0 0 240px;
	width: 240px;
	height: 100vh;
	position: sticky;
	top: 0;
	align-self: flex-start;
	display: flex;
	flex-direction: column;
	gap: 26px;
	padding: 30px 18px;
	border-right: 1px solid var(--border);
	background: rgba(17, 19, 23, 0.6);
}

.cfg-brand { display: flex; flex-direction: column; gap: 4px; }
.cfg-word { font-family: var(--serif); font-size: 26px; line-height: 1; }
.cfg-word em { color: var(--accent); font-style: italic; }
.cfg-tag {
	color: var(--faint);
	font-size: 10px;
	text-transform: uppercase;
	letter-spacing: 1.5px;
}

.cfg-panels { display: flex; flex-direction: column; gap: 4px; }
.cfg-rail-label {
	color: var(--faint);
	font-size: 10px;
	text-transform: uppercase;
	letter-spacing: 1.5px;
	padding: 0 10px 8px;
}

.cfg-item {
	display: flex;
	flex-direction: column;
	gap: 2px;
	padding: 10px 12px;
	border-radius: 8px;
	border: 1px solid transparent;
	color: var(--text);
	text-decoration: none;
	transition: background 0.12s ease, border-color 0.12s ease;
}
.cfg-item:hover { background: var(--panel-2); }
.cfg-item[data-active='true'] { background: var(--panel-2); border-color: var(--border); }
.cfg-item[data-soon='true'] { opacity: 0.6; }
.cfg-item-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.cfg-item-name { font-weight: 500; font-size: 13px; }
.cfg-item-blurb { color: var(--dim); font-size: 11px; }
.cfg-soon {
	font-size: 9px;
	text-transform: uppercase;
	letter-spacing: 1px;
	color: var(--bg);
	background: var(--accent-dim);
	padding: 2px 6px;
	border-radius: 999px;
}

.cfg-main { flex: 1 1 auto; min-width: 0; }

.cfg-placeholder {
	position: relative;
	z-index: 1;
	max-width: 760px;
	margin: 0 auto;
	padding: 120px 28px;
	text-align: center;
}
.cfg-placeholder-title { font-family: var(--serif); font-size: 40px; margin-bottom: 12px; }
.cfg-placeholder-title em { color: var(--accent); font-style: italic; }
.cfg-placeholder-text { color: var(--dim); font-size: 14px; max-width: 460px; margin: 0 auto; }
.cfg-loading { animation: cfg-pulse 1.2s ease-in-out infinite; }
@keyframes cfg-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }

/* ---- recursive field editor ---- */
.fe-block { align-items: flex-start; }
.fe-root { margin-top: 10px; width: 100%; }
.fe-actions { flex-direction: column; gap: 6px; }
.fe-object {
	display: flex;
	flex-direction: column;
	gap: 10px;
	border-left: 2px solid var(--border);
	padding-left: 14px;
}
.fe-field { display: flex; flex-direction: column; gap: 4px; }
.fe-label { display: flex; align-items: center; gap: 8px; }
.fe-name { color: var(--dim); font-size: 12px; }
.fe-array, .fe-record, .fe-union { display: flex; flex-direction: column; gap: 6px; }
.fe-item, .fe-entry { display: flex; align-items: flex-start; gap: 6px; }
.fe-key { min-width: 160px; flex: 0 0 auto; }
.fe-add {
	align-self: flex-start;
	font-family: var(--mono);
	font-size: 11px;
	color: var(--accent);
	background: transparent;
	border: 1px dashed var(--border);
	border-radius: 7px;
	padding: 4px 10px;
	cursor: pointer;
}
.fe-add:hover { border-color: var(--accent); }
.fe-remove {
	font-family: var(--mono);
	font-size: 11px;
	color: var(--dim);
	background: transparent;
	border: 1px solid var(--border);
	border-radius: 7px;
	padding: 4px 8px;
	cursor: pointer;
}
.fe-remove:hover { color: var(--error); border-color: var(--error); }
.fe-type { color: var(--faint); font-size: 11px; margin-top: 4px; }
.fe-raw { width: 100%; }
.fe-raw .opts-input { width: 100%; }

@media (max-width: 720px) {
	.cfg { flex-direction: column; }
	.cfg-nav {
		width: auto;
		flex-basis: auto;
		height: auto;
		position: static;
		border-right: none;
		border-bottom: 1px solid var(--border);
	}
}
`;
