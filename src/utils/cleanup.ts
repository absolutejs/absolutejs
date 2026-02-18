import { rm } from 'node:fs/promises';
import { join } from 'node:path';

type CleanupProps = {
	svelteDir?: string;
	vueDir?: string;
	reactIndexesPath?: string;
};

export const cleanup = async ({
	svelteDir,
	vueDir,
	reactIndexesPath
}: CleanupProps) => {
	await Promise.all([
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
