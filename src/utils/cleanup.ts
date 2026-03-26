import { rm } from 'node:fs/promises';
import { join } from 'node:path';

type CleanupProps = {
	angularDir?: string;
	reactDir?: string;
	svelteDir?: string;
	vueDir?: string;
};

export const cleanup = async ({
	angularDir,
	reactDir,
	svelteDir,
	vueDir
}: CleanupProps) => {
	await Promise.all([
		angularDir
			? rm(join(angularDir, '.generated'), {
					force: true,
					recursive: true
				})
			: undefined,
		reactDir
			? rm(join(reactDir, '.generated'), {
					force: true,
					recursive: true
				})
			: undefined,
		svelteDir
			? rm(join(svelteDir, '.generated'), {
					force: true,
					recursive: true
				})
			: undefined,
		vueDir
			? rm(join(vueDir, '.generated'), {
					force: true,
					recursive: true
				})
			: undefined
	]);
};
