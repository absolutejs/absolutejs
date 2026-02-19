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
		angularDir
			? rm(join(angularDir, 'compiled'), {
					force: true,
					recursive: true
				})
			: undefined,
		svelteDir
			? rm(join(svelteDir, 'compiled'), {
					force: true,
					recursive: true
				})
			: undefined,
		vueDir
			? rm(join(vueDir, 'compiled'), { force: true, recursive: true })
			: undefined,
		reactIndexesPath
			? rm(reactIndexesPath, { force: true, recursive: true })
			: undefined
	]);
};
