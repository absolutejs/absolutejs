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
