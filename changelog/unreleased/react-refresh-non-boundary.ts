import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "React Fast Refresh updates the components it registered. Editing a module that registers none (a class component, or a `memo`/`forwardRef` wrapper the transpiler does not register) re-ran only that module, and its importer kept rendering the old one, so the edit never showed until a reload. The update now also re-imports the module's importers up to the nearest one that registers a component, so the edit appears and the rest of the page keeps its state.",
	kind: 'fixed',
	summary:
		'Edits to class components and `memo`/`forwardRef` wrappers appear in `absolute dev` without a reload'
};
