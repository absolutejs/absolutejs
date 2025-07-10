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
	if (svelteDir) {
		await rm(join(svelteDir, 'compiled'), { force: true, recursive: true });
	}

	if (vueDir) {
		await rm(join(vueDir, 'compiled'), { force: true, recursive: true });
	}

	if (reactIndexesPath)
		await rm(reactIndexesPath, { force: true, recursive: true });
};
