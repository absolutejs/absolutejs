import { rm } from 'node:fs/promises';
import { join } from 'node:path';

type CleanupProps = {
	angularDir?: string;
	svelteDir?: string;
	vueDir?: string;
	reactIndexesPath?: string;
};

export const cleanup = async ({
	angularDir,
	svelteDir,
	vueDir,
	reactIndexesPath
}: CleanupProps) => {
	await Promise.all([
		// Angular compiled/ is NOT removed — it contains AOT server files
		// used at runtime via import(). Only the indexes/ dir (which Bun's
		// bundler has already consumed) is cleaned up.
		angularDir
			? rm(join(angularDir, 'indexes'), {
					force: true,
					recursive: true
				})
			: undefined,
		svelteDir
			? Promise.all([
					rm(join(svelteDir, 'client'), {
						force: true,
						recursive: true
					}),
					rm(join(svelteDir, 'indexes'), {
						force: true,
						recursive: true
					}),
					rm(join(svelteDir, 'server'), {
						force: true,
						recursive: true
					})
				])
			: undefined,
		vueDir
			? Promise.all([
					rm(join(vueDir, 'client'), {
						force: true,
						recursive: true
					}),
					rm(join(vueDir, 'indexes'), {
						force: true,
						recursive: true
					}),
					rm(join(vueDir, 'server'), {
						force: true,
						recursive: true
					}),
					rm(join(vueDir, 'compiled'), {
						force: true,
						recursive: true
					})
				])
			: undefined,
		reactIndexesPath
			? rm(reactIndexesPath, { force: true, recursive: true })
			: undefined
	]);
};
