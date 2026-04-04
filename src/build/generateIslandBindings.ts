import {
	existsSync,
	mkdirSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { BuildConfig } from '../../types/build';

const ensureDir = (filePath: string) => {
	mkdirSync(dirname(filePath), { recursive: true });
};

const writeIfChanged = (filePath: string, content: string) => {
	ensureDir(filePath);
	writeFileSync(filePath, content);
};

const removeIfExists = (filePath: string) => {
	if (existsSync(filePath)) {
		rmSync(filePath, { force: true });
	}
};

export const generateIslandBindings = (
	projectRoot: string,
	config: BuildConfig
) => {
	const registryPath = config.islands?.registry;
	if (!registryPath) {
		return;
	}

	const resolvedRegistryPath = resolve(projectRoot, registryPath);
	removeIfExists(resolve(dirname(resolvedRegistryPath), 'absolute-islands.d.ts'));

	if (config.reactDirectory) {
		const compatTarget = resolve(
			config.reactDirectory,
			'generated',
			'absolute-react.ts'
		);
		removeIfExists(resolve(config.reactDirectory, 'generated', 'Island.tsx'));
		removeIfExists(
			resolve(config.reactDirectory, 'generated', 'absolute-react.d.ts')
		);
		writeIfChanged(
			compatTarget,
			`export * from "@absolutejs/absolute/react";\n`
		);
	}

	if (config.vueDirectory) {
		const compatTarget = resolve(
			config.vueDirectory,
			'generated',
			'absolute-vue.ts'
		);
		removeIfExists(resolve(config.vueDirectory, 'generated', 'Island.ts'));
		removeIfExists(
			resolve(config.vueDirectory, 'generated', 'absolute-vue.d.ts')
		);
		writeIfChanged(
			compatTarget,
			`export * from "@absolutejs/absolute/vue";\n`
		);
	}

	if (config.svelteDirectory) {
		const compatTarget = resolve(
			config.svelteDirectory,
			'generated',
			'absolute-svelte.ts'
		);
		removeIfExists(resolve(config.svelteDirectory, 'generated', 'islands.ts'));
		removeIfExists(
			resolve(config.svelteDirectory, 'generated', 'absolute-svelte.d.ts')
		);
		writeIfChanged(
			compatTarget,
			`export * from "@absolutejs/absolute/svelte";\n`
		);
	}

	if (config.angularDirectory) {
		const compatTarget = resolve(
			config.angularDirectory,
			'generated',
			'absolute-angular.ts'
		);
		removeIfExists(resolve(config.angularDirectory, 'generated', 'islands.ts'));
		removeIfExists(
			resolve(config.angularDirectory, 'generated', 'absolute-angular.d.ts')
		);
		writeIfChanged(
			compatTarget,
			`export * from "@absolutejs/absolute/angular";\n`
		);
	}
};
