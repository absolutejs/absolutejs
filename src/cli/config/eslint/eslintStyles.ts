export const ESLINT_CSS = `
:root {
	--bg: #0b0c0e;
	--bg-grid: #14161a;
	--panel: #111317;
	--panel-2: #15181d;
	--border: #23262d;
	--border-soft: #1b1e23;
	--text: #e7e9ec;
	--dim: #82888f;
	--faint: #565c64;
	--accent: #cdf25b;
	--accent-dim: #8ea53a;
	--off: #565c64;
	--warn: #f0b429;
	--error: #ff5d5d;
	--mono: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
	--serif: 'Instrument Serif', Georgia, 'Times New Roman', serif;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

html { -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }

body {
	background-color: var(--bg);
	background-image:
		linear-gradient(var(--bg-grid) 1px, transparent 1px),
		linear-gradient(90deg, var(--bg-grid) 1px, transparent 1px);
	background-size: 44px 44px;
	background-position: center top;
	color: var(--text);
	font-family: var(--mono);
	font-size: 13px;
	line-height: 1.5;
	min-height: 100vh;
}

body::before {
	content: '';
	position: fixed;
	inset: 0;
	background: radial-gradient(ellipse 80% 60% at 50% -10%, rgba(205, 242, 91, 0.06), transparent 70%);
	pointer-events: none;
	z-index: 0;
}

.shell { position: relative; z-index: 1; max-width: 1280px; margin: 0 auto; padding: 0 28px 80px; }

/* ---- header ---- */
.topbar {
	display: flex;
	align-items: flex-end;
	justify-content: space-between;
	gap: 24px;
	padding: 34px 0 22px;
	border-bottom: 1px solid var(--border);
	flex-wrap: wrap;
}
.brand { display: flex; flex-direction: column; gap: 2px; }
.wordmark {
	font-family: var(--serif);
	font-size: 42px;
	line-height: 0.9;
	letter-spacing: -0.01em;
	font-weight: 400;
}
.wordmark em { color: var(--accent); font-style: italic; }
.subpath {
	font-size: 11px;
	color: var(--dim);
	letter-spacing: 0.02em;
	display: flex;
	align-items: center;
	gap: 8px;
}
.dot { width: 5px; height: 5px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 8px var(--accent); }
.counts { display: flex; gap: 26px; }
.count { text-align: right; }
.count b { display: block; font-size: 24px; font-weight: 500; letter-spacing: -0.02em; }
.count span { font-size: 10px; text-transform: uppercase; letter-spacing: 0.14em; color: var(--faint); }

/* ---- controls row ---- */
.controls { display: flex; gap: 12px; align-items: center; padding: 18px 0; flex-wrap: wrap; }
.tabs { display: flex; gap: 2px; background: var(--panel); border: 1px solid var(--border); border-radius: 9px; padding: 3px; }
.tab {
	font-family: var(--mono);
	font-size: 12px;
	color: var(--dim);
	background: transparent;
	border: 0;
	padding: 7px 16px;
	border-radius: 6px;
	cursor: pointer;
	transition: color 0.15s, background 0.15s;
	letter-spacing: 0.01em;
}
.tab:hover { color: var(--text); }
.tab[data-active='true'] { background: var(--panel-2); color: var(--accent); box-shadow: inset 0 0 0 1px var(--border); }
.search {
	flex: 1;
	min-width: 220px;
	font-family: var(--mono);
	font-size: 13px;
	color: var(--text);
	background: var(--panel);
	border: 1px solid var(--border);
	border-radius: 9px;
	padding: 10px 14px;
	outline: none;
	transition: border-color 0.15s, box-shadow 0.15s;
}
.search:focus { border-color: var(--accent-dim); box-shadow: 0 0 0 3px rgba(205, 242, 91, 0.08); }
.search::placeholder { color: var(--faint); }
.scope {
	min-width: 250px;
	font-family: var(--mono);
	font-size: 12.5px;
	color: var(--accent);
	background: var(--bg);
	border: 1px solid var(--border);
	border-radius: 9px;
	padding: 10px 14px;
	outline: none;
	transition: border-color 0.15s, box-shadow 0.15s;
}
.scope:focus { border-color: var(--accent-dim); box-shadow: 0 0 0 3px rgba(205, 242, 91, 0.08); }
.scope::placeholder { color: var(--faint); }
.scope-clear {
	font-family: var(--mono);
	font-size: 11px;
	color: var(--dim);
	background: var(--panel);
	border: 1px solid var(--border);
	border-radius: 8px;
	padding: 9px 12px;
	cursor: pointer;
	transition: color 0.15s, border-color 0.15s;
}
.scope-clear:hover { color: var(--error); border-color: rgba(255, 93, 93, 0.4); }

/* ---- rule controls + options editor ---- */
.rule-controls { display: flex; align-items: center; gap: 8px; }
.opts-toggle {
	font-family: var(--mono);
	font-size: 11px;
	color: var(--faint);
	background: transparent;
	border: 1px solid var(--border);
	border-radius: 7px;
	padding: 6px 10px;
	cursor: pointer;
	transition: color 0.13s, border-color 0.13s, background 0.13s;
}
.opts-toggle:hover { color: var(--text); }
.opts-toggle[data-on='true'] { color: var(--accent); border-color: var(--accent-dim); background: rgba(205, 242, 91, 0.06); }
.opts-editor { margin-top: 10px; max-width: 70ch; }
.opts-input {
	width: 100%;
	font-family: var(--mono);
	font-size: 12px;
	line-height: 1.5;
	color: var(--text);
	background: var(--bg);
	border: 1px solid var(--border);
	border-radius: 8px;
	padding: 10px 12px;
	resize: vertical;
	outline: none;
}
.opts-input:focus { border-color: var(--accent-dim); box-shadow: 0 0 0 3px rgba(205, 242, 91, 0.08); }
.opts-error { color: var(--error); font-size: 11px; margin-top: 6px; white-space: pre-wrap; }
.opts-actions { display: flex; gap: 8px; margin-top: 8px; }
.opts-btn {
	font-family: var(--mono);
	font-size: 11px;
	color: var(--dim);
	background: var(--panel);
	border: 1px solid var(--border);
	border-radius: 7px;
	padding: 7px 13px;
	cursor: pointer;
	transition: color 0.13s, border-color 0.13s;
}
.opts-btn:hover { color: var(--text); }
.opts-btn.save { color: var(--accent); border-color: var(--accent-dim); }
.opts-btn.save:hover { background: rgba(205, 242, 91, 0.08); }

/* ---- layout ---- */
.layout { display: grid; grid-template-columns: 200px 1fr; gap: 24px; margin-top: 20px; align-items: start; }
.rail { position: sticky; top: 20px; display: flex; flex-direction: column; gap: 3px; }
.rail-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.16em; color: var(--faint); padding: 4px 10px 8px; }
.source-btn {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
	font-family: var(--mono);
	font-size: 12px;
	color: var(--dim);
	background: transparent;
	border: 0;
	border-left: 2px solid transparent;
	padding: 7px 10px;
	cursor: pointer;
	text-align: left;
	transition: color 0.15s, background 0.12s, border-color 0.15s;
	border-radius: 0 6px 6px 0;
}
.source-btn:hover { color: var(--text); background: var(--panel); }
.source-btn[data-active='true'] { color: var(--accent); border-left-color: var(--accent); background: var(--panel); }
.source-btn .n { font-size: 11px; color: var(--faint); }
.source-btn[data-active='true'] .n { color: var(--accent-dim); }

/* ---- rule list ---- */
.section { margin-bottom: 30px; animation: rise 0.5s cubic-bezier(0.2, 0.8, 0.2, 1) both; }
.section-head { display: flex; align-items: baseline; gap: 12px; padding: 0 2px 10px; border-bottom: 1px dashed var(--border-soft); margin-bottom: 4px; }
.section-title { font-family: var(--serif); font-size: 22px; font-style: italic; }
.section-files { font-size: 11px; color: var(--faint); }

.rule {
	display: grid;
	grid-template-columns: 1fr auto;
	gap: 14px;
	align-items: center;
	padding: 13px 14px;
	border: 1px solid transparent;
	border-radius: 10px;
	transition: background 0.14s, border-color 0.14s;
	position: relative;
}
.rule:hover { background: var(--panel); border-color: var(--border-soft); }
.rule-main { min-width: 0; }
.rule-name-row { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
.rule-name { font-size: 13.5px; color: var(--text); letter-spacing: -0.01em; }
.rule-name .pfx { color: var(--faint); }
.badge {
	font-size: 9.5px;
	text-transform: uppercase;
	letter-spacing: 0.08em;
	padding: 2px 6px;
	border-radius: 4px;
	border: 1px solid var(--border);
	color: var(--dim);
	background: var(--panel-2);
}
.badge.src { color: var(--accent-dim); border-color: rgba(205, 242, 91, 0.2); }
.badge.fix { color: #6cc6ff; border-color: rgba(108, 198, 255, 0.22); }
.badge.dep { color: var(--warn); border-color: rgba(240, 180, 41, 0.25); }
.rule-desc { font-size: 11.5px; color: var(--dim); margin-top: 4px; max-width: 64ch; line-height: 1.45; }
.rule-opts { font-size: 11px; color: var(--accent-dim); margin-top: 5px; background: var(--bg); border: 1px solid var(--border-soft); border-radius: 5px; padding: 3px 7px; display: inline-block; white-space: pre-wrap; word-break: break-word; }
.docs { color: var(--faint); text-decoration: none; transition: color 0.15s; font-size: 11px; }
.docs:hover { color: var(--accent); }

/* ---- severity segmented control ---- */
.seg { display: inline-flex; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 2px; gap: 2px; }
.seg button {
	font-family: var(--mono);
	font-size: 11px;
	letter-spacing: 0.02em;
	color: var(--faint);
	background: transparent;
	border: 0;
	padding: 5px 11px;
	border-radius: 6px;
	cursor: pointer;
	transition: color 0.13s, background 0.13s, box-shadow 0.13s;
}
.seg button:hover:not([data-on='true']) { color: var(--text); }
.seg button[data-sev='off'][data-on='true'] { background: rgba(86, 92, 100, 0.22); color: #c2c7cd; box-shadow: inset 0 0 0 1px rgba(130,136,143,0.4); }
.seg button[data-sev='warn'][data-on='true'] { background: rgba(240, 180, 41, 0.16); color: var(--warn); box-shadow: inset 0 0 0 1px rgba(240,180,41,0.45); }
.seg button[data-sev='error'][data-on='true'] { background: rgba(255, 93, 93, 0.15); color: var(--error); box-shadow: inset 0 0 0 1px rgba(255,93,93,0.45); }
.seg.busy { opacity: 0.45; pointer-events: none; }

.cat-control { display: flex; align-items: center; }
.effective { font-size: 10px; color: var(--faint); margin-right: 10px; letter-spacing: 0.04em; }
.effective b { color: var(--dim); }

/* ---- toast ---- */
.toast {
	position: fixed;
	bottom: 22px;
	left: 50%;
	transform: translateX(-50%);
	z-index: 50;
	font-family: var(--mono);
	font-size: 12px;
	padding: 11px 18px;
	border-radius: 10px;
	border: 1px solid var(--border);
	background: var(--panel-2);
	box-shadow: 0 18px 50px rgba(0, 0, 0, 0.55);
	animation: rise 0.3s ease both;
	display: flex;
	align-items: center;
	gap: 10px;
}
.toast b { font-size: 14px; }
.toast.ok b { color: var(--accent); }
.toast.err b { color: var(--error); }

.empty { padding: 60px 20px; text-align: center; color: var(--faint); font-size: 13px; }
.more { padding: 18px 4px; font-size: 11px; color: var(--faint); text-align: center; }

@keyframes rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }

@media (max-width: 820px) {
	.layout { grid-template-columns: 1fr; }
	.rail { position: static; flex-direction: row; flex-wrap: wrap; }
	.wordmark { font-size: 34px; }
}
`;
