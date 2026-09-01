import { existsSync } from 'node:fs';
import { relative, resolve as resolvePath } from 'node:path';

/* In dev, hydration-index entries must be served through the module server
 * (`/@src/…`) rather than a hashed generated bundle: only the module-server
 * index carries the HMR client's WebSocket bootstrap, and it re-transpiles on
 * every request so a reloaded page picks up fresh code. `generateManifest`
 * (used at build time and after every client rebuild) always emits the hashed
 * `…/indexes/Page.<hash>.js` path for `*Index` keys, so this transform must be
 * re-applied after each rebuild — otherwise the first full page load following
 * a rebuild (an app relaunch, a manual refresh) serves a bundle with no HMR
 * connection and the page silently loses hot reload. */

const resolveDevIndexFileName = (manifestValue: string, baseName: string) => {
	if (manifestValue.includes('/react/')) return `${baseName}.tsx`;
	if (manifestValue.includes('/svelte/')) return `${baseName}.svelte.js`;
	if (manifestValue.includes('/vue/')) return `${baseName}.vue.js`;

	return null;
};

export const patchDevIndexManifest = (
	manifest: Record<string, string>,
	devIndexDir: string,
	srcUrlPrefix: string
) => {
	for (const key of Object.keys(manifest)) {
		if (!key.endsWith('Index')) continue;
		const value = manifest[key];
		if (typeof value !== 'string') continue;
		if (!value.includes('/indexes/')) continue;
		// Already pointing at the module server (e.g. re-applied after a
		// rebuild that didn't touch this page) — nothing to do.
		if (value.startsWith(srcUrlPrefix)) continue;

		const baseName = key.replace(/Index$/u, '');
		const fileName = resolveDevIndexFileName(value, baseName);
		if (!fileName) continue;

		const srcPath = resolvePath(devIndexDir, fileName);
		if (!existsSync(srcPath)) continue;

		const rel = relative(process.cwd(), srcPath).replace(/\\/gu, '/');
		manifest[key] = `${srcUrlPrefix}${rel}`;
	}
};
