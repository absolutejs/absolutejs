/* Rebuild, manifest, module-update, and error handlers */

import { hideErrorOverlay, showErrorOverlay } from '../errorOverlay';

export function handleManifest(message: {
	data: {
		manifest?: Record<string, string>;
		serverVersions?: Record<string, number>;
	};
}): void {
	window.__HMR_MANIFEST__ =
		message.data.manifest ||
		(message.data as unknown as Record<string, string>);

	if (message.data.serverVersions) {
		window.__HMR_SERVER_VERSIONS__ = message.data.serverVersions;
	}

	if (!window.__HMR_MODULE_VERSIONS__) {
		window.__HMR_MODULE_VERSIONS__ = {};
	}

	window.__HMR_MODULE_UPDATES__ = [];
}

export function handleRebuildComplete(message: {
	data: {
		affectedFrameworks?: string[];
		manifest?: Record<string, string>;
	};
}): void {
	hideErrorOverlay();
	if (window.__HMR_MANIFEST__) {
		window.__HMR_MANIFEST__ = message.data.manifest;
	}

	if (
		message.data.affectedFrameworks &&
		!message.data.affectedFrameworks.includes('react') &&
		!message.data.affectedFrameworks.includes('html') &&
		!message.data.affectedFrameworks.includes('htmx') &&
		!message.data.affectedFrameworks.includes('vue') &&
		!message.data.affectedFrameworks.includes('svelte')
	) {
		const url = new URL(window.location.href);
		url.searchParams.set('_cb', Date.now().toString());
		window.location.href = url.toString();
	}
}

export function handleModuleUpdate(message: {
	data: {
		framework?: string;
		manifest?: Record<string, string>;
		moduleVersions?: Record<string, number>;
		serverVersions?: Record<string, number>;
	};
}): void {
	const hasHMRHandler =
		message.data.framework === 'react' ||
		message.data.framework === 'vue' ||
		message.data.framework === 'svelte' ||
		message.data.framework === 'html' ||
		message.data.framework === 'htmx';

	if (hasHMRHandler) {
		if (message.data.serverVersions) {
			const serverVersions = window.__HMR_SERVER_VERSIONS__ || {};
			for (const key in message.data.serverVersions) {
				if (
					Object.prototype.hasOwnProperty.call(
						message.data.serverVersions,
						key
					)
				) {
					serverVersions[key] = message.data.serverVersions[key]!;
				}
			}
			window.__HMR_SERVER_VERSIONS__ = serverVersions;
		}
		if (message.data.moduleVersions) {
			const moduleVersions = window.__HMR_MODULE_VERSIONS__ || {};
			for (const key in message.data.moduleVersions) {
				if (
					Object.prototype.hasOwnProperty.call(
						message.data.moduleVersions,
						key
					)
				) {
					moduleVersions[key] = message.data.moduleVersions[key]!;
				}
			}
			window.__HMR_MODULE_VERSIONS__ = moduleVersions;
		}
		if (message.data.manifest) {
			const manifest = window.__HMR_MANIFEST__ || {};
			for (const key in message.data.manifest) {
				if (
					Object.prototype.hasOwnProperty.call(
						message.data.manifest,
						key
					)
				) {
					manifest[key] = message.data.manifest[key]!;
				}
			}
			window.__HMR_MANIFEST__ = manifest;
		}
		if (!window.__HMR_MODULE_UPDATES__) {
			window.__HMR_MODULE_UPDATES__ = [];
		}
		window.__HMR_MODULE_UPDATES__.push(message.data);
		return;
	}

	window.location.reload();
}

export function handleRebuildError(message: {
	data: {
		affectedFrameworks?: string[];
		column?: number;
		error?: string;
		file?: string;
		framework?: string;
		line?: number;
		lineText?: string;
	};
}): void {
	const errData = message.data || {};
	showErrorOverlay({
		column: errData.column,
		file: errData.file,
		framework:
			errData.framework ||
			(errData.affectedFrameworks && errData.affectedFrameworks[0]),
		line: errData.line,
		lineText: errData.lineText,
		message: errData.error || 'Build failed'
	});
}

export function handleFullReload(): void {
	setTimeout(function () {
		window.location.reload();
	}, 200);
}
