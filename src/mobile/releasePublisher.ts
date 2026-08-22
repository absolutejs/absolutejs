import { access } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AbsoluteAndroidReleaseMetadata } from './androidRelease';

export type AbsoluteNativeReleasePublication = {
	channel?: {
		channel: string;
		releaseId: string;
	};
	record: {
		metadata: AbsoluteAndroidReleaseMetadata;
	};
	reused: boolean;
};

export type AbsoluteNativeReleasePublisher = {
	publish: (options: {
		allowUnsigned?: boolean;
		channel?: string;
		releaseRoot: string;
		signal?: AbortSignal;
	}) => Promise<AbsoluteNativeReleasePublication>;
};

export type PublishAbsoluteAndroidReleaseOptions = {
	allowUnsigned?: boolean;
	channel?: string;
	modulePath: string;
	projectRoot: string;
	release: {
		metadata: AbsoluteAndroidReleaseMetadata;
		releaseRoot: string;
	};
	signal?: AbortSignal;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const isPublisher = (value: unknown): value is AbsoluteNativeReleasePublisher =>
	isRecord(value) && typeof value.publish === 'function';

const publisherModulePath = (projectRoot: string, requested: string) => {
	const root = resolve(projectRoot);
	const path = resolve(root, requested);
	const projectRelative = relative(root, path);
	if (
		projectRelative === '..' ||
		projectRelative.startsWith(`..${sep}`) ||
		isAbsolute(projectRelative)
	) {
		throw new TypeError(
			'mobile publish --registry must remain inside the project.'
		);
	}

	return path;
};

export const loadAbsoluteNativeReleasePublisher = async (
	projectRoot: string,
	requestedModulePath: string
) => {
	const modulePath = publisherModulePath(projectRoot, requestedModulePath);
	await access(modulePath).catch(() => {
		throw new TypeError(
			`Native release registry module does not exist: ${modulePath}`
		);
	});
	const loaded: unknown = await import(pathToFileURL(modulePath).href);
	const publisher = isRecord(loaded)
		? (loaded.default ?? loaded.registry)
		: undefined;
	if (!isPublisher(publisher)) {
		throw new TypeError(
			'Native release registry module must default-export a registry with publish(options).'
		);
	}

	return publisher;
};

export const publishAbsoluteAndroidRelease = async (
	options: PublishAbsoluteAndroidReleaseOptions
) => {
	const publisher = await loadAbsoluteNativeReleasePublisher(
		options.projectRoot,
		options.modulePath
	);
	const publication = await publisher.publish({
		allowUnsigned: options.allowUnsigned,
		channel: options.channel,
		releaseRoot: options.release.releaseRoot,
		signal: options.signal
	});
	const expected = options.release.metadata;
	const actual = publication.record?.metadata;
	if (
		!actual ||
		actual.appId !== expected.appId ||
		actual.platform !== 'android' ||
		actual.releaseId !== expected.releaseId ||
		actual.sha256 !== expected.sha256 ||
		actual.signed !== expected.signed ||
		typeof publication.reused !== 'boolean'
	) {
		throw new TypeError(
			'Native release registry returned a different Android release identity.'
		);
	}
	if (
		options.channel !== undefined &&
		(publication.channel?.channel !== options.channel ||
			publication.channel.releaseId !== expected.releaseId)
	) {
		throw new TypeError(
			'Native release registry did not promote the requested channel.'
		);
	}

	return publication;
};
