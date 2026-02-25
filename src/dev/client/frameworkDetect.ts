/* Framework detection and manifest lookup utilities */

export const detectCurrentFramework = () => {
	if (window.__HMR_FRAMEWORK__) return window.__HMR_FRAMEWORK__;
	const path = window.location.pathname;
	if (path === '/vue' || path.startsWith('/vue/')) return 'vue';
	if (path === '/svelte' || path.startsWith('/svelte/')) return 'svelte';
	if (path === '/angular' || path.startsWith('/angular/')) return 'angular';
	if (path === '/htmx' || path.startsWith('/htmx/')) return 'htmx';
	if (path === '/html' || path.startsWith('/html/')) return 'html';
	if (path === '/') return 'html';
	if (path === '/react' || path.startsWith('/react/')) return 'react';
	if (window.__REACT_ROOT__) return 'react';
	return null;
};

export const getComponentNameFromPath = (filePath: string) => {
	if (!filePath) return null;
	const parts = filePath.replace(/\\/g, '/').split('/');
	const fileName = parts[parts.length - 1] || '';
	const baseName = fileName.replace(/\.(tsx?|jsx?|vue|svelte|html)$/, '');
	return baseName
		.split(/[-_]/)
		.map(function (word) {
			return word.charAt(0).toUpperCase() + word.slice(1);
		})
		.join('');
};

export const findIndexPath = (
	manifest: Record<string, string> | undefined,
	sourceFile: string | undefined,
	framework: string
) => {
	if (!manifest) return null;

	if (sourceFile) {
		const componentName = getComponentNameFromPath(sourceFile);
		if (componentName) {
			const indexKey = componentName + 'Index';
			if (manifest[indexKey]) return manifest[indexKey]!;
		}
	}

	const frameworkPatterns: Record<string, RegExp> = {
		angular: /angular/i,
		react: /react/i,
		svelte: /svelte/i,
		vue: /vue/i
	};
	const pattern = frameworkPatterns[framework];

	for (const key in manifest) {
		if (
			key.endsWith('Index') &&
			(!pattern ||
				pattern.test(key) ||
				manifest[key]!.includes('/' + framework + '/'))
		) {
			return manifest[key]!;
		}
	}

	return null;
};
