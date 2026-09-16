import { Capacitor, registerPlugin } from '@capacitor/core';

type AbsoluteReleaseReadinessPlugin = {
	ready(): Promise<{ ready: boolean }>;
};

const plugin = registerPlugin<AbsoluteReleaseReadinessPlugin>(
	'AbsoluteReleaseReadiness'
);

/** Notify the generated Android host only after the embedded shell is ready. */
export const markAbsoluteMobileShellReady = async () => {
	if (Capacitor.getPlatform() !== 'android') return;
	await plugin.ready();
};
