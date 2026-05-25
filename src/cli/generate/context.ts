import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { loadConfig } from '../../utils/loadConfig';
import { findConfigPath } from '../config/absolute/resolveAbsoluteConfig';
import { DEFAULT_SERVER_ENTRY } from '../utils';
import {
	FRAMEWORK_KEYS,
	isFrameworkKey,
	type FrameworkKey
} from './frameworkKey';
import { frameworks } from './frameworks';

export type ProjectContext = {
	config: Record<string, unknown>;
	configPath: string | null;
	cwd: string;
	frameworkDirs: Partial<Record<FrameworkKey, string>>;
	serverEntry: string;
	stylesDir: string;
};

const asString = (value: unknown) =>
	typeof value === 'string' ? value : undefined;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const resolveDir = (cwd: string, value: string) =>
	isAbsolute(value) ? value : resolve(cwd, value);

// stylesConfig is either the indexes directory path (string) or an object that
// carries it; fall back to the conventional location next to the frontend.
const resolveStylesDir = (cwd: string, config: Record<string, unknown>) => {
	const styles = config.stylesConfig;
	if (typeof styles === 'string') return resolveDir(cwd, styles);
	if (isRecord(styles)) {
		const indexes = asString(styles.indexes);
		if (indexes) return resolveDir(cwd, indexes);
	}

	return resolve(cwd, 'src/frontend/styles/indexes');
};

export const configuredFrameworks = (project: ProjectContext) =>
	FRAMEWORK_KEYS.filter((key) => project.frameworkDirs[key] !== undefined);
export const frontendRootFor = (
	project: ProjectContext,
	framework: FrameworkKey
) => {
	const dir = project.frameworkDirs[framework];

	return dir ? dirname(dir) : resolve(project.cwd, 'src/frontend');
};
export const resolveProject = async (cwd: string, configOverride?: string) => {
	const loaded = await loadConfig(configOverride);
	const config: Record<string, unknown> = isRecord(loaded) ? loaded : {};
	const frameworkDirs: Partial<Record<FrameworkKey, string>> = {};
	for (const key of FRAMEWORK_KEYS) {
		const dir = asString(config[frameworks[key].configDirKey]);
		if (dir) frameworkDirs[key] = resolveDir(cwd, dir);
	}
	const entry = asString(config.entry) ?? DEFAULT_SERVER_ENTRY;

	return {
		config,
		configPath: findConfigPath(cwd, configOverride),
		cwd,
		frameworkDirs,
		serverEntry: resolveDir(cwd, entry),
		stylesDir: resolveStylesDir(cwd, config)
	} satisfies ProjectContext;
};
export const selectFramework = (
	project: ProjectContext,
	explicit: string | undefined
) => {
	const configured = configuredFrameworks(project);
	if (explicit !== undefined) {
		if (!isFrameworkKey(explicit)) {
			return {
				message: `Unknown framework "${explicit}".`,
				ok: false as const
			};
		}
		if (!configured.includes(explicit)) {
			return {
				message: `Framework "${explicit}" is not configured. Add it with \`absolute add ${explicit}\`.`,
				ok: false as const
			};
		}

		return { framework: explicit, ok: true as const };
	}
	if (configured.length === 0) {
		return {
			message: 'No frameworks are configured in absolute.config.ts.',
			ok: false as const
		};
	}
	const [only] = configured;
	if (configured.length === 1 && only) {
		return { framework: only, ok: true as const };
	}

	return {
		message: `Multiple frameworks configured (${configured.join(', ')}). Pass --framework <name>.`,
		ok: false as const
	};
};
export const sharedDirFor = (
	project: ProjectContext,
	framework: FrameworkKey
) => join(frontendRootFor(project, framework), 'shared');
export const toModuleSpecifier = (fromDir: string, toFileNoExt: string) => {
	const rel = relative(fromDir, toFileNoExt).split('\\').join('/');

	return rel.startsWith('.') ? rel : `./${rel}`;
};
