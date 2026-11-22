import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

/* Client modules: React code one app builds for another page to import.
 *
 *   // absolute.config.ts
 *   clientModules: { ProjectSettings: 'src/frontend/embeds/ProjectSettings.tsx' }
 *
 * The module is built in the React client pass, so it shares the app's
 * React and chunks (`/react/vendor/…`) and keeps its named exports, and its
 * URL is `asset(manifest, 'ProjectSettingsModule')`. Under the dev server
 * that URL is the module server's, so an edit is picked up like any page
 * code. What it is for: a part of this app rendered inside a page another
 * app serves, on the same origin, with this app's own React — no iframe,
 * no second document.
 *
 * Only named exports cross: the build reaches the module through a
 * one-line `export *` stub in the generated React directory (the pass
 * bundles from there, and the stub's file name gives the manifest key). */

export const CLIENT_MODULE_SUFFIX = 'Module';
const CLIENT_MODULE_NAME = /^[A-Z][A-Za-z0-9]*$/;

export const clientModuleManifestKey = (name: string) =>
	`${name}${CLIENT_MODULE_SUFFIX}`;

export type ClientModuleEntry = { name: string; source: string };

/** The configured modules, resolved against the project root. A name that
 *  is not PascalCase, or a source that does not exist, is an error: the
 *  manifest key and the import both depend on them. */
export const resolveClientModules = (
	modules: Record<string, string> | undefined,
	projectRoot: string
) =>
	Object.entries(modules ?? {}).map(([name, path]) => {
		if (!CLIENT_MODULE_NAME.test(name))
			throw new Error(
				`clientModules: "${name}" must be PascalCase (it becomes the manifest key "${clientModuleManifestKey(name)}").`
			);
		const source = resolve(projectRoot, path);
		if (!existsSync(source))
			throw new Error(
				`clientModules: ${name} points at ${path}, which does not exist.`
			);

		return { name, source } satisfies ClientModuleEntry;
	});

const importSpecifier = (fromDir: string, target: string) => {
	const path = relative(fromDir, target).replace(/\\/g, '/');

	return path.startsWith('.') ? path : `./${path}`;
};

/** Writes each module's stub into `stubDir` (only when its text changed, so
 *  a rebuild does not look like an edit) and returns the stub paths, which
 *  are the pass's entry points. */
export const writeClientModuleStubs = (
	entries: ClientModuleEntry[],
	stubDir: string
) => {
	mkdirSync(stubDir, { recursive: true });

	return entries.map(({ name, source }) => {
		const stub = join(stubDir, `${clientModuleManifestKey(name)}.ts`);
		const text = `export * from ${JSON.stringify(importSpecifier(dirname(stub), source))};\n`;
		const current = existsSync(stub) ? readFileSync(stub, 'utf-8') : null;
		if (current !== text) writeFileSync(stub, text);

		return stub;
	});
};
