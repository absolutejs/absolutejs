import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'Any changed file no HMR pipeline handled restarted the dev server, including documentation and test files the server never runs. Each restart dropped every open page for seconds and rebuilt them from nothing. Now documents (`.md`, `.txt`, …) and test files never restart it; code modules restart it only when the running server process has loaded them (a module nothing has imported yet loads fresh on first use); config such as `.env`, `package.json` and `tsconfig.json` still does.',
	kind: 'fixed',
	summary:
		'Editing docs, tests or code the server never loaded no longer restarts the dev server'
};
