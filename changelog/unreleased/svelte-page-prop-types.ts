import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: '`handleSveltePageRequest<typeof Page>({ props })` accepted any props in a server file. Svelte\'s ambient `*.svelte` module types every import as `LegacyComponentType`, whose props are `Record<string, any>`, and svelte-check only covers the Svelte directory. `absolute typecheck` now generates a declaration per component with svelte2tsx, the engine svelte-check uses, under `.absolutejs/types/svelte/`, and resolves server imports to them through `rootDirs`. A missing prop now fails with TS2741, a wrong type with TS2322 and an unknown prop with TS2353, as for React. `absolute dev` keeps the declarations current as components change. For editor squiggles, add `"rootDirs": [".", ".absolutejs/types/svelte"]` to tsconfig.json (typecheck prints this hint when it\'s missing). The check needs `svelte2tsx` installed (`bun add -d svelte2tsx`), and typecheck says so when it isn\'t. Unchanged projects reuse the last declarations. Vue pages were already checked by vue-tsc, and Angular\'s `requestContext` by its `Ctx` generic.',
	kind: 'fixed',
	summary: 'Svelte page props are type-checked in server files'
};
