/* AbsoluteJS Error Overlay - branded, per-framework, modern styling */

import type { ErrorOverlayOptions } from '../../../types/client';
import { OVERLAY_FADE_DURATION_MS } from './constants';

let errorOverlayElement: HTMLDivElement | null = null;
let currentOverlayKind: 'compilation' | 'runtime' | null = null;
// Runtime errors accumulate so a second uncaught error in the same tick
// doesn't silently replace the first — the overlay shows nav buttons and
// a "N of M" badge so you can step through them.
const runtimeErrors: ErrorOverlayOptions[] = [];
let activeRuntimeIndex = 0;
let pendingCompilationOpts: ErrorOverlayOptions | null = null;
// Tracks which queue renderOverlay should pull from. Driven by
// showErrorOverlay BEFORE renderOverlay runs so the choice is unambiguous
// (currentOverlayKind reflects what's currently mounted, not what's queued).
let activeMode: 'runtime' | 'compilation' | null = null;

const frameworkLabels: Record<string, string> = {
	angular: 'Angular',
	assets: 'Assets',
	html: 'HTML',
	htmx: 'HTMX',
	react: 'React',
	svelte: 'Svelte',
	unknown: 'Unknown',
	vue: 'Vue'
};

const frameworkColors: Record<string, string> = {
	angular: '#dd0031',
	assets: '#563d7c',
	html: '#e34c26',
	htmx: '#1a365d',
	react: '#61dafb',
	svelte: '#ff3e00',
	unknown: '#94a3b8',
	vue: '#42b883'
};

const removeOverlayElement = () => {
	if (errorOverlayElement && errorOverlayElement.parentNode) {
		errorOverlayElement.parentNode.removeChild(errorOverlayElement);
	}
	errorOverlayElement = null;
	currentOverlayKind = null;
};

export const hideErrorOverlay = () => {
	const elm = errorOverlayElement;
	// Clearing on dismiss — if more errors arrive after this they get a
	// fresh overlay, otherwise stale entries accumulate forever.
	runtimeErrors.length = 0;
	activeRuntimeIndex = 0;
	pendingCompilationOpts = null;
	activeMode = null;
	if (!elm || !elm.parentNode) {
		removeOverlayElement();

		return;
	}
	elm.style.transition = 'opacity 150ms ease-out';
	elm.style.opacity = '0';
	errorOverlayElement = null;
	currentOverlayKind = null;
	setTimeout(() => {
		if (elm.parentNode) elm.parentNode.removeChild(elm);
	}, OVERLAY_FADE_DURATION_MS);
};

export const isRuntimeErrorOverlay = () => currentOverlayKind === 'runtime';

const sectionLabelStyle =
	'font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:#94a3b8;margin-bottom:8px;';
const codeBlockStyle =
	'margin:0;padding:14px 18px;background:rgba(15,23,42,0.8);border-radius:10px;border:1px solid rgba(71,85,105,0.4);color:#cbd5e1;font-size:12.5px;line-height:1.55;overflow-x:auto;white-space:pre;font-family:inherit;';

const buildLocationSection = (
	file: string | undefined,
	line: number | undefined,
	column: number | undefined,
	lineText: string | undefined
) => {
	if (!file && line === undefined && column === undefined && !lineText) {
		return null;
	}

	const locSection = document.createElement('div');
	locSection.style.cssText = 'margin-bottom:20px;';

	const locLabel = document.createElement('div');
	locLabel.style.cssText = sectionLabelStyle;
	locLabel.textContent = 'Where';
	locSection.appendChild(locLabel);

	const locParts: string[] = [];
	if (file) locParts.push(file);
	if (line !== undefined) locParts.push(String(line));
	if (column !== undefined) locParts.push(String(column));
	const loc = locParts.join(':') || 'Unknown location';

	const locEl = document.createElement('div');
	locEl.style.cssText =
		'padding:12px 18px;background:rgba(71,85,105,0.3);border-radius:10px;border:1px solid rgba(71,85,105,0.4);color:#cbd5e1;font-size:13px;word-break:break-all;';
	locEl.textContent = loc;
	locSection.appendChild(locEl);

	if (lineText) {
		const codeBlock = document.createElement('pre');
		codeBlock.style.cssText = `${codeBlockStyle}margin-top:8px;`;
		codeBlock.textContent = lineText;
		locSection.appendChild(codeBlock);
	}

	return locSection;
};

// Strip the leading `${ErrorName}: ${message}` line from a stack if it just
// repeats what's already shown in the "What went wrong" panel — keeps the
// stack panel focused on frames.
const cleanStack = (message: string, stack: string) => {
	const firstNewline = stack.indexOf('\n');
	if (firstNewline === -1) return stack;
	const head = stack.slice(0, firstNewline).trim();
	if (head === message || head.endsWith(`: ${message}`)) {
		return stack.slice(firstNewline + 1).replace(/^\n+/, '');
	}

	return stack;
};

const buildStackSection = (stack: string | undefined, message: string) => {
	if (!stack) return null;
	const cleaned = cleanStack(message, stack);
	if (!cleaned.trim()) return null;
	const section = document.createElement('div');
	section.style.cssText = 'margin-bottom:20px;';
	const label = document.createElement('div');
	label.style.cssText = sectionLabelStyle;
	label.textContent = 'Stack';
	section.appendChild(label);
	const pre = document.createElement('pre');
	pre.style.cssText = `${codeBlockStyle}max-height:300px;overflow-y:auto;`;
	pre.textContent = cleaned;
	section.appendChild(pre);

	return section;
};

// Reads the live document for every <script src> currently mounted.
// Most useful diagnostic for "I'm seeing a chunk hash that no longer
// exists on disk" — confirms which bundle the browser actually loaded.
const collectLoadedScripts = () => {
	const scripts = Array.from(document.querySelectorAll('script[src]'));
	const urls: string[] = [];
	for (const script of scripts) {
		const { src } = script as HTMLScriptElement;
		if (!src) continue;
		// Filter to JS we serve — vendor chunks, generated indexes, root
		// chunk-XXX.js outputs. Skip user-pasted CDN scripts and the like.
		if (
			src.includes('/vendor/') ||
			src.includes('/generated/') ||
			/\/chunk-[a-z0-9]+\.js(\?|$)/i.test(src) ||
			src.includes('/_src_indexes/')
		) {
			urls.push(src);
		}
	}

	return urls;
};

const buildDiagnosticsSection = () => {
	const section = document.createElement('div');
	section.style.cssText = 'margin-bottom:20px;';
	const label = document.createElement('div');
	label.style.cssText = sectionLabelStyle;
	label.textContent = 'Diagnostics';
	section.appendChild(label);

	const lines: string[] = [];
	lines.push(`Page URL: ${window.location.href}`);
	const ua = navigator.userAgent;
	lines.push(`User agent: ${ua}`);
	const scripts = collectLoadedScripts();
	if (scripts.length > 0) {
		lines.push('');
		lines.push(`Loaded chunks (${scripts.length}):`);
		for (const url of scripts) {
			// Strip origin so the chunk hash is the focal point.
			lines.push(`  ${url.replace(window.location.origin, '') || url}`);
		}
	}

	const pre = document.createElement('pre');
	pre.style.cssText = `${codeBlockStyle}max-height:200px;overflow-y:auto;`;
	pre.textContent = lines.join('\n');
	section.appendChild(pre);

	return section;
};

const buildErrorMessageSection = (message: string) => {
	const errorSection = document.createElement('div');
	errorSection.style.cssText = 'margin-bottom:20px;';
	const errorLabel = document.createElement('div');
	errorLabel.style.cssText = sectionLabelStyle;
	errorLabel.textContent = 'What went wrong';
	errorSection.appendChild(errorLabel);
	const msgEl = document.createElement('pre');
	msgEl.style.cssText =
		'margin:0;padding:16px 20px;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.25);border-radius:10px;overflow-x:auto;white-space:pre-wrap;word-break:break-word;color:#fca5a5;font-size:13px;line-height:1.5;font-family:inherit;';
	msgEl.textContent = message;
	errorSection.appendChild(msgEl);

	return errorSection;
};

const formatErrorForCopy = (opts: ErrorOverlayOptions) => {
	const lines: string[] = [];
	lines.push(
		`# ${opts.kind === 'runtime' ? 'Runtime' : 'Compilation'} error`
	);
	if (opts.framework) lines.push(`Framework: ${opts.framework}`);
	lines.push('');
	lines.push('## Message');
	lines.push(opts.message || '(no message)');
	if (opts.file || opts.line !== undefined) {
		lines.push('');
		lines.push('## Where');
		const locParts: string[] = [];
		if (opts.file) locParts.push(opts.file);
		if (opts.line !== undefined) locParts.push(String(opts.line));
		if (opts.column !== undefined) locParts.push(String(opts.column));
		lines.push(locParts.join(':'));
		if (opts.lineText) {
			lines.push('');
			lines.push(opts.lineText);
		}
	}
	if (opts.stack) {
		lines.push('');
		lines.push('## Stack');
		lines.push(cleanStack(opts.message || '', opts.stack));
	}
	lines.push('');
	lines.push('## Diagnostics');
	lines.push(`Page URL: ${window.location.href}`);
	lines.push(`User agent: ${navigator.userAgent}`);
	const scripts = collectLoadedScripts();
	if (scripts.length > 0) {
		lines.push('');
		lines.push(`Loaded chunks (${scripts.length}):`);
		for (const url of scripts) {
			lines.push(`  ${url.replace(window.location.origin, '') || url}`);
		}
	}

	return lines.join('\n');
};

const renderOverlay = () => {
	const opts =
		activeMode === 'runtime'
			? runtimeErrors[activeRuntimeIndex]
			: pendingCompilationOpts;
	if (!opts) return;
	const message = opts.message || 'Build failed';
	const { file, line, column, lineText, stack } = opts;
	const framework = (opts.framework || 'unknown').toLowerCase();
	const frameworkLabel = frameworkLabels[framework] || framework;
	const accent = frameworkColors[framework] || '#94a3b8';

	removeOverlayElement();
	currentOverlayKind = opts.kind || 'compilation';

	const overlay = document.createElement('div');
	overlay.id = 'absolutejs-error-overlay';
	overlay.setAttribute('data-hmr-overlay', 'true');
	overlay.style.cssText =
		'position:fixed;inset:0;z-index:2147483647;background:linear-gradient(135deg,rgba(15,23,42,0.98) 0%,rgba(30,41,59,0.98) 100%);backdrop-filter:blur(12px);color:#e2e8f0;font-family:"JetBrains Mono","Fira Code",ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:14px;line-height:1.6;overflow:auto;padding:32px;box-sizing:border-box;display:flex;align-items:flex-start;justify-content:center;';

	const card = document.createElement('div');
	card.style.cssText =
		'max-width:780px;width:100%;background:rgba(30,41,59,0.6);border:1px solid rgba(71,85,105,0.5);border-radius:16px;box-shadow:0 25px 50px -12px rgba(0,0,0,0.5),0 0 0 1px rgba(255,255,255,0.05);overflow:hidden;';

	const header = document.createElement('div');
	header.style.cssText =
		'display:flex;align-items:center;justify-content:space-between;gap:16px;padding:20px 24px;background:rgba(15,23,42,0.5);border-bottom:1px solid rgba(71,85,105,0.4);';
	header.innerHTML = `<div style="display:flex;align-items:center;gap:12px;"><span style="font-weight:700;font-size:20px;color:#fff;letter-spacing:-0.02em;">AbsoluteJS</span><span style="padding:5px 10px;border-radius:8px;font-size:12px;font-weight:600;background:${
		accent
	};color:#fff;opacity:0.95;box-shadow:0 2px 4px rgba(0,0,0,0.2);">${
		frameworkLabel
	}</span></div><span style="color:#94a3b8;font-size:13px;font-weight:500;">${
		opts.kind === 'runtime' ? 'Runtime Error' : 'Compilation Error'
	}</span>`;
	card.appendChild(header);

	const content = document.createElement('div');
	content.style.cssText = 'padding:24px;';

	// Multi-error nav: visible only when more than one runtime error has
	// fired since the last dismiss. Compilation errors always replace, so
	// they never need this row.
	if (activeMode === 'runtime' && runtimeErrors.length > 1) {
		const navRow = document.createElement('div');
		navRow.style.cssText =
			'display:flex;align-items:center;gap:12px;margin-bottom:20px;padding:10px 14px;background:rgba(71,85,105,0.25);border-radius:10px;border:1px solid rgba(71,85,105,0.4);';
		const prev = document.createElement('button');
		prev.textContent = '◀';
		prev.style.cssText =
			'padding:4px 10px;background:rgba(15,23,42,0.6);color:#cbd5e1;border:1px solid rgba(71,85,105,0.6);border-radius:6px;font-size:13px;cursor:pointer;font-family:inherit;';
		prev.disabled = activeRuntimeIndex === 0;
		if (prev.disabled) prev.style.opacity = '0.4';
		prev.onclick = () => {
			if (activeRuntimeIndex > 0) {
				activeRuntimeIndex -= 1;
				renderOverlay();
			}
		};
		const next = document.createElement('button');
		next.textContent = '▶';
		next.style.cssText = prev.style.cssText;
		next.disabled = activeRuntimeIndex >= runtimeErrors.length - 1;
		if (next.disabled) next.style.opacity = '0.4';
		next.onclick = () => {
			if (activeRuntimeIndex < runtimeErrors.length - 1) {
				activeRuntimeIndex += 1;
				renderOverlay();
			}
		};
		const counter = document.createElement('span');
		counter.style.cssText = 'color:#cbd5e1;font-size:13px;';
		counter.textContent = `Error ${activeRuntimeIndex + 1} of ${runtimeErrors.length}`;
		navRow.appendChild(prev);
		navRow.appendChild(next);
		navRow.appendChild(counter);
		content.appendChild(navRow);
	}

	content.appendChild(buildErrorMessageSection(message));
	const locSection = buildLocationSection(file, line, column, lineText);
	if (locSection) content.appendChild(locSection);
	const stackSection = buildStackSection(stack, message);
	if (stackSection) content.appendChild(stackSection);
	if (activeMode === 'runtime') {
		content.appendChild(buildDiagnosticsSection());
	}

	const footer = document.createElement('div');
	footer.style.cssText =
		'display:flex;justify-content:flex-end;gap:10px;padding-top:8px;';

	const copy = document.createElement('button');
	copy.textContent = 'Copy';
	copy.style.cssText =
		'padding:10px 16px;background:rgba(71,85,105,0.4);color:#e2e8f0;border:1px solid rgba(71,85,105,0.6);border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;transition:opacity 0.15s,transform 0.15s;';
	copy.onmouseover = () => {
		copy.style.opacity = '0.85';
	};
	copy.onmouseout = () => {
		copy.style.opacity = '1';
	};
	copy.onclick = async () => {
		const text = formatErrorForCopy(opts);
		try {
			await navigator.clipboard.writeText(text);
			copy.textContent = 'Copied';
			setTimeout(() => {
				copy.textContent = 'Copy';
			}, 1500);
		} catch {
			// Clipboard API requires a user gesture + permissions; fall back
			// to a textarea + execCommand so the button still does something.
			const ta = document.createElement('textarea');
			ta.value = text;
			ta.style.position = 'fixed';
			ta.style.opacity = '0';
			document.body.appendChild(ta);
			ta.select();
			try {
				document.execCommand('copy');
				copy.textContent = 'Copied';
				setTimeout(() => {
					copy.textContent = 'Copy';
				}, 1500);
			} catch {
				copy.textContent = 'Copy failed';
			}
			document.body.removeChild(ta);
		}
	};
	footer.appendChild(copy);

	const dismiss = document.createElement('button');
	dismiss.textContent = 'Dismiss';
	dismiss.style.cssText = `padding:10px 20px;background:${
		accent
	};color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;box-shadow:0 2px 8px rgba(0,0,0,0.2);transition:opacity 0.15s,transform 0.15s;`;
	dismiss.onmouseover = () => {
		dismiss.style.opacity = '0.9';
		dismiss.style.transform = 'translateY(-1px)';
	};
	dismiss.onmouseout = () => {
		dismiss.style.opacity = '1';
		dismiss.style.transform = 'translateY(0)';
	};
	dismiss.onclick = hideErrorOverlay;
	footer.appendChild(dismiss);
	content.appendChild(footer);
	card.appendChild(content);
	overlay.appendChild(card);
	if (!document.body) return;
	document.body.appendChild(overlay);
	errorOverlayElement = overlay;
};

export const showErrorOverlay = (opts: ErrorOverlayOptions) => {
	const kind = opts.kind || 'compilation';
	activeMode = kind;
	if (kind === 'runtime') {
		// Suppress duplicates — Angular and other frameworks often re-throw
		// the same error from multiple async boundaries (zone, scheduler,
		// resolver). Identifying by message+stack catches the common case
		// without needing structured equality.
		const sig = `${opts.message ?? ''}::${opts.stack ?? ''}`;
		const isDup = runtimeErrors.some(
			(prev) => `${prev.message ?? ''}::${prev.stack ?? ''}` === sig
		);
		if (!isDup) {
			runtimeErrors.push(opts);
			activeRuntimeIndex = runtimeErrors.length - 1;
		}
	} else {
		pendingCompilationOpts = opts;
		// Compilation errors are global build state — reset runtime queue
		// since old runtime errors from before the build attempt aren't
		// actionable anymore.
		runtimeErrors.length = 0;
		activeRuntimeIndex = 0;
	}
	renderOverlay();
};
