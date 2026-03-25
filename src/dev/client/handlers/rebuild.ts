/* Rebuild, manifest, module-update, and error handlers */

import { REBUILD_RELOAD_DELAY_MS } from '../constants';
import {
	hideErrorOverlay,
	isRuntimeErrorOverlay,
	showErrorOverlay
} from '../errorOverlay';

export const handleFullReload = () => {
	setTimeout(() => {
		window.location.reload();
	}, REBUILD_RELOAD_DELAY_MS);
};

export const handleManifest = (message: {
	data: {
		manifest?: Record<string, string>;
		serverVersions?: Record<string, number>;
	};
}) => {
	window.__HMR_MANIFEST__ = message.data.manifest;

	if (message.data.serverVersions) {
		window.__HMR_SERVER_VERSIONS__ = message.data.serverVersions;
	}

	if (!window.__HMR_MODULE_VERSIONS__) {
		window.__HMR_MODULE_VERSIONS__ = {};
	}

	window.__HMR_MODULE_UPDATES__ = [];
};

const HMR_FRAMEWORKS = ['angular', 'react', 'vue', 'svelte', 'html', 'htmx'];

const mergeRecord = (
	source: Record<string, string | number>,
	target: Record<string, string | number>
) => {
	Object.keys(source)
		.filter((key) => Object.prototype.hasOwnProperty.call(source, key))
		.forEach((key) => {
			const value = source[key];
			if (value !== undefined) {
				target[key] = value;
			}
		});
};

const mergeServerVersions = (
	serverVersions: Record<string, number> | undefined
) => {
	if (!serverVersions) return;
	const existing = window.__HMR_SERVER_VERSIONS__ ?? {};
	mergeRecord(serverVersions, existing);
	window.__HMR_SERVER_VERSIONS__ = existing;
};

const mergeModuleVersions = (
	moduleVersions: Record<string, number> | undefined
) => {
	if (!moduleVersions) return;
	const existing = window.__HMR_MODULE_VERSIONS__ ?? {};
	mergeRecord(moduleVersions, existing);
	window.__HMR_MODULE_VERSIONS__ = existing;
};

const mergeManifest = (manifest: Record<string, string> | undefined) => {
	if (!manifest) return;
	const existing = window.__HMR_MANIFEST__ ?? {};
	mergeRecord(manifest, existing);
	window.__HMR_MANIFEST__ = existing;
};

export const handleModuleUpdate = (message: {
	data: {
		framework?: string;
		manifest?: Record<string, string>;
		moduleVersions?: Record<string, number>;
		serverVersions?: Record<string, number>;
	};
}) => {
	const hasHMRHandler = HMR_FRAMEWORKS.includes(message.data.framework || '');

	if (!hasHMRHandler) {
		window.location.reload();

		return;
	}

	mergeServerVersions(message.data.serverVersions);
	mergeModuleVersions(message.data.moduleVersions);
	mergeManifest(message.data.manifest);

	if (!window.__HMR_MODULE_UPDATES__) {
		window.__HMR_MODULE_UPDATES__ = [];
	}
	window.__HMR_MODULE_UPDATES__.push(message.data);
};

export const handleRebuildComplete = (message: {
	data: {
		affectedFrameworks?: string[];
		fullReload?: boolean;
		manifest?: Record<string, string>;
	};
}) => {
	if (!isRuntimeErrorOverlay()) {
		hideErrorOverlay();
	}
	if (window.__HMR_MANIFEST__) {
		window.__HMR_MANIFEST__ = message.data.manifest;
	}

	// Subprocess builds need a full page reload to pick up fresh
	// bundled JS (the in-process Bun.build cache was stale).
	if (message.data.fullReload) {
		setTimeout(() => {
			window.location.reload();
		}, REBUILD_RELOAD_DELAY_MS);

		return;
	}

	if (
		message.data.affectedFrameworks &&
		!message.data.affectedFrameworks.includes('angular') &&
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
};

export const handleRebuildError = (message: {
	data: {
		affectedFrameworks?: string[];
		column?: number;
		error?: string;
		file?: string;
		framework?: string;
		line?: number;
		lineText?: string;
	};
}) => {
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
};
