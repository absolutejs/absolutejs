import {
	applyUpdate,
	checkForUpdate,
	onUpdateAvailable,
	type AppUpdate
} from '@absolutejs/pwa/client';

Reflect.set(globalThis, '__PWA_BUILD_FIXTURE_STARTED__', true);
const updates: AppUpdate[] = [];
onUpdateAvailable((update) => updates.push(update));
Reflect.set(globalThis, '__PWA_UPDATES__', updates);
Reflect.set(globalThis, '__PWA_CHECK_FOR_UPDATE__', checkForUpdate);
Reflect.set(globalThis, '__PWA_APPLY_UPDATE__', () =>
	applyUpdate({ activationTimeoutMs: 10_000 })
);
