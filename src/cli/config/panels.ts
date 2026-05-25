import type { ConfigPanelId, ConfigPanelMeta } from '../../../types/config';

/** The panels rendered in the sidebar, in display order. Adding a tool here +
 *  a route in `server.ts` + a branch in `ConfigShell` is all it takes to grow
 *  the unified config tool. */
export const CONFIG_PANELS: ConfigPanelMeta[] = [
	{
		blurb: 'Framework config (defineConfig)',
		group: 'Project',
		id: 'absolute',
		label: 'absolute.config',
		status: 'ready'
	},
	{
		blurb: 'Scripts & metadata',
		group: 'Project',
		id: 'package',
		label: 'package.json',
		status: 'ready'
	},
	{
		blurb: 'Lint rules & severities',
		group: 'Project',
		id: 'eslint',
		label: 'ESLint',
		status: 'ready'
	},
	{
		blurb: 'TypeScript compiler options',
		group: 'Project',
		id: 'tsconfig',
		label: 'tsconfig',
		status: 'ready'
	},
	{
		blurb: 'Formatting options',
		group: 'Project',
		id: 'prettier',
		label: 'Prettier',
		status: 'ready'
	},
	{
		blurb: 'Official Elysia plugins',
		group: 'Integrations',
		id: 'integrations',
		label: 'Integrations',
		status: 'ready'
	},
	{
		blurb: '@absolutejs/auth setup',
		group: 'Integrations',
		id: 'auth',
		label: 'Auth',
		status: 'ready'
	}
];

export const DEFAULT_PANEL: ConfigPanelId = 'absolute';

export const isConfigPanelId = (value: unknown): value is ConfigPanelId =>
	value === 'absolute' ||
	value === 'integrations' ||
	value === 'auth' ||
	value === 'package' ||
	value === 'eslint' ||
	value === 'tsconfig' ||
	value === 'prettier';
