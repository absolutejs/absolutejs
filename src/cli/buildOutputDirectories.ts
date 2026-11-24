import { existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { isRecord } from './config/guards';
import { isWorkspaceConfig, loadRawConfig } from '../utils/loadConfig';

const DEFAULT_BUILD_DIRECTORY = 'build';
const DEFAULT_CONFIG_PATH = 'absolute.config.ts';

type WithBuildDirectory = { buildDirectory?: unknown };

/* Where the build output is, as globs — by what the config says, not by
 * the directory's name.
 *
 * `absolute typecheck` and `absolute prettier` each left the build output
 * alone with `**\/build/**`, which leaves alone every directory NAMED
 * `build`, source included: a project's `src/build/` was never checked
 * and never formatted, and both commands reported success. */
export const buildOutputGlobs = (configs: readonly WithBuildDirectory[]) => [
	...new Set(
		configs.map(({ buildDirectory }) => {
			const directory =
				typeof buildDirectory === 'string' && buildDirectory.length > 0
					? buildDirectory
					: DEFAULT_BUILD_DIRECTORY;

			return `${relative(process.cwd(), resolve(directory))}/**/*`;
		})
	)
];

/** The same, for a command that has not loaded the config itself. A
 *  project with no config, or one that does not load, has the default. */
export const loadBuildOutputGlobs = async () => {
	const path = resolve(process.env.ABSOLUTE_CONFIG ?? DEFAULT_CONFIG_PATH);
	if (!existsSync(path)) return buildOutputGlobs([{}]);

	try {
		const config = await loadRawConfig(path);
		const services = isWorkspaceConfig(config)
			? Object.values(config).filter(isRecord)
			: [config];

		return buildOutputGlobs(services);
	} catch {
		return buildOutputGlobs([{}]);
	}
};
