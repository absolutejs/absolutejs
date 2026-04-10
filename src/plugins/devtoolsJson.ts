import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Elysia } from 'elysia';

const ENDPOINT = '/.well-known/appspecific/com.chrome.devtools.json';
const UUID_CACHE_KEY = '__absoluteDevtoolsWorkspaceUuid';

export type DevtoolsJsonOptions = {
	projectRoot?: string;
	uuid?: string;
	uuidCachePath?: string;
	normalizeForWindowsContainer?: boolean;
};

const getGlobalUuid = () => Reflect.get(globalThis, UUID_CACHE_KEY);

const setGlobalUuid = (uuid: string) => {
	Reflect.set(globalThis, UUID_CACHE_KEY, uuid);

	return uuid;
};

const isUuidV4 = (value: string) =>
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
		value
	);

export const resolveDevtoolsUuidCachePath = (
	buildDir: string,
	uuidCachePath?: string
) =>
	resolve(
		uuidCachePath ??
			join(buildDir, '.absolute', 'chrome-devtools-workspace-uuid')
	);

const readCachedUuid = (cachePath: string) => {
	if (!existsSync(cachePath)) return null;

	try {
		const value = readFileSync(cachePath, 'utf-8').trim();

		return isUuidV4(value) ? value : null;
	} catch {
		return null;
	}
};

const getOrCreateUuid = (buildDir: string, options: DevtoolsJsonOptions) => {
	if (options.uuid && isUuidV4(options.uuid)) {
		return options.uuid;
	}

	const globalUuid = getGlobalUuid();
	if (typeof globalUuid === 'string' && isUuidV4(globalUuid)) {
		return globalUuid;
	}

	const cachePath = resolveDevtoolsUuidCachePath(
		buildDir,
		options.uuidCachePath
	);
	const cachedUuid = readCachedUuid(cachePath);
	if (cachedUuid) return setGlobalUuid(cachedUuid);

	const uuid = crypto.randomUUID();
	mkdirSync(dirname(cachePath), { recursive: true });
	writeFileSync(cachePath, uuid, 'utf-8');

	return setGlobalUuid(uuid);
};

export const devtoolsJson = (
	buildDir: string,
	options: DevtoolsJsonOptions = {}
) => {
	const rootPath = resolve(options.projectRoot ?? process.cwd());
	const root =
		options.normalizeForWindowsContainer === false
			? rootPath
			: normalizeDevtoolsWorkspaceRoot(rootPath);
	const uuid = getOrCreateUuid(buildDir, options);

	return new Elysia({ name: 'absolute-devtools-json' }).get(ENDPOINT, () => ({
		workspace: {
			root,
			uuid
		}
	}));
};
export const normalizeDevtoolsWorkspaceRoot = (root: string) => {
	if (process.env.WSL_DISTRO_NAME) {
		const distro = process.env.WSL_DISTRO_NAME;
		const withoutLeadingSlash = root.replace(/^\//, '');

		return join('\\\\wsl.localhost', distro, withoutLeadingSlash).replace(
			/\//g,
			'\\'
		);
	}

	if (process.env.DOCKER_DESKTOP && !root.startsWith('\\\\')) {
		const withoutLeadingSlash = root.replace(/^\//, '');

		return join(
			'\\\\wsl.localhost',
			'docker-desktop-data',
			withoutLeadingSlash
		).replace(/\//g, '\\');
	}

	return root;
};
