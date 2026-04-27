import { resolve } from 'node:path';
import type {
	CommandServiceConfig,
	ConfigInput,
	ServiceConfig,
	WorkspaceConfig
} from '../../types/build';

const RESERVED_TOP_LEVEL_KEYS = new Set([
	'assetsDirectory',
	'astroDirectory',
	'buildDirectory',
	'command',
	'config',
	'cwd',
	'dependsOn',
	'dev',
	'entry',
	'env',
	'htmlDirectory',
	'htmxDirectory',
	'images',
	'incrementalFiles',
	'islands',
	'kind',
	'mode',
	'options',
	'port',
	'postcss',
	'publicDirectory',
	'reactDirectory',
	'sitemap',
	'static',
	'stylesConfig',
	'svelteDirectory',
	'tailwind',
	'ready',
	'visibility',
	'vueDirectory'
]);

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const isCommandService = (
	service: ServiceConfig
): service is CommandServiceConfig =>
	service.kind === 'command' || Array.isArray(service.command);

const isServiceCandidate = (value: unknown): value is ServiceConfig =>
	isObject(value) &&
	(typeof value.entry === 'string' || Array.isArray(value.command));

const isWorkspaceConfig = (config: ConfigInput): config is WorkspaceConfig => {
	if (!isObject(config)) {
		return false;
	}

	const entries = Object.entries(config);
	if (entries.length === 0) {
		return false;
	}

	if (entries.some(([key]) => RESERVED_TOP_LEVEL_KEYS.has(key))) {
		return false;
	}

	return entries.every(([, value]) => isServiceCandidate(value));
};

const isConfigInput = (value: unknown): value is ConfigInput => isObject(value);

const getWorkspaceServices = (config: ConfigInput) => {
	if (!isWorkspaceConfig(config)) {
		throw new Error(
			'absolute.config.ts is not a multi-service config. Define top-level named services with `entry` or `command` before using `absolute workspace dev`.'
		);
	}

	return config;
};

const projectServiceConfig = (config: ConfigInput, serviceName: string) => {
	const services = getWorkspaceServices(config);
	const service = services[serviceName];
	if (!service) {
		throw new Error(
			`Config file does not define service "${serviceName}".`
		);
	}

	if (isCommandService(service)) {
		throw new Error(
			`Service "${serviceName}" is a command service and cannot be loaded as an AbsoluteJS app config.`
		);
	}

	const {
		command: _command,
		config: _config,
		cwd: _cwd,
		dependsOn: _dependsOn,
		env: _env,
		kind: _kind,
		port: _port,
		ready: _ready,
		visibility: _visibility,
		...serviceConfig
	} = service;

	return serviceConfig;
};

export const loadConfig = async (configPath?: string) => {
	const config = await loadRawConfig(configPath);
	const serviceName = process.env.ABSOLUTE_WORKSPACE_SERVICE_NAME;
	if (typeof serviceName === 'string' && serviceName.length > 0) {
		return projectServiceConfig(config, serviceName);
	}

	if (isWorkspaceConfig(config)) {
		throw new Error(
			'absolute.config.ts defines multiple services. Use `absolute workspace dev` or set ABSOLUTE_WORKSPACE_SERVICE_NAME before loading a specific service config.'
		);
	}

	return config;
};
export const loadRawConfig = async (configPath?: string) => {
	const resolved = resolve(
		configPath ?? process.env.ABSOLUTE_CONFIG ?? 'absolute.config.ts'
	);
	const mod = await import(resolved);
	const config = mod.default ?? mod.config;

	if (!config) {
		throw new Error(
			`Config file "${resolved}" does not export a valid configuration.\n` +
				`Expected: export default defineConfig({ ... })`
		);
	}

	if (!isConfigInput(config)) {
		throw new Error(
			`Config file "${resolved}" must export an object configuration.`
		);
	}

	return config;
};

export { getWorkspaceServices, isWorkspaceConfig };
