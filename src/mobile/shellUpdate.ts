import { Directory, Filesystem } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import { registerPlugin } from '@capacitor/core';
import {
	createAbsoluteMobileUpdateClient,
	type AbsoluteMobileUpdateStore,
	type AbsoluteMobileUpdateVerifier
} from './updateClient';
import {
	absoluteMobileUpdateSigningPayload,
	unsignedAbsoluteMobileUpdate,
	type AbsoluteMobileUpdateFile,
	type AbsoluteMobileUpdateManifest
} from './updateProtocol';
import type { AbsoluteMobileClientManifest } from './transport';

const STATE_KEY = 'absolute.mobile.update.state.v1';
const INSTALLATION_KEY = 'absolute.mobile.update.installation.v1';
const ROOT = 'NoCloud/ionic_built_snapshots';

type UpdateState = {
	activeRelease?: string;
	pendingRelease?: string;
	pendingStartedAt?: number;
	previousPath?: string;
	quarantinedReleases?: string[];
	readyRelease?: string;
	recovery?: {
		durationMs: number;
		reason: 'boot-interrupted' | 'boot-timeout';
		releaseId: string;
	};
};

type AbsoluteMobileUpdateWatchdogPlugin = {
	arm(options: { releaseId: string }): Promise<void>;
	confirm(options: { releaseId: string }): Promise<void>;
};

const watchdog = registerPlugin<AbsoluteMobileUpdateWatchdogPlugin>(
	'AbsoluteMobileUpdateWatchdog'
);

type IonicWebView = {
	getServerBasePath(callback: (path: string) => void): void;
	persistServerBasePath(): void;
	setServerBasePath(path: string): void;
};

const base64Bytes = (value: string) =>
	Uint8Array.from(atob(value), (character) => character.charCodeAt(0));

const arrayBuffer = (value: Uint8Array) => new Uint8Array(value).buffer;

const bytesBase64 = (value: Uint8Array) => {
	let result = '';
	const size = 0x8000;
	for (let offset = 0; offset < value.length; offset += size) {
		result += String.fromCharCode(...value.subarray(offset, offset + size));
	}

	return btoa(result);
};

const readState = async () => {
	const { value } = await Preferences.get({ key: STATE_KEY });
	if (!value) return {};
	try {
		const parsed: unknown = JSON.parse(value);
		if (typeof parsed !== 'object' || parsed === null) return {};
		const text = (key: keyof UpdateState) => {
			const candidate = Reflect.get(parsed, key);

			return typeof candidate === 'string' ? candidate : undefined;
		};
		const number = (key: keyof UpdateState) => {
			const candidate = Reflect.get(parsed, key);

			return typeof candidate === 'number' && Number.isFinite(candidate)
				? candidate
				: undefined;
		};
		const recoveryValue = Reflect.get(parsed, 'recovery');
		const quarantineValue = Reflect.get(parsed, 'quarantinedReleases');
		const quarantinedReleases = Array.isArray(quarantineValue)
			? [
					...new Set(
						quarantineValue.filter(
							(candidateRelease): candidateRelease is string =>
								typeof candidateRelease === 'string' &&
								/^amu_[a-f0-9]{64}$/u.test(candidateRelease)
						)
					)
				].slice(-8)
			: [];
		const recovery =
			typeof recoveryValue === 'object' && recoveryValue !== null
				? {
						durationMs: Reflect.get(recoveryValue, 'durationMs'),
						reason: Reflect.get(recoveryValue, 'reason'),
						releaseId: Reflect.get(recoveryValue, 'releaseId')
					}
				: undefined;
		let validRecovery: UpdateState['recovery'];
		if (
			recovery &&
			typeof recovery.durationMs === 'number' &&
			Number.isFinite(recovery.durationMs) &&
			recovery.durationMs >= 0 &&
			(recovery.reason === 'boot-interrupted' ||
				recovery.reason === 'boot-timeout') &&
			typeof recovery.releaseId === 'string'
		)
			validRecovery = {
				durationMs: recovery.durationMs,
				reason: recovery.reason,
				releaseId: recovery.releaseId
			};

		return {
			...(text('activeRelease')
				? { activeRelease: text('activeRelease') }
				: {}),
			...(text('pendingRelease')
				? { pendingRelease: text('pendingRelease') }
				: {}),
			...(number('pendingStartedAt') === undefined
				? {}
				: { pendingStartedAt: number('pendingStartedAt') }),
			...(text('previousPath')
				? { previousPath: text('previousPath') }
				: {}),
			...(quarantinedReleases.length > 0 ? { quarantinedReleases } : {}),
			...(text('readyRelease')
				? { readyRelease: text('readyRelease') }
				: {}),
			...(validRecovery ? { recovery: validRecovery } : {})
		};
	} catch {
		return {};
	}
};

const writeState = (state: UpdateState) =>
	Preferences.set({ key: STATE_KEY, value: JSON.stringify(state) });

const installationId = async () => {
	const existing = await Preferences.get({ key: INSTALLATION_KEY });
	if (existing.value && /^[a-f0-9-]{36}$/u.test(existing.value))
		return existing.value;
	const value = crypto.randomUUID();
	await Preferences.set({ key: INSTALLATION_KEY, value });

	return value;
};

const isIonicWebView = (value: unknown): value is IonicWebView =>
	typeof value === 'object' &&
	value !== null &&
	typeof Reflect.get(value, 'getServerBasePath') === 'function' &&
	typeof Reflect.get(value, 'setServerBasePath') === 'function' &&
	typeof Reflect.get(value, 'persistServerBasePath') === 'function';

const webView = () => {
	const ionic = Reflect.get(globalThis, 'Ionic');
	const provider =
		typeof ionic === 'object' && ionic !== null
			? Reflect.get(ionic, 'WebView')
			: undefined;
	if (!isIonicWebView(provider))
		throw new TypeError(
			'Capacitor WebView update controls are unavailable.'
		);

	return provider;
};

const currentServerBasePath = () =>
	new Promise<string>((resolve) => webView().getServerBasePath(resolve));

const releasePath = (releaseId: string) => `${ROOT}/${releaseId}`;

const releaseNativePath = async (releaseId: string) => {
	const { uri } = await Filesystem.getUri({
		directory: Directory.Library,
		path: releasePath(releaseId)
	});
	const url = new URL(uri);

	return decodeURIComponent(url.pathname);
};

const removeRelease = async (releaseId: string) => {
	await Filesystem.rmdir({
		directory: Directory.Library,
		path: releasePath(releaseId),
		recursive: true
	}).catch(() => undefined);
};

const createStore = (): AbsoluteMobileUpdateStore => {
	let staging: AbsoluteMobileUpdateManifest | undefined;

	return {
		abort: async (releaseId) => {
			staging = undefined;
			await removeRelease(releaseId);
			const state = await readState();
			if (
				state.readyRelease === releaseId ||
				state.pendingRelease === releaseId
			)
				await writeState({
					activeRelease: state.activeRelease,
					quarantinedReleases: state.quarantinedReleases,
					recovery: state.recovery
				});
		},
		activate: async (releaseId) => {
			const state = await readState();
			if (state.readyRelease !== releaseId)
				throw new TypeError(
					'Mobile update is not committed and ready to activate.'
				);
			const path = await releaseNativePath(releaseId);
			const previousPath = await currentServerBasePath();
			await writeState({
				activeRelease: state.activeRelease,
				pendingRelease: releaseId,
				pendingStartedAt: Date.now(),
				previousPath,
				quarantinedReleases: state.quarantinedReleases
			});
			try {
				await watchdog.arm({ releaseId });
				webView().setServerBasePath(path);
			} catch (error) {
				await watchdog.confirm({ releaseId }).catch(() => undefined);
				await removeRelease(releaseId);
				await writeState({
					activeRelease: state.activeRelease,
					quarantinedReleases: state.quarantinedReleases
				});
				throw error;
			}
		},
		begin: async (manifest) => {
			await removeRelease(manifest.releaseId);
			await Filesystem.mkdir({
				directory: Directory.Library,
				path: releasePath(manifest.releaseId),
				recursive: true
			});
			staging = manifest;
		},
		commit: async (manifest) => {
			if (staging?.releaseId !== manifest.releaseId)
				throw new TypeError(
					'Mobile update staging transaction changed identity.'
				);
			const state = await readState();
			await writeState({
				activeRelease: state.activeRelease,
				quarantinedReleases: state.quarantinedReleases,
				readyRelease: manifest.releaseId
			});
			staging = undefined;
		},
		write: async (file: AbsoluteMobileUpdateFile, contents: Uint8Array) => {
			if (
				!staging ||
				!staging.files.some((candidate) => candidate.path === file.path)
			)
				throw new TypeError(
					'Mobile update write is outside its staging transaction.'
				);
			await Filesystem.writeFile({
				data: bytesBase64(contents),
				directory: Directory.Library,
				path: `${releasePath(staging.releaseId)}/${file.path}`,
				recursive: true
			});
		}
	};
};

const createVerifier = (
	publicKeys: Record<string, string>
): AbsoluteMobileUpdateVerifier => ({
	digest: async (contents) => {
		const digest = new Uint8Array(
			await crypto.subtle.digest('SHA-256', arrayBuffer(contents))
		);

		return [...digest]
			.map((byte) => byte.toString(16).padStart(2, '0'))
			.join('');
	},
	verify: async (manifest) => {
		const encoded = publicKeys[manifest.signature.keyId];
		if (!encoded) return false;
		try {
			const key = await crypto.subtle.importKey(
				'spki',
				arrayBuffer(base64Bytes(encoded)),
				{ name: 'ECDSA', namedCurve: 'P-256' },
				false,
				['verify']
			);

			return crypto.subtle.verify(
				{ hash: 'SHA-256', name: 'ECDSA' },
				key,
				arrayBuffer(base64Bytes(manifest.signature.value)),
				arrayBuffer(
					absoluteMobileUpdateSigningPayload(
						unsignedAbsoluteMobileUpdate(manifest)
					)
				)
			);
		} catch {
			return false;
		}
	}
});

const emitUpdateResult = (detail: Record<string, unknown>) =>
	dispatchEvent(new CustomEvent('absolute:mobile-update', { detail }));

const removePriorRelease = async (prior?: string, active?: string) => {
	if (prior && prior !== active) await removeRelease(prior);
};

const reconcilePendingRelease = async (
	store: AbsoluteMobileUpdateStore,
	state: UpdateState
) => {
	if (!state.pendingRelease) return state;
	const pendingPath = await releaseNativePath(state.pendingRelease);
	const currentPath = await currentServerBasePath();
	if (currentPath !== pendingPath) {
		const failed = state.pendingRelease;
		await store.abort(failed);
		emitUpdateResult({ kind: 'rolled-back', releaseId: failed });

		return readState();
	}
	webView().persistServerBasePath();
	const next: UpdateState = { activeRelease: state.pendingRelease };
	await writeState(next);
	await watchdog.confirm({ releaseId: state.pendingRelease });
	await removePriorRelease(state.activeRelease, next.activeRelease);
	emitUpdateResult({ kind: 'activated', releaseId: next.activeRelease });

	return next;
};

const consumeNativeRecovery = async (state: UpdateState) => {
	if (!state.recovery) return state;
	const { recovery, ...next } = state;
	emitUpdateResult({
		durationMs: Math.round(recovery.durationMs),
		kind: 'rolled-back',
		reason: recovery.reason,
		releaseId: recovery.releaseId
	});
	await writeState(next);

	return next;
};

export const installAbsoluteMobileShellUpdates = async (
	manifest: AbsoluteMobileClientManifest
) => {
	if (!manifest.updates) return;
	const store = createStore();
	const recovered = await consumeNativeRecovery(await readState());
	const state = await reconcilePendingRelease(store, recovered);
	const client = createAbsoluteMobileUpdateClient({
		config: {
			appId: manifest.appId,
			blockedReleaseIds: state.quarantinedReleases ?? [],
			channel: manifest.updates.channel,
			currentReleaseId:
				state.activeRelease ?? `embedded:${manifest.appBuild}`,
			installationId: await installationId(),
			manifestUrl: manifest.updates.manifestUrl,
			runtimeFingerprint: manifest.nativeRuntime
		},
		store,
		verifier: createVerifier(manifest.updates.publicKeys)
	});
	const activateDownloaded = async (
		result: Awaited<ReturnType<typeof client.download>>
	) => {
		if (result.kind !== 'downloaded') return;
		emitUpdateResult({
			kind: 'downloaded',
			releaseId: result.manifest.releaseId
		});
		await client.activate(result.manifest.releaseId);
	};
	void client
		.download()
		.then((result) => {
			if (result.kind === 'quarantined') {
				emitUpdateResult({
					kind: 'quarantined',
					releaseId: result.releaseId
				});

				return undefined;
			}

			return activateDownloaded(result);
		})
		.catch((error) => {
			console.error('[Absolute Mobile] Update failed:', error);
			emitUpdateResult({ kind: 'failed' });
		});
};
