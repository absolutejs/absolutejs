import { Capacitor, registerPlugin } from '@capacitor/core';

type AbsoluteReleaseReadinessPlugin = {
	ready(): Promise<{ ready: boolean }>;
};

const plugin = registerPlugin<AbsoluteReleaseReadinessPlugin>(
	'AbsoluteReleaseReadiness'
);

/** Notify the installed native host only after the embedded shell is ready. */
export const markAbsoluteMobileShellReady = async () => {
	if (Capacitor.getPlatform() === 'web') return;
	await plugin.ready();
};
