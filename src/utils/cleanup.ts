import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
	getFrameworkGeneratedDir,
	type GeneratedFramework
} from './generatedDir';

type CleanupProps = {
	angularDir?: string;
	reactDir?: string;
	svelteDir?: string;
	vueDir?: string;
};

const removeIfExists = (path: string) =>
	rm(path, { force: true, recursive: true });

const cleanFramework = (
	framework: GeneratedFramework,
	frameworkDir: string | undefined
) => {
	const tasks: Promise<void>[] = [
		removeIfExists(getFrameworkGeneratedDir(framework))
	];
	// Legacy `<frameworkDir>/generated/` directory — created by older
	// builds before the move to `<projectRoot>/.absolutejs/generated/`.
	// Always clean these so users don't end up with stale intermediate
	// trees in `src/` after upgrading.
	if (frameworkDir)
		tasks.push(removeIfExists(join(frameworkDir, 'generated')));

	return Promise.all(tasks);
};

export const cleanup = async ({
	angularDir,
	reactDir,
	svelteDir,
	vueDir
}: CleanupProps) => {
	await Promise.all([
		cleanFramework('angular', angularDir),
		cleanFramework('react', reactDir),
		cleanFramework('svelte', svelteDir),
		cleanFramework('vue', vueDir)
	]);
};
