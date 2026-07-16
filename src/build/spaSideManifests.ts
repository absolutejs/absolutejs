import { writeFile } from 'node:fs/promises';
import { basename, dirname, relative, resolve } from 'node:path';
import type { ParsedVueSpaRoute } from './parseVueSpaRoutes';

/** Write `<Page>.spa.json` next to each SPA page's SSR bundle — the child
 *  routes' compiled-CSS paths the Vue page handler inlines at request time
 *  (see `utils/spaRouteCss.ts`).
 *
 *  Shared by the initial build (`core/build.ts`) and the dev bundle rebuild
 *  (`dev/rebuildTrigger.ts`). The dev path used to skip this entirely: a
 *  rebuilt page's SSR bundle landed under a fresh hash with no side manifest
 *  beside it, so SSR either inlined the boot-time CSS (old bundle still
 *  live) or nothing at all, until the server restarted.
 *
 *  `resolveServerJsPath` maps a page's Pascal name to its CURRENT SSR
 *  bundle path — the initial build passes its artifact map, the dev rebuild
 *  passes a manifest lookup so children outside the rebuilt batch still
 *  resolve. Returns the manifest entries (`<Page>SpaManifest` → path). */
export const writeSpaSideManifests = async (
	spaRoutesBySource: Map<string, ParsedVueSpaRoute[]>,
	resolveServerJsPath: (pascalName: string) => string | undefined
) => {
	const manifestEntries: Record<string, string> = {};
	await Promise.all(
		[...spaRoutesBySource.entries()].map(async ([source, routes]) => {
			const parentName = basename(source, '.vue');
			const parentJsPath = resolveServerJsPath(parentName);
			if (!parentJsPath) return;
			const sourceDir = dirname(source);
			const entries = routes.flatMap(({ path, importPath }) => {
				const childSourcePath = resolve(sourceDir, importPath);
				const childName = basename(childSourcePath, '.vue');
				const childJsPath = resolveServerJsPath(childName);
				if (!childJsPath) return [];
				const absoluteCssPath = childJsPath.replace(/\.js$/, '.css');
				const cssPath = relative(
					dirname(parentJsPath),
					absoluteCssPath
				);

				return [{ cssPath, path }];
			});
			if (entries.length === 0) return;
			const sideManifestPath = parentJsPath.replace(
				/\.js$/,
				'.spa.json'
			);
			await writeFile(sideManifestPath, JSON.stringify(entries));
			manifestEntries[`${parentName}SpaManifest`] = sideManifestPath;
		})
	);

	return manifestEntries;
};
