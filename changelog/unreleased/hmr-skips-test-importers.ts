import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'Editing a module that a test file also imports (a helper used by a component and by its `*.test.tsx`) could make React HMR pick the test file as the component to re-import. The browser then fetched the test, failed on its `bun:test` import, and fell back to a full page reload. Test files (`*.test.*`, `*.spec.*`, `__tests__/`) are never chosen as an update target or climbed through on the way to one; edits to test files were already ignored.',
	kind: 'fixed',
	summary: 'Editing a module a test file imports no longer reloads the page'
};
