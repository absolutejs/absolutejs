// Controls specific to the tsconfig panel. Reuses the shared design tokens and
// shell/section/rule classes from ESLINT_CSS (injected first).
export const TSCONFIG_CSS = `
.ts-control { display: flex; align-items: center; gap: 8px; }

.ts-select {
	appearance: none;
	font-family: var(--mono);
	font-size: 12px;
	color: var(--text);
	background: var(--panel-2);
	border: 1px solid var(--border);
	border-radius: 7px;
	padding: 6px 28px 6px 10px;
	background-image: linear-gradient(45deg, transparent 50%, var(--dim) 50%),
		linear-gradient(135deg, var(--dim) 50%, transparent 50%);
	background-position: right 12px center, right 7px center;
	background-size: 5px 5px, 5px 5px;
	background-repeat: no-repeat;
	cursor: pointer;
}
.ts-select:hover { border-color: var(--accent-dim); }

.ts-input {
	font-family: var(--mono);
	font-size: 12px;
	color: var(--text);
	background: var(--panel-2);
	border: 1px solid var(--border);
	border-radius: 7px;
	padding: 6px 10px;
	min-width: 220px;
}
.ts-input:focus { outline: none; border-color: var(--accent); }
.ts-input.err { border-color: var(--error); }
.ts-input.wide { flex: 1; min-width: 320px; }

.ts-btn {
	font-family: var(--mono);
	font-size: 11px;
	color: var(--bg);
	background: var(--accent);
	border: none;
	border-radius: 7px;
	padding: 6px 12px;
	cursor: pointer;
}
.ts-btn:hover { background: var(--accent-dim); }

.ts-clear {
	font-family: var(--mono);
	font-size: 11px;
	color: var(--dim);
	background: transparent;
	border: 1px solid var(--border);
	border-radius: 7px;
	padding: 6px 10px;
	cursor: pointer;
}
.ts-clear:hover { color: var(--error); border-color: var(--error); }

.ts-current {
	font-family: var(--mono);
	font-size: 11px;
	color: var(--accent);
}
.ts-default { color: var(--faint); font-size: 11px; }
.ts-err { color: var(--error); font-size: 11px; margin-top: 6px; }
`;
