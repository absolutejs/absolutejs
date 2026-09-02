import {
	ABSOLUTE_MOBILE_UPDATE_MAX_TOTAL_BYTES,
	parseAbsoluteMobileUpdateManifest,
	type AbsoluteMobileUpdateFile,
	type AbsoluteMobileUpdateManifest
} from './updateProtocol';

export type AbsoluteMobileUpdateClientConfig = {
	appId: string;
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
	write(file: AbsoluteMobileUpdateFile, contents: Uint8Array): Promise<void>;
};

export type AbsoluteMobileUpdateVerifier = {
	digest(contents: Uint8Array): Promise<string>;
	verify(manifest: AbsoluteMobileUpdateManifest): Promise<boolean>;
};

export type AbsoluteMobileUpdateClientOptions = {
	config: AbsoluteMobileUpdateClientConfig;
	fetch?: typeof globalThis.fetch;
	store: AbsoluteMobileUpdateStore;
	verifier: AbsoluteMobileUpdateVerifier;
};

export type AbsoluteMobileUpdateCheckResult =
	| { kind: 'current' }
	| { kind: 'downloaded'; manifest: AbsoluteMobileUpdateManifest }
	| { kind: 'update-available'; manifest: AbsoluteMobileUpdateManifest };

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
type ReadChunks = (
	reader: ReadableStreamDefaultReader<Uint8Array>,
	maximum: number,
	chunks?: Uint8Array[],
	received?: number
) => Promise<ReadChunksResult>;

const readChunks: ReadChunks = async (
	reader,
	maximum,
	chunks = [],
	received = 0
) => {
	const result = await reader.read();
	if (result.done) return { chunks, received };
	const total = received + result.value.byteLength;
	if (total > maximum)
		throw new TypeError('Mobile update response exceeds its signed size.');
	chunks.push(result.value);

	return readChunks(reader, maximum, chunks, total);
};

const readBounded = async (response: Response, maximum: number) => {
	const declared = Number(response.headers.get('content-length'));
	if (Number.isFinite(declared) && declared > maximum)
		throw new TypeError('Mobile update response exceeds its signed size.');
	if (!response.body) return new Uint8Array();
	const reader = response.body.getReader();
	let result: ReadChunksResult;
	try {
		result = await readChunks(reader, maximum);
	} catch (error) {
		await reader.cancel().catch(() => undefined);
		throw error;
	}
	const contents = new Uint8Array(result.received);
	let offset = 0;
	for (const chunk of result.chunks) {
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

export const createAbsoluteMobileUpdateClient = (
	options: AbsoluteMobileUpdateClientOptions
) => {
	const manifestUrl = exactManifestUrl(options.config.manifestUrl);
	const request = options.fetch ?? globalThis.fetch;
	type DownloadFiles = (
		manifest: AbsoluteMobileUpdateManifest,
		index?: number,
		received?: number
	) => Promise<number>;
	const downloadFiles: DownloadFiles = async (
		manifest,
		index = 0,
		received = 0
	) => {
		const file = manifest.files[index];
		if (!file) return received;
		const asset = await request(
			fileUrl(manifestUrl, manifest.releaseId, file.path),
			{
				cache: 'no-store',
				credentials: 'omit',
				redirect: 'error',
				signal: AbortSignal.timeout(30_000)
			}
		);
		if (!asset.ok)
			throw new TypeError(
				`Mobile update asset ${file.path} failed with HTTP ${asset.status}.`
			);
		const contents = await readBounded(asset, file.bytes);
		const total = received + contents.byteLength;
		if (
			contents.byteLength !== file.bytes ||
			total > ABSOLUTE_MOBILE_UPDATE_MAX_TOTAL_BYTES
		)
			throw new TypeError(
				`Mobile update asset ${file.path} has an invalid size.`
			);
		if ((await options.verifier.digest(contents)) !== file.sha256)
			throw new TypeError(
				`Mobile update asset ${file.path} failed integrity verification.`
			);
		await options.store.write(file, contents);

		return downloadFiles(manifest, index + 1, total);
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
		if (!download) return { kind: 'update-available', manifest };

		await options.store.begin(manifest);
		try {
			await downloadFiles(manifest);
			await options.store.commit(manifest);
		} catch (error) {
			await options.store.abort(manifest.releaseId);
			throw error;
		}

		return { kind: 'downloaded', manifest };
	};

	return {
		check,
		activate: (releaseId: string) => options.store.activate(releaseId),
		download: () => check(true)
	};
};
