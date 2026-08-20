import { access, readFile, rename, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import type { NormalizedAbsoluteMobileConfig } from './config';

export type WriteAbsoluteCapacitorConfigOptions = {
	force?: boolean;
	projectRoot: string;
};

const CONFIG_FILE = 'capacitor.config.ts';

const portableRelative = (root: string, path: string) =>
	relative(root, path).replaceAll('\\', '/');

const capacitorConfigSource = (
	config: NormalizedAbsoluteMobileConfig,
	projectRoot: string
) => `import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
	appId: ${JSON.stringify(config.appId)},
	appName: ${JSON.stringify(config.appName)},
	webDir: ${JSON.stringify(portableRelative(projectRoot, config.bundleDirectory))},
	android: {
		path: ${JSON.stringify(portableRelative(projectRoot, `${config.nativeProjectDirectory}/android`))}
	},
	ios: {
		path: ${JSON.stringify(portableRelative(projectRoot, `${config.nativeProjectDirectory}/ios`))}
	}
};

export default config;
`;

const exists = async (path: string) => {
	try {
		await access(path);

		return true;
	} catch {
		return false;
	}
};

export const writeAbsoluteCapacitorConfig = async (
	config: NormalizedAbsoluteMobileConfig,
	options: WriteAbsoluteCapacitorConfigOptions
) => {
	const projectRoot = resolve(options.projectRoot);
	const destination = resolve(projectRoot, CONFIG_FILE);
	const source = capacitorConfigSource(config, projectRoot);
	if (await exists(destination)) {
		const current = await readFile(destination, 'utf8');
		if (current === source) return { changed: false, path: destination };
		if (!options.force) {
			throw new TypeError(
				`${CONFIG_FILE} already exists and differs; rerun with --force only after reviewing it.`
			);
		}
	}
	const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
	await writeFile(temporary, source, { flag: 'wx' });
	await rename(temporary, destination);

	return { changed: true, path: destination };
};
