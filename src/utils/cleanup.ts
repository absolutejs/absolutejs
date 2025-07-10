import { rm } from 'node:fs/promises';
import { join } from 'node:path';

type CleanupProps = {
	svelteDir?: string;
	vueDir?: string;
	reactIndexesPath?: string;
	svelteServerPaths?: string[];
	vueServerPaths?: string[];
};

export const cleanup = async ({
	svelteDir,
	vueDir,
	reactIndexesPath,
	svelteServerPaths = [],
	vueServerPaths = []
}: CleanupProps) => {
	if (svelteDir) {
		await rm(join(svelteDir, 'indexes'), { force: true, recursive: true });
		await rm(join(svelteDir, 'client'), { force: true, recursive: true });
		await Promise.all(
			svelteServerPaths.map((path) => rm(path, { force: true }))
		);
		// TODO: remove when the files are generated inline instead of output
		await rm(join(svelteDir, 'pages', 'example'), {
			force: true,
			recursive: true
		});
	}

	if (vueDir) {
		await rm(join(vueDir, 'indexes'), { force: true, recursive: true });
		await rm(join(vueDir, 'client'), { force: true, recursive: true });
		await rm(join(vueDir, 'styles'), { force: true, recursive: true });
		await Promise.all(
			vueServerPaths.map((path) => rm(path, { force: true }))
		);
		// TODO: remove when the files are generated inline instead of output
		await rm(join(vueDir, 'pages', 'example'), {
			force: true,
			recursive: true
		});
	}

	if (reactIndexesPath)
		await rm(reactIndexesPath, { force: true, recursive: true });
};
