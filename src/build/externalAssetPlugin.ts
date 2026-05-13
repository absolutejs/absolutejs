import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import type { BunPlugin } from 'bun';

/* External-package asset plugin.
 *
 * Packages outside the user's framework dirs sometimes reference
 * adjacent static files via `new URL('./asset.txt', import.meta.url)`
 * — the standard pattern for shipping a WASM blob, a binary lookup
 * table, or a plain text resource alongside JS. Bun's bundler inlines
 * the JS but does not track these asset references, so the bundled
 * `import.meta.url` resolves to the bundled output's directory at
 * runtime — and the referenced file isn't there.
 *
 * `scanWorkerReferences` (in `core/build.ts`) already handles URL
 * refs from the user's source dirs (`reactDir`, `vueDir`, etc.). This
 * plugin covers the gap for everything else — packages in
 * `node_modules`, but also workspace-linked packages whose symlink
 * Bun follows so `onLoad` sees the original path under
 * `tests/fixtures/_packages/…` rather than `node_modules/…`.
 *
 * Strategy: scan every loaded JS/TS module for the pattern, but skip
 * paths under `userSourceRoots` (handled by `scanWorkerReferences`).
 * Copy referenced files into `outDir` using the file's basename. The
 * bundled JS reference becomes `<outDir>/<basename>` at runtime,
 * which now exists because we copied it. Same-name collisions across
 * packages are silently de-duplicated by basename (first writer wins)
 * — acceptable for the typical single-asset-per-package case;
 * cross-package collisions on common names (`worker.js`, `data.bin`)
 * would need a per-package subdir.
 */
export const createExternalAssetPlugin = (
	outDir: string,
	userSourceRoots: string[] = []
): BunPlugin => ({
	name: 'absolute-external-asset',
	setup(bld) {
		const urlPattern =
			/new\s+URL\(\s*["'](\.\.?\/[^"']+)["']\s*,\s*import\.meta\.url\s*\)/g;
		const skipRoots = userSourceRoots.map((root) => resolve(root));
		const isUserSource = (path: string) =>
			skipRoots.some((root) => path.startsWith(`${root}/`));
		bld.onLoad({ filter: /\.[mc]?[jt]sx?$/ }, async (args) => {
			if (isUserSource(args.path)) return undefined;

			const source = await Bun.file(args.path).text();
			if (!source.includes('import.meta.url')) return undefined;

			urlPattern.lastIndex = 0;
			let match;
			const sourceDir = dirname(args.path);
			while ((match = urlPattern.exec(source)) !== null) {
				const relPath = match[1];
				if (!relPath) continue;
				const assetPath = resolve(sourceDir, relPath);
				if (!existsSync(assetPath)) continue;
				if (!statSync(assetPath).isFile()) continue;

				const targetPath = join(outDir, basename(assetPath));
				if (existsSync(targetPath)) continue;

				mkdirSync(dirname(targetPath), { recursive: true });
				copyFileSync(assetPath, targetPath);
			}

			return undefined;
		});
	}
});
