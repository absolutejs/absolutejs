import { Directory, Filesystem } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import { registerPlugin } from '@capacitor/core';
import {
	createAbsoluteMobileUpdateClient,
	reportAbsoluteMobileUpdateHealth,
	type AbsoluteMobileUpdateClientConfig,
	type AbsoluteMobileUpdateHealthEvidence,
	type AbsoluteMobileUpdateStore,
	type AbsoluteMobileUpdateVerifier
} from './updateClient';
import {
	absoluteMobileUpdateSigningPayload,
	parseAbsoluteMobileUpdateManifest,
	unsignedAbsoluteMobileUpdate,
	type AbsoluteMobileUpdateFile,
	type AbsoluteMobileUpdateManifest
} from './updateProtocol';
import type { AbsoluteMobileClientManifest } from './transport';

const STATE_KEY = 'absolute.mobile.update.state.v1';
const STAGING_KEY = 'absolute.mobile.update.staging.v1';
const INSTALLATION_KEY = 'absolute.mobile.update.installation.v1';
const RESULT_KEY = Symbol.for('absolutejs.mobile.update.result');
const RESULTS_KEY = Symbol.for('absolutejs.mobile.update.results');
const ROOT = 'NoCloud/ionic_built_snapshots';
const STAGING_ROOT = 'NoCloud/absolute_update_staging';

type UpdateState = {
	activeHealthToken?: string;
	activeRelease?: string;
	pendingHealthToken?: string;
	pendingRelease?: string;
	pendingStartedAt?: number;
	previousPath?: string;
	quarantinedReleases?: string[];
	readyHealthToken?: string;
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
			...(text('activeHealthToken')
				? { activeHealthToken: text('activeHealthToken') }
				: {}),
			...(text('activeRelease')
				? { activeRelease: text('activeRelease') }
				: {}),
			...(text('pendingRelease')
				? { pendingRelease: text('pendingRelease') }
				: {}),
			...(text('pendingHealthToken')
				? { pendingHealthToken: text('pendingHealthToken') }
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
			...(text('readyHealthToken')
				? { readyHealthToken: text('readyHealthToken') }
				: {}),
			...(validRecovery ? { recovery: validRecovery } : {})
		};
	} catch {
		return {};
	}
};

const writeState = (state: UpdateState) =>
	Preferences.set({ key: STATE_KEY, value: JSON.stringify(state) });

const clearStagingRoot = () =>
	Filesystem.rmdir({
		directory: Directory.Library,
		path: STAGING_ROOT,
		recursive: true
	}).catch(() => undefined);

const readStaging = async () => {
	const { value } = await Preferences.get({ key: STAGING_KEY });
	if (!value) return undefined;
	try {
		return parseAbsoluteMobileUpdateManifest(JSON.parse(value));
	} catch {
		await Preferences.remove({ key: STAGING_KEY });
		await clearStagingRoot();

		return undefined;
	}
};

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

const partialPath = (releaseId: string, file: AbsoluteMobileUpdateFile) =>
	`${STAGING_ROOT}/${releaseId}/${file.path}.part`;

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

const removeStaging = async (releaseId: string) => {
	await Filesystem.rmdir({
		directory: Directory.Library,
		path: `${STAGING_ROOT}/${releaseId}`,
		recursive: true
	}).catch(() => undefined);
};

const isExistingDirectoryError = (error: unknown) =>
	typeof error === 'object' &&
	error !== null &&
	Reflect.get(error, 'code') === 'OS-PLUG-FILE-0010';

const ensureDirectory = async (path: string) => {
	try {
		await Filesystem.mkdir({
			directory: Directory.Library,
			path,
			recursive: true
		});
	} catch (error) {
		if (!isExistingDirectoryError(error)) throw error;
	}
};

const parentDirectories = (manifest: AbsoluteMobileUpdateManifest) => {
	const directories = manifest.files.flatMap((file) => {
		const segments = file.path.split('/').slice(0, -1);

		return segments.map((_, index) =>
			segments.slice(0, index + 1).join('/')
		);
	});

	return [...new Set(directories)];
};

const ensureDirectoryPairs = async (
	directories: string[],
	release: string,
	partial: string,
	index = 0
): Promise<void> => {
	const directory = directories[index];
	if (!directory) return;
	await ensureDirectory(`${release}/${directory}`);
	await ensureDirectory(`${partial}/${directory}`);
	await ensureDirectoryPairs(directories, release, partial, index + 1);
};

const ensureTransactionDirectories = async (
	manifest: AbsoluteMobileUpdateManifest
) => {
	const release = releasePath(manifest.releaseId);
	const partial = `${STAGING_ROOT}/${manifest.releaseId}`;
	await ensureDirectory(release);
	await ensureDirectory(partial);
	await ensureDirectoryPairs(parentDirectories(manifest), release, partial);
};

const filesystemBytes = async (data: string | Blob) =>
	typeof data === 'string'
		? base64Bytes(data)
		: new Uint8Array(await data.arrayBuffer());

const createStore = (): AbsoluteMobileUpdateStore => {
	let reusableRelease: string | undefined;
	let staging: AbsoluteMobileUpdateManifest | undefined;
	let resuming = false;

	return {
		abort: async (releaseId) => {
			staging = undefined;
			resuming = false;
			await removeRelease(releaseId);
			await removeStaging(releaseId);
			const persisted = await readStaging();
			if (persisted?.releaseId === releaseId)
				await Preferences.remove({ key: STAGING_KEY });
			const state = await readState();
			if (
				state.readyRelease === releaseId ||
				state.pendingRelease === releaseId
			)
				await writeState({
					activeHealthToken: state.activeHealthToken,
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
				activeHealthToken: state.activeHealthToken,
				activeRelease: state.activeRelease,
				pendingHealthToken: state.readyHealthToken,
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
					activeHealthToken: state.activeHealthToken,
					activeRelease: state.activeRelease,
					quarantinedReleases: state.quarantinedReleases
				});
				throw error;
			}
		},
		appendPartial: async (file, contents, offset) => {
			if (
				!staging ||
				!staging.files.some((candidate) => candidate.path === file.path)
			)
				throw new TypeError(
					'Mobile update partial write is outside its staging transaction.'
				);
			const path = partialPath(staging.releaseId, file);
			if (offset === 0) {
				await Filesystem.writeFile({
					data: bytesBase64(contents),
					directory: Directory.Library,
					path,
					recursive: true
				});

				return;
			}
			const stat = await Filesystem.stat({
				directory: Directory.Library,
				path
			});
			if (stat.size !== offset)
				throw new TypeError(
					'Mobile update partial checkpoint changed unexpectedly.'
				);
			await Filesystem.appendFile({
				data: bytesBase64(contents),
				directory: Directory.Library,
				path
			});
		},
		begin: async (manifest) => {
			reusableRelease = (await readState()).activeRelease;
			const persisted = await readStaging();
			const resume =
				persisted?.releaseId === manifest.releaseId &&
				persisted.signature.keyId === manifest.signature.keyId &&
				persisted.signature.value === manifest.signature.value;
			if (persisted && !resume)
				await Promise.all([
					removeRelease(persisted.releaseId),
					removeStaging(persisted.releaseId)
				]);
			if (!resume) {
				await removeRelease(manifest.releaseId);
				await removeStaging(manifest.releaseId);
			}
			await ensureTransactionDirectories(manifest);
			await Preferences.set({
				key: STAGING_KEY,
				value: JSON.stringify(manifest)
			});
			staging = manifest;
			resuming = resume;
		},
		commit: async (manifest) => {
			if (staging?.releaseId !== manifest.releaseId)
				throw new TypeError(
					'Mobile update staging transaction changed identity.'
				);
			const state = await readState();
			await writeState({
				activeHealthToken: state.activeHealthToken,
				activeRelease: state.activeRelease,
				quarantinedReleases: state.quarantinedReleases,
				readyRelease: manifest.releaseId
			});
			await removeStaging(manifest.releaseId);
			await Preferences.remove({ key: STAGING_KEY });
			staging = undefined;
			resuming = false;
		},
		readPartial: async (file) => {
			if (!staging || !resuming) return null;
			const result = await Filesystem.readFile({
				directory: Directory.Library,
				path: partialPath(staging.releaseId, file)
			}).catch(() => null);

			return result
				? filesystemBytes(result.data).catch(() => null)
				: null;
		},
		readReusable: async (file) => {
			if (!reusableRelease) return null;
			const result = await Filesystem.readFile({
				directory: Directory.Library,
				path: `${releasePath(reusableRelease)}/${file.path}`
			}).catch(() => null);

			return result
				? filesystemBytes(result.data).catch(() => null)
				: null;
		},
		readStaged: async (file) => {
			if (!staging || !resuming) return null;
			const result = await Filesystem.readFile({
				directory: Directory.Library,
				path: `${releasePath(staging.releaseId)}/${file.path}`
			}).catch(() => null);

			return result
				? filesystemBytes(result.data).catch(() => null)
				: null;
		},
		suspend: async (releaseId) => {
			if (staging?.releaseId === releaseId) {
				staging = undefined;
				resuming = false;
			}
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

const emitUpdateResult = (detail: Record<string, unknown>) => {
	Reflect.set(globalThis, RESULT_KEY, detail);
	const existing = Reflect.get(globalThis, RESULTS_KEY);
	const results = Array.isArray(existing) ? existing : [];
	results.push(detail);
	if (results.length > 8) results.splice(0, results.length - 8);
	Reflect.set(globalThis, RESULTS_KEY, results);
	dispatchEvent(new CustomEvent('absolute:mobile-update', { detail }));
};

const removePriorRelease = async (prior?: string, active?: string) => {
	if (prior && prior !== active) await removeRelease(prior);
};

type UpdateHealthReporter = (
	evidence: AbsoluteMobileUpdateHealthEvidence
) => Promise<void>;

const reconcilePendingRelease = async (
	store: AbsoluteMobileUpdateStore,
	state: UpdateState,
	report: UpdateHealthReporter
) => {
	if (!state.pendingRelease) return state;
	const pendingPath = await releaseNativePath(state.pendingRelease);
	const currentPath = await currentServerBasePath();
	if (currentPath !== pendingPath) {
		const failed = state.pendingRelease;
		if (state.pendingHealthToken)
			void report({
				healthToken: state.pendingHealthToken,
				kind: 'rolled-back',
				releaseId: failed
			});
		await store.abort(failed);
		emitUpdateResult({ kind: 'rolled-back', releaseId: failed });

		return readState();
	}
	webView().persistServerBasePath();
	const next: UpdateState = {
		activeHealthToken: state.pendingHealthToken,
		activeRelease: state.pendingRelease
	};
	await writeState(next);
	await watchdog.confirm({ releaseId: state.pendingRelease });
	if (state.pendingHealthToken)
		void report({
			healthToken: state.pendingHealthToken,
			kind: 'activated',
			releaseId: state.pendingRelease
		});
	await removePriorRelease(state.activeRelease, next.activeRelease);
	emitUpdateResult({ kind: 'activated', releaseId: next.activeRelease });

	return next;
};

const consumeNativeRecovery = async (
	state: UpdateState,
	report: UpdateHealthReporter
) => {
	if (!state.recovery) return state;
	const {
		pendingHealthToken,
		readyHealthToken: _readyHealthToken,
		recovery,
		...next
	} = state;
	if (pendingHealthToken)
		void report({
			healthToken: pendingHealthToken,
			kind: 'rolled-back',
			reason: recovery.reason,
			releaseId: recovery.releaseId
		});
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
	const { updates } = manifest;
	if (!updates) return;
	const store = createStore();
	const identity = await installationId();
	const clientConfig = (state: UpdateState) =>
		({
			appId: manifest.appId,
			blockedReleaseIds: state.quarantinedReleases ?? [],
			channel: updates.channel,
			currentReleaseId:
				state.activeRelease ?? `embedded:${manifest.appBuild}`,
			installationId: identity,
			manifestUrl: updates.manifestUrl,
			runtimeFingerprint: manifest.nativeRuntime
		}) satisfies AbsoluteMobileUpdateClientConfig;
	const reportFor =
		(state: UpdateState) =>
		async (evidence: AbsoluteMobileUpdateHealthEvidence) => {
			await reportAbsoluteMobileUpdateHealth(
				clientConfig(state),
				evidence
			).catch(() => undefined);
		};
	const initial = await readState();
	const recovered = await consumeNativeRecovery(initial, reportFor(initial));
	const state = await reconcilePendingRelease(
		store,
		recovered,
		reportFor(recovered)
	);
	const client = createAbsoluteMobileUpdateClient({
		concurrency: 6,
		config: clientConfig(state),
		store,
		verifier: createVerifier(updates.publicKeys),
		onProgress: (progress) => emitUpdateResult(progress)
	});
	const activateDownloaded = async (
		result: Awaited<ReturnType<typeof client.download>>
	) => {
		if (result.kind !== 'downloaded') return;
		if (result.healthToken) {
			const ready = await readState();
			if (ready.readyRelease === result.manifest.releaseId)
				await writeState({
					...ready,
					readyHealthToken: result.healthToken
				});
			void client
				.report({
					healthToken: result.healthToken,
					kind: 'downloaded',
					releaseId: result.manifest.releaseId,
					transfer: result.transfer
				})
				.catch(() => undefined);
		}
		emitUpdateResult({
			avoidedBytes: result.transfer.avoidedBytes,
			completedFiles: result.transfer.completedFiles,
			downloadedBytes: result.transfer.downloadedBytes,
			downloadedFiles: result.transfer.downloadedFiles,
			durationMs: Math.round(result.transfer.durationMs),
			kind: 'downloaded',
			releaseId: result.manifest.releaseId,
			resumedBytes: result.transfer.resumedBytes,
			resumedFiles: result.transfer.resumedFiles,
			reusedBytes: result.transfer.reusedBytes,
			reusedFiles: result.transfer.reusedFiles,
			throughputBytesPerSecond: result.transfer.throughputBytesPerSecond,
			totalBytes: result.transfer.totalBytes,
			totalFiles: result.transfer.totalFiles
		});
		await client.activate(result.manifest.releaseId);
	};
	void client
		.download()
		.then((result) => {
			if (result.kind === 'quarantined') {
				if (result.healthToken)
					void client
						.report({
							healthToken: result.healthToken,
							kind: 'quarantined',
							releaseId: result.releaseId
						})
						.catch(() => undefined);
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
