import { access } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readAbsoluteMobileUpdate } from './updateSigning';

export type AbsoluteMobileUpdatePublication = {
	appId: string;
	channel: string;
	releaseId: string;
	reused: boolean;
	rollout: number;
	stage: 'published';
};

export type AbsoluteMobileUpdatePromotion = {
	appId: string;
	channel: string;
	releaseId: string;
	rollout: number;
	stage: 'promoted';
};

export type AbsoluteMobileUpdateRollback = {
	appId: string;
	channel: string;
	releaseId?: string;
	stage: 'rolled-back';
};

export type AbsoluteMobileUpdatePublisher = {
	publishUpdate(options: {
		manifest: Awaited<ReturnType<typeof readAbsoluteMobileUpdate>>;
		releaseDirectory: string;
		rollout: number;
		signal?: AbortSignal;
	}): Promise<AbsoluteMobileUpdatePublication>;
	promoteUpdate(options: {
		appId: string;
		channel: string;
		releaseId: string;
		rollout: number;
		signal?: AbortSignal;
	}): Promise<AbsoluteMobileUpdatePromotion>;
	rollbackUpdate(options: {
		appId: string;
		channel: string;
		releaseId?: string;
		signal?: AbortSignal;
	}): Promise<AbsoluteMobileUpdateRollback>;
};

const object = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const isPublisher = (value: unknown): value is AbsoluteMobileUpdatePublisher =>
	object(value) &&
	typeof value.publishUpdate === 'function' &&
	typeof value.promoteUpdate === 'function' &&
	typeof value.rollbackUpdate === 'function';

const projectPath = (projectRoot: string, requested: string, label: string) => {
	const root = resolve(projectRoot);
	const path = resolve(root, requested);
	const projectRelative = relative(root, path);
	if (
		projectRelative === '..' ||
		projectRelative.startsWith(`..${sep}`) ||
		isAbsolute(projectRelative)
	)
		throw new TypeError(`${label} must remain inside the project.`);

	return path;
};

export const loadAbsoluteMobileUpdatePublisher = async (
	projectRoot: string,
	requestedModulePath: string
) => {
	const modulePath = projectPath(
		projectRoot,
		requestedModulePath,
		'mobile update registry'
	);
	await access(modulePath).catch(() => {
		throw new TypeError(
			`Mobile update registry does not exist: ${modulePath}`
		);
	});
	const loaded: unknown = await import(pathToFileURL(modulePath).href);
	const publisher = object(loaded)
		? (loaded.default ?? loaded.registry)
		: undefined;
	if (!isPublisher(publisher))
		throw new TypeError(
			'Mobile update registry must implement publishUpdate, promoteUpdate, and rollbackUpdate.'
		);

	return publisher;
};
export const promoteAbsoluteMobileUpdate = async (options: {
	appId: string;
	channel: string;
	publisher: AbsoluteMobileUpdatePublisher;
	releaseId: string;
	rollout: number;
	signal?: AbortSignal;
}) => {
	const result = await options.publisher.promoteUpdate({
		appId: options.appId,
		channel: options.channel,
		releaseId: options.releaseId,
		rollout: options.rollout,
		signal: options.signal
	});
	if (
		result.appId !== options.appId ||
		result.channel !== options.channel ||
		result.releaseId !== options.releaseId ||
		result.rollout !== options.rollout ||
		result.stage !== 'promoted'
	)
		throw new TypeError(
			'Mobile update registry returned a different promotion identity.'
		);

	return result;
};
export const publishAbsoluteMobileUpdate = async (options: {
	projectRoot: string;
	publisher: AbsoluteMobileUpdatePublisher;
	releaseDirectory: string;
	rollout: number;
	signal?: AbortSignal;
}) => {
	const releaseDirectory = projectPath(
		options.projectRoot,
		options.releaseDirectory,
		'mobile update release directory'
	);
	const manifest = await readAbsoluteMobileUpdate(releaseDirectory);
	const result = await options.publisher.publishUpdate({
		manifest,
		releaseDirectory,
		rollout: options.rollout,
		signal: options.signal
	});
	if (
		result.appId !== manifest.appId ||
		result.channel !== manifest.channel ||
		result.releaseId !== manifest.releaseId ||
		result.rollout !== options.rollout ||
		result.stage !== 'published' ||
		typeof result.reused !== 'boolean'
	)
		throw new TypeError(
			'Mobile update registry returned a different publication identity.'
		);

	return result;
};
export const rollbackAbsoluteMobileUpdate = async (options: {
	appId: string;
	channel: string;
	publisher: AbsoluteMobileUpdatePublisher;
	releaseId?: string;
	signal?: AbortSignal;
}) => {
	const result = await options.publisher.rollbackUpdate({
		appId: options.appId,
		channel: options.channel,
		...(options.releaseId ? { releaseId: options.releaseId } : {}),
		signal: options.signal
	});
	if (
		result.appId !== options.appId ||
		result.channel !== options.channel ||
		result.releaseId !== options.releaseId ||
		result.stage !== 'rolled-back'
	)
		throw new TypeError(
			'Mobile update registry returned a different rollback identity.'
		);

	return result;
};
