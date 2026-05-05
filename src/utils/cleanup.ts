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
	// In dev with `skipAngularClientBundle`, the Angular hydration TS
	// files in `.absolutejs/generated/angular/indexes/` are served live
	// by `moduleServer` at `/@src/...`. Wiping them at the end of the
	// build would 500 every Angular page load until the next rebuild.
	preserveAngularGenerated?: boolean;
};

const removeIfExists = (path: string) =>
	rm(path, { force: true, recursive: true });

const cleanFramework = (
	framework: GeneratedFramework,
	frameworkDir: string | undefined,
	skipGenerated = false
) => {
	const tasks: Promise<void>[] = [];
	if (!skipGenerated) {
		tasks.push(removeIfExists(getFrameworkGeneratedDir(framework)));
	}
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
	vueDir,
	preserveAngularGenerated
}: CleanupProps) => {
	await Promise.all([
		cleanFramework('angular', angularDir, preserveAngularGenerated),
		cleanFramework('react', reactDir),
		cleanFramework('svelte', svelteDir),
		cleanFramework('vue', vueDir)
	]);
};
