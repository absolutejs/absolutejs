import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'Builds named `./tsconfig.json` to Bun.build whether or not the project had one. Bun ignored the option until 1.4.3; from 1.4.3 it reads it and fails with `Cannot find tsconfig file`, so on Bun 1.4.3+ a project without a tsconfig.json could not build, compile or start its dev client. The tsconfig is now named only when it exists; otherwise Bun finds the nearest one itself, as it did before.',
	kind: 'fixed',
	summary: 'Projects without a tsconfig.json build on Bun 1.4.3 and newer'
};
