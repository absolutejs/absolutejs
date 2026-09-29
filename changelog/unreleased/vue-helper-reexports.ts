import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "The Vue build copies every `.ts` helper a page reaches into its generated tree, but it found them with a regex that only matched `import … from`. A helper reached only through a re-export (`export { x } from './y'` or `export * from './y'`) was never copied, so the build failed with `Could not resolve: \"./y\"` and every page above it answered 500 in dev. Dependencies are now read with Bun's import scanner, which sees imports, dynamic imports and all three re-export forms; a regex that also covers re-exports is the fallback for source that does not parse.",
	kind: 'fixed',
	summary: 'Vue pages that reach a helper through a re-export build again'
};
