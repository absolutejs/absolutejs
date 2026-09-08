import {
	ABSOLUTE_MOBILE_UPDATE_MAX_TOTAL_BYTES,
	parseAbsoluteMobileUpdateManifest,
	type AbsoluteMobileUpdateFile,
	type AbsoluteMobileUpdateManifest
} from './updateProtocol';

export type AbsoluteMobileUpdateClientConfig = {
	appId: string;
	blockedReleaseIds?: readonly string[];
	channel: string;
	currentReleaseId: string;
	installationId: string;
	manifestUrl: string;
	runtimeFingerprint: string;
};

export type AbsoluteMobileUpdateStore = {
	abort(releaseId: string): Promise<void>;
	activate(releaseId: string): Promise<void>;
	begin(manifest: AbsoluteMobileUpdateManifest): Promise<void>;
	commit(manifest: AbsoluteMobileUpdateManifest): Promise<void>;
	/** Append a response chunk to persistent staging at the expected offset. */
	appendPartial?(
		file: AbsoluteMobileUpdateFile,
		contents: Uint8Array,
		offset: number
	): Promise<void>;
	/** Return an unverified, incomplete download from persistent staging. */
	readPartial?(file: AbsoluteMobileUpdateFile): Promise<Uint8Array | null>;
	/** Return a locally cached candidate for this exact path, when available. */
	readReusable?(file: AbsoluteMobileUpdateFile): Promise<Uint8Array | null>;
	/** Return an unverified completed file from a prior staging attempt. */
	readStaged?(file: AbsoluteMobileUpdateFile): Promise<Uint8Array | null>;
	/** End this attempt without deleting persistent staging. */
	suspend?(releaseId: string): Promise<void>;
	write(file: AbsoluteMobileUpdateFile, contents: Uint8Array): Promise<void>;
};

export type AbsoluteMobileUpdateVerifier = {
	digest(contents: Uint8Array): Promise<string>;
	verify(manifest: AbsoluteMobileUpdateManifest): Promise<boolean>;
};

export type AbsoluteMobileUpdateClientOptions = {
	config: AbsoluteMobileUpdateClientConfig;
	/** Maximum parallel asset requests. Network conditions may reduce this. */
	concurrency?: number;
	fetch?: typeof globalThis.fetch;
	onProgress?: (progress: AbsoluteMobileUpdateProgress) => void;
	store: AbsoluteMobileUpdateStore;
	verifier: AbsoluteMobileUpdateVerifier;
};

export type AbsoluteMobileUpdateCheckResult =
	| { kind: 'current' }
	| {
			kind: 'downloaded';
			manifest: AbsoluteMobileUpdateManifest;
			transfer: AbsoluteMobileUpdateTransfer;
	  }
	| { kind: 'quarantined'; releaseId: string }
	| { kind: 'update-available'; manifest: AbsoluteMobileUpdateManifest };

export type AbsoluteMobileUpdateTransfer = {
	avoidedBytes: number;
	completedFiles: number;
	downloadedBytes: number;
	downloadedFiles: number;
	durationMs: number;
	resumedBytes: number;
	resumedFiles: number;
	reusedBytes: number;
	reusedFiles: number;
	throughputBytesPerSecond: number;
	totalBytes: number;
	totalFiles: number;
};

export type AbsoluteMobileUpdateProgress = AbsoluteMobileUpdateTransfer & {
	kind: 'download-progress';
};

const exactManifestUrl = (value: string) => {
	const url = new URL(value);
	if (
		url.protocol !== 'https:' &&
		url.hostname !== 'localhost' &&
		url.hostname !== '127.0.0.1'
	)
		throw new TypeError(
			'Mobile update manifests require HTTPS outside loopback development.'
		);
	if (url.username || url.password || url.hash)
		throw new TypeError(
			'Mobile update manifest URLs cannot contain credentials or fragments.'
		);

	return url;
};

const fileUrl = (manifestUrl: URL, releaseId: string, path: string) => {
	const encodedPath = path.split('/').map(encodeURIComponent).join('/');
	const base = new URL(
		`./${encodeURIComponent(releaseId)}/files/`,
		manifestUrl
	);
	const result = new URL(encodedPath, base);
	if (
		result.origin !== manifestUrl.origin ||
		!result.pathname.startsWith(base.pathname)
	)
		throw new TypeError(
			'Mobile update asset escaped its signed release origin.'
		);

	return result;
};

type ReadChunksResult = { chunks: Uint8Array[]; received: number };

const readChunks = async (
	reader: ReadableStreamDefaultReader<Uint8Array>,
	maximum: number,
	onChunk?: (chunk: Uint8Array, offset: number) => Promise<void>,
	chunks: Uint8Array[] = [],
	received = 0
): Promise<ReadChunksResult> => {
	const result = await reader.read();
	if (result.done) return { chunks, received };
	const total = received + result.value.byteLength;
	if (total > maximum)
		throw new TypeError('Mobile update response exceeds its signed size.');
	await onChunk?.(result.value, received);
	chunks.push(result.value);

	return readChunks(reader, maximum, onChunk, chunks, total);
};

const readBounded = async (
	response: Response,
	maximum: number,
	onChunk?: (chunk: Uint8Array, offset: number) => Promise<void>
) => {
	const declared = Number(response.headers.get('content-length'));
	if (Number.isFinite(declared) && declared > maximum)
		throw new TypeError('Mobile update response exceeds its signed size.');
	if (!response.body) return new Uint8Array();
	const reader = response.body.getReader();
	let result: ReadChunksResult;
	const chunks: Uint8Array[] = [];
	try {
		result = await readChunks(reader, maximum, onChunk, chunks);
	} catch (error) {
		await reader.cancel().catch(() => undefined);
		throw error;
	}
	const contents = new Uint8Array(result.received);
	let offset = 0;
	for (const chunk of chunks) {
		contents.set(chunk, offset);
		offset += chunk.byteLength;
	}

	return contents;
};

const requestHeaders = (config: AbsoluteMobileUpdateClientConfig) => ({
	'x-absolute-mobile-app': config.appId,
	'x-absolute-mobile-channel': config.channel,
	'x-absolute-mobile-installation': config.installationId,
	'x-absolute-mobile-release': config.currentReleaseId,
	'x-absolute-mobile-runtime': config.runtimeFingerprint
});

const requireCompatible = (
	manifest: AbsoluteMobileUpdateManifest,
	config: AbsoluteMobileUpdateClientConfig
) => {
	if (manifest.appId !== config.appId)
		throw new TypeError('Mobile update belongs to another app.');
	if (manifest.channel !== config.channel)
		throw new TypeError('Mobile update belongs to another channel.');
	if (manifest.runtimeFingerprint !== config.runtimeFingerprint)
		throw new TypeError(
			'Mobile update requires a different native runtime.'
		);
};

const networkConcurrency = (requested?: number) => {
	const bounded = Math.max(1, Math.min(6, Math.floor(requested ?? 3)));
	const navigatorValue = Reflect.get(globalThis, 'navigator');
	const connection =
		typeof navigatorValue === 'object' && navigatorValue !== null
			? Reflect.get(navigatorValue, 'connection')
			: undefined;
	if (typeof connection !== 'object' || connection === null) return bounded;
	if (Reflect.get(connection, 'saveData') === true) return 1;
	const effectiveType = Reflect.get(connection, 'effectiveType');
	if (effectiveType === 'slow-2g' || effectiveType === '2g') return 1;
	if (effectiveType === '3g') return Math.min(2, bounded);

	return bounded;
};

const combine = (prefix: Uint8Array, suffix: Uint8Array) => {
	const result = new Uint8Array(prefix.byteLength + suffix.byteLength);
	result.set(prefix);
	result.set(suffix, prefix.byteLength);

	return result;
};

const validContentRange = (
	value: string | null,
	start: number,
	total: number
) => value === `bytes ${start}-${total - 1}/${total}`;

const combineSignals = (signals: AbortSignal[]) => {
	const nativeAny = Reflect.get(AbortSignal, 'any');
	if (typeof nativeAny === 'function')
		return Reflect.apply(nativeAny, AbortSignal, [signals]);
	const controller = new AbortController();
	const abort = () => controller.abort();
	if (signals.some((signal) => signal.aborted)) abort();
	else
		signals.forEach((signal) =>
			signal.addEventListener('abort', abort, { once: true })
		);

	return controller.signal;
};

export const createAbsoluteMobileUpdateClient = (
	options: AbsoluteMobileUpdateClientOptions
) => {
	const manifestUrl = exactManifestUrl(options.config.manifestUrl);
	const request = options.fetch ?? globalThis.fetch;
	const downloadFiles = async (manifest: AbsoluteMobileUpdateManifest) => {
		const startedAt = performance.now();
		const transfer: AbsoluteMobileUpdateTransfer = {
			avoidedBytes: 0,
			completedFiles: 0,
			downloadedBytes: 0,
			downloadedFiles: 0,
			durationMs: 0,
			resumedBytes: 0,
			resumedFiles: 0,
			reusedBytes: 0,
			reusedFiles: 0,
			throughputBytesPerSecond: 0,
			totalBytes: manifest.files.reduce(
				(total, file) => total + file.bytes,
				0
			),
			totalFiles: manifest.files.length
		};
		const updateTiming = () => {
			transfer.durationMs = Math.max(0, performance.now() - startedAt);
			transfer.avoidedBytes =
				transfer.reusedBytes + transfer.resumedBytes;
			transfer.throughputBytesPerSecond =
				transfer.durationMs > 0
					? Math.round(
							(transfer.downloadedBytes * 1000) /
								transfer.durationMs
						)
					: transfer.downloadedBytes;
		};
		const progress = () => {
			updateTiming();
			try {
				options.onProgress?.({
					...transfer,
					kind: 'download-progress'
				});
			} catch {
				// Diagnostics must never influence update integrity or activation.
			}
		};
		const controller = new AbortController();
		let next = 0;
		let firstError: unknown;
		const downloadFile = async (file: AbsoluteMobileUpdateFile) => {
			const staged = await options.store.readStaged?.(file);
			if (
				staged?.byteLength === file.bytes &&
				(await options.verifier.digest(staged)) === file.sha256
			) {
				transfer.resumedBytes += staged.byteLength;
				transfer.resumedFiles += 1;
				transfer.completedFiles += 1;
				progress();

				return;
			}
			const reusable = await options.store.readReusable?.(file);
			if (
				reusable?.byteLength === file.bytes &&
				(await options.verifier.digest(reusable)) === file.sha256
			) {
				await options.store.write(file, reusable);
				transfer.reusedBytes += reusable.byteLength;
				transfer.reusedFiles += 1;
				transfer.completedFiles += 1;
				progress();

				return;
			}
			const candidate = await options.store.readPartial?.(file);
			if (
				candidate?.byteLength === file.bytes &&
				(await options.verifier.digest(candidate)) === file.sha256
			) {
				await options.store.write(file, candidate);
				transfer.resumedBytes += candidate.byteLength;
				transfer.resumedFiles += 1;
				transfer.completedFiles += 1;
				progress();

				return;
			}
			const partial =
				candidate &&
				candidate.byteLength > 0 &&
				candidate.byteLength < file.bytes
					? candidate
					: new Uint8Array();
			const headers = new Headers();
			if (partial.byteLength > 0) {
				headers.set('if-range', `"${file.sha256}"`);
				headers.set('range', `bytes=${partial.byteLength}-`);
			}
			const asset = await request(
				fileUrl(manifestUrl, manifest.releaseId, file.path),
				{
					cache: 'no-store',
					credentials: 'omit',
					headers,
					redirect: 'error',
					signal: combineSignals([
						controller.signal,
						AbortSignal.timeout(30_000)
					])
				}
			);
			if (!asset.ok)
				throw new TypeError(
					`Mobile update asset ${file.path} failed with HTTP ${asset.status}.`
				);
			const ranged = asset.status === 206;
			if (
				ranged &&
				(partial.byteLength === 0 ||
					!validContentRange(
						asset.headers.get('content-range'),
						partial.byteLength,
						file.bytes
					))
			)
				throw new TypeError(
					`Mobile update asset ${file.path} returned an invalid byte range.`
				);
			const prefix = ranged ? partial : new Uint8Array();
			if (ranged) {
				transfer.resumedBytes += partial.byteLength;
				transfer.resumedFiles += 1;
			}
			const downloaded = await readBounded(
				asset,
				file.bytes - prefix.byteLength,
				options.store.appendPartial
					? async (chunk, offset) => {
							await options.store.appendPartial?.(
								file,
								chunk,
								prefix.byteLength + offset
							);
							transfer.downloadedBytes += chunk.byteLength;
							progress();
						}
					: undefined
			);
			if (!options.store.appendPartial) {
				transfer.downloadedBytes += downloaded.byteLength;
				progress();
			}
			if (
				transfer.downloadedBytes >
				ABSOLUTE_MOBILE_UPDATE_MAX_TOTAL_BYTES
			)
				throw new TypeError(
					'Mobile update exceeds the maximum transfer size.'
				);
			const contents = combine(prefix, downloaded);
			if (contents.byteLength !== file.bytes)
				throw new TypeError(
					`Mobile update asset ${file.path} has an invalid size.`
				);
			if ((await options.verifier.digest(contents)) !== file.sha256)
				throw new TypeError(
					`Mobile update asset ${file.path} failed integrity verification.`
				);
			await options.store.write(file, contents);
			transfer.downloadedFiles += 1;
			transfer.completedFiles += 1;
			progress();
		};
		const worker = async (): Promise<void> => {
			if (firstError) return;
			const index = next++;
			const file = manifest.files[index];
			if (!file) return;
			try {
				await downloadFile(file);
			} catch (error) {
				firstError ??= error;
				controller.abort();
			}

			await worker();
		};
		await Promise.all(
			Array.from(
				{
					length: Math.min(
						networkConcurrency(options.concurrency),
						manifest.files.length
					)
				},
				() => worker()
			)
		);
		if (firstError) throw firstError;
		updateTiming();

		return transfer;
	};

	const check = async (
		download = false
	): Promise<AbsoluteMobileUpdateCheckResult> => {
		const response = await request(manifestUrl, {
			cache: 'no-store',
			credentials: 'omit',
			headers: requestHeaders(options.config),
			redirect: 'error',
			signal: AbortSignal.timeout(15_000)
		});
		if (response.status === 204 || response.status === 304)
			return { kind: 'current' };
		if (!response.ok)
			throw new TypeError(
				`Mobile update check failed with HTTP ${response.status}.`
			);
		const manifestBytes = await readBounded(response, 1024 * 1024);
		let manifestValue: unknown;
		try {
			manifestValue = JSON.parse(new TextDecoder().decode(manifestBytes));
		} catch {
			throw new TypeError('Mobile update manifest is not valid JSON.');
		}
		const manifest = parseAbsoluteMobileUpdateManifest(manifestValue);
		requireCompatible(manifest, options.config);
		if (!(await options.verifier.verify(manifest)))
			throw new TypeError('Mobile update signature verification failed.');
		if (manifest.releaseId === options.config.currentReleaseId)
			return { kind: 'current' };
		if (options.config.blockedReleaseIds?.includes(manifest.releaseId))
			return { kind: 'quarantined', releaseId: manifest.releaseId };
		if (!download) return { kind: 'update-available', manifest };

		await options.store.begin(manifest);
		let transfer: AbsoluteMobileUpdateTransfer;
		try {
			transfer = await downloadFiles(manifest);
			await options.store.commit(manifest);
		} catch (error) {
			if (options.store.suspend)
				await options.store.suspend(manifest.releaseId);
			else await options.store.abort(manifest.releaseId);
			throw error;
		}

		return { kind: 'downloaded', manifest, transfer };
	};

	return {
		check,
		activate: (releaseId: string) => options.store.activate(releaseId),
		download: () => check(true)
	};
};
