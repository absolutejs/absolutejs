/* AbsoluteJS Error Overlay - branded, per-framework, modern styling */

import type { ErrorOverlayOptions } from './types';

let errorOverlayElement: HTMLDivElement | null = null;

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

export function hideErrorOverlay(): void {
	if (errorOverlayElement && errorOverlayElement.parentNode) {
		errorOverlayElement.parentNode.removeChild(errorOverlayElement);
		errorOverlayElement = null;
	}
}

export function showErrorOverlay(opts: ErrorOverlayOptions): void {
	const message = opts.message || 'Build failed';
	const file = opts.file;
	const line = opts.line;
	const column = opts.column;
	const lineText = opts.lineText;
	const framework = (opts.framework || 'unknown').toLowerCase();
	const frameworkLabel = frameworkLabels[framework] || framework;
	const accent = frameworkColors[framework] || '#94a3b8';

	hideErrorOverlay();

	const overlay = document.createElement('div');
	overlay.id = 'absolutejs-error-overlay';
	overlay.setAttribute('data-hmr-overlay', 'true');
	overlay.style.cssText =
		'position:fixed;inset:0;z-index:2147483647;background:linear-gradient(135deg,rgba(15,23,42,0.98) 0%,rgba(30,41,59,0.98) 100%);backdrop-filter:blur(12px);color:#e2e8f0;font-family:"JetBrains Mono","Fira Code",ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:14px;line-height:1.6;overflow:auto;padding:32px;box-sizing:border-box;display:flex;align-items:flex-start;justify-content:center;';

	const card = document.createElement('div');
	card.style.cssText =
		'max-width:720px;width:100%;background:rgba(30,41,59,0.6);border:1px solid rgba(71,85,105,0.5);border-radius:16px;box-shadow:0 25px 50px -12px rgba(0,0,0,0.5),0 0 0 1px rgba(255,255,255,0.05);overflow:hidden;';

	const header = document.createElement('div');
	header.style.cssText =
		'display:flex;align-items:center;justify-content:space-between;gap:16px;padding:20px 24px;background:rgba(15,23,42,0.5);border-bottom:1px solid rgba(71,85,105,0.4);';
	header.innerHTML =
		'<div style="display:flex;align-items:center;gap:12px;"><span style="font-weight:700;font-size:20px;color:#fff;letter-spacing:-0.02em;">AbsoluteJS</span><span style="padding:5px 10px;border-radius:8px;font-size:12px;font-weight:600;background:' +
		accent +
		';color:#fff;opacity:0.95;box-shadow:0 2px 4px rgba(0,0,0,0.2);">' +
		frameworkLabel +
		'</span></div><span style="color:#94a3b8;font-size:13px;font-weight:500;">Compilation Error</span>';
	card.appendChild(header);

	const content = document.createElement('div');
	content.style.cssText = 'padding:24px;';

	const errorSection = document.createElement('div');
	errorSection.style.cssText = 'margin-bottom:20px;';

	const errorLabel = document.createElement('div');
	errorLabel.style.cssText =
		'font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:#94a3b8;margin-bottom:8px;';
	errorLabel.textContent = 'What went wrong';
	errorSection.appendChild(errorLabel);

	const msgEl = document.createElement('pre');
	msgEl.style.cssText =
		'margin:0;padding:16px 20px;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.25);border-radius:10px;overflow-x:auto;white-space:pre-wrap;word-break:break-word;color:#fca5a5;font-size:13px;line-height:1.5;';
	msgEl.textContent = message;
	errorSection.appendChild(msgEl);
	content.appendChild(errorSection);

	if (file || line != null || column != null || lineText) {
		const locSection = document.createElement('div');
		locSection.style.cssText = 'margin-bottom:20px;';

		const locLabel = document.createElement('div');
		locLabel.style.cssText =
			'font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:#94a3b8;margin-bottom:8px;';
		locLabel.textContent = 'Where';
		locSection.appendChild(locLabel);

		const locParts: string[] = [];
		if (file) locParts.push(file);
		if (line != null) locParts.push(String(line));
		if (column != null) locParts.push(String(column));
		const loc = locParts.join(':') || 'Unknown location';

		const locEl = document.createElement('div');
		locEl.style.cssText =
			'padding:12px 20px;background:rgba(71,85,105,0.3);border-radius:10px;border:1px solid rgba(71,85,105,0.4);color:#cbd5e1;font-size:13px;';
		locEl.textContent = loc;
		locSection.appendChild(locEl);

		if (lineText) {
			const codeBlock = document.createElement('pre');
			codeBlock.style.cssText =
				'margin:8px 0 0;padding:14px 20px;background:rgba(15,23,42,0.8);border-radius:10px;border:1px solid rgba(71,85,105,0.4);color:#94a3b8;font-size:13px;overflow-x:auto;white-space:pre;';
			codeBlock.textContent = lineText;
			locSection.appendChild(codeBlock);
		}
		content.appendChild(locSection);
	}

	const footer = document.createElement('div');
	footer.style.cssText =
		'display:flex;justify-content:flex-end;padding-top:8px;';

	const dismiss = document.createElement('button');
	dismiss.textContent = 'Dismiss';
	dismiss.style.cssText =
		'padding:10px 20px;background:' +
		accent +
		';color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.2);transition:opacity 0.15s,transform 0.15s;';
	dismiss.onmouseover = function () {
		dismiss.style.opacity = '0.9';
		dismiss.style.transform = 'translateY(-1px)';
	};
	dismiss.onmouseout = function () {
		dismiss.style.opacity = '1';
		dismiss.style.transform = 'translateY(0)';
	};
	dismiss.onclick = hideErrorOverlay;
	footer.appendChild(dismiss);
	content.appendChild(footer);
	card.appendChild(content);
	overlay.appendChild(card);
	document.body.appendChild(overlay);
	errorOverlayElement = overlay;
}
