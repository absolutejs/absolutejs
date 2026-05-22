import type { ConfigPanelId, ConfigPanelMeta } from '../../../types/config';

/** The panels rendered in the sidebar, in display order. Adding a tool here +
 *  a route in `server.ts` + a branch in `ConfigShell` is all it takes to grow
 *  the unified config tool. */
export const CONFIG_PANELS: ConfigPanelMeta[] = [
	{
		blurb: 'Framework config (defineConfig)',
		id: 'absolute',
		label: 'absolute.config',
		status: 'ready'
	},
	{
		blurb: 'Scripts & metadata',
		id: 'package',
		label: 'package.json',
		status: 'ready'
	},
	{
		blurb: 'Lint rules & severities',
		id: 'eslint',
		label: 'ESLint',
		status: 'ready'
	},
	{
		blurb: 'TypeScript compiler options',
		id: 'tsconfig',
		label: 'tsconfig',
		status: 'ready'
	},
	{
		blurb: 'Formatting options',
		id: 'prettier',
		label: 'Prettier',
		status: 'ready'
	}
];

export const DEFAULT_PANEL: ConfigPanelId = 'absolute';

export const isConfigPanelId = (value: unknown): value is ConfigPanelId =>
	value === 'absolute' ||
	value === 'package' ||
	value === 'eslint' ||
	value === 'tsconfig' ||
	value === 'prettier';
