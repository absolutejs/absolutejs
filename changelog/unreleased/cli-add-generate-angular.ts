import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: '`absolute add <framework>` failed with "Could not find defineConfig" on the config create-absolutejs writes (`import { defineConfig } …` followed by `export default defineConfig({…})`). The config walker passed `pending.push(child)` straight to TypeScript\'s `forEachChild`, which stops at the first truthy callback result, so only a file\'s first statement (the import) was ever searched. The auth config readers behind `absolute config` had the same bug and are fixed too. `absolute generate page --framework angular` now writes a self-contained page with its nav baked in, like the static pages, instead of importing `../../shared/navData` from outside the Angular directory.',
	kind: 'fixed',
	summary:
		'`absolute add` edits scaffolded configs, and generated Angular pages no longer import shared files'
};
