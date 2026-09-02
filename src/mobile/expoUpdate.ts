import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';

export const ABSOLUTE_EXPO_UPDATE_DESCRIPTOR =
	'_absolute/expo-update.json' as const;
export const ABSOLUTE_EXPO_UPDATE_FORMAT = 1 as const;

export type AbsoluteExpoUpdateAsset = {
	extension?: string;
	path: string;
};

export type AbsoluteExpoUpdatePlatform = {
	assets: AbsoluteExpoUpdateAsset[];
	launchAsset: AbsoluteExpoUpdateAsset;
};

export type AbsoluteExpoUpdateDescriptor = {
	engine: 'expo';
	expoConfig: Record<string, unknown>;
	format: typeof ABSOLUTE_EXPO_UPDATE_FORMAT;
	platforms: Partial<Record<'android' | 'ios', AbsoluteExpoUpdatePlatform>>;
	runtimeVersion: string;
};

const object = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const safePath = (value: unknown, field: string) => {
	if (typeof value !== 'string' || value.length === 0)
		throw new TypeError(`Expo update ${field} is invalid.`);
	const path = value.replaceAll('\\', '/');
	if (
		path.startsWith('/') ||
		path
			.split('/')
			.some((segment) => !segment || segment === '.' || segment === '..')
	)
		throw new TypeError(`Expo update ${field} must be a relative path.`);

	return path;
};

const extension = (value: unknown, path: string) => {
	if (value === null || value === undefined) {
		const inferred = extname(path);

		return inferred ? inferred.slice(1) : undefined;
	}
	if (typeof value !== 'string' || !/^[A-Za-z0-9]+$/u.test(value))
		throw new TypeError('Expo update asset extension is invalid.');

	return value;
};

const asset = (value: unknown): AbsoluteExpoUpdateAsset => {
	if (!object(value)) throw new TypeError('Expo update asset is invalid.');
	const path = safePath(value.path, 'asset path');
	const normalizedExtension = extension(value.extension ?? value.ext, path);

	return {
		...(normalizedExtension ? { extension: normalizedExtension } : {}),
		path
	};
};

const platform = (value: unknown): AbsoluteExpoUpdatePlatform => {
	if (!object(value) || !Array.isArray(value.assets))
		throw new TypeError('Expo update platform metadata is invalid.');
	const launchValue = object(value.launchAsset)
		? value.launchAsset
		: { path: value.bundle };
	const launchPath = safePath(launchValue.path, 'launch bundle');
	const launchExtension = extension(
		launchValue.extension ?? null,
		launchPath
	);
	const assets = value.assets.map(asset);

	return {
		assets,
		launchAsset: {
			...(launchExtension ? { extension: launchExtension } : {}),
			path: launchPath
		}
	};
};

const parseAbsoluteExpoUpdateDescriptor = (
	value: unknown
): AbsoluteExpoUpdateDescriptor => {
	if (
		!object(value) ||
		value.engine !== 'expo' ||
		value.format !== ABSOLUTE_EXPO_UPDATE_FORMAT ||
		!object(value.expoConfig) ||
		!object(value.platforms) ||
		typeof value.runtimeVersion !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(value.runtimeVersion)
	)
		throw new TypeError('AbsoluteJS Expo update descriptor is invalid.');
	const platforms: AbsoluteExpoUpdateDescriptor['platforms'] = {};
	for (const name of ['android', 'ios'] as const) {
		const candidate = value.platforms[name];
		if (candidate !== undefined) platforms[name] = platform(candidate);
	}
	if (Object.keys(platforms).length === 0)
		throw new TypeError('Expo update descriptor has no native platforms.');

	return {
		engine: 'expo',
		expoConfig: value.expoConfig,
		format: ABSOLUTE_EXPO_UPDATE_FORMAT,
		platforms,
		runtimeVersion: value.runtimeVersion
	};
};

const finalizeAbsoluteExpoUpdateExport = async (options: {
	expoConfig: Record<string, unknown>;
	exportDirectory: string;
	runtimeVersion: string;
}) => {
	const metadata: unknown = JSON.parse(
		await readFile(join(options.exportDirectory, 'metadata.json'), 'utf8')
	);
	if (!object(metadata) || !object(metadata.fileMetadata))
		throw new TypeError('Expo export metadata.json is invalid.');
	const descriptor = parseAbsoluteExpoUpdateDescriptor({
		engine: 'expo',
		expoConfig: options.expoConfig,
		format: ABSOLUTE_EXPO_UPDATE_FORMAT,
		platforms: metadata.fileMetadata,
		runtimeVersion: options.runtimeVersion
	});
	const referenced = Object.values(descriptor.platforms).flatMap((entry) =>
		entry ? [entry.launchAsset, ...entry.assets] : []
	);
	await Promise.all(
		referenced.map(({ path }) =>
			access(join(options.exportDirectory, path)).catch(() => {
				throw new TypeError(
					`Expo export metadata references missing asset ${path}.`
				);
			})
		)
	);
	const destination = join(
		options.exportDirectory,
		ABSOLUTE_EXPO_UPDATE_DESCRIPTOR
	);
	await mkdir(dirname(destination), { recursive: true });
	await writeFile(destination, `${JSON.stringify(descriptor, null, '\t')}\n`);

	return { descriptor, path: destination };
};

export { finalizeAbsoluteExpoUpdateExport, parseAbsoluteExpoUpdateDescriptor };
