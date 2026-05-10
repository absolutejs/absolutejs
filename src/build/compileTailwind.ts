import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type {
	BuildConfig,
	StylePreprocessorConfig,
	TailwindConfig
} from '../../types/build';
import { incrementalTailwindBuild } from './tailwindCompiler';

/* Build absolute `@source` glob patterns for every framework directory
   the user configured. Tailwind v4 only scans paths it's been told
   about (its automatic detection covers the dir containing the entry
   CSS), so without these the user has to manually add a `@source`
   directive per framework. Auto-injecting them eliminates a class of
   silent "my utility class doesn't show up" bugs. */
export const computeFrameworkTailwindSources = (
	config: BuildConfig
): string[] => {
	const cwd = process.cwd();
	const dirs: Array<[string | undefined, string]> = [
		[config.angularDirectory, '**/*.{ts,tsx,html,htm}'],
		[config.svelteDirectory, '**/*.{ts,tsx,svelte,html,htm}'],
		[config.vueDirectory, '**/*.{ts,tsx,vue,html,htm}'],
		[config.reactDirectory, '**/*.{ts,tsx,js,jsx,html,htm}'],
		[config.htmlDirectory, '**/*.{html,htm}'],
		[config.htmxDirectory, '**/*.{html,htm,js,ts}'],
		[config.emberDirectory, '**/*.{ts,tsx,gts,gjs,hbs,html,htm}']
	];
	const out: string[] = [];
	for (const [dir, glob] of dirs) {
		if (!dir) continue;
		out.push(`${resolve(cwd, dir)}/${glob}`);
	}
	return out;
};

/* Files Tailwind v4 may scan for candidate utility classes via the `@source`
   directive. When any of these change in dev, the Tailwind output must be
   regenerated so newly referenced utilities show up in the CSS — otherwise
   classes appear in markup with no rules behind them. */
const TAILWIND_CANDIDATE_EXTENSION_PATTERN =
	/\.(html?|m?[jt]sx?|cjs|vue|svelte|astro|mdx?|css|s[ac]ss|less|styl(?:us)?)$/i;

export const isTailwindCandidate = (filePath: string) =>
	TAILWIND_CANDIDATE_EXTENSION_PATTERN.test(filePath);

/* Production / cold-start build of the Tailwind output CSS.

   Uses the same persistent-compiler path as HMR — calling
   `incrementalTailwindBuild` with no changed-file hint forces a fresh
   compile + full source scan. The compiler instance is then cached for
   the remainder of the process, so subsequent rebuilds (HMR ticks during
   `absolute dev`) get the per-candidate cache for free.

   This replaces the old `bun.build` + `bun-plugin-tailwind` pipeline:
   the bundler was being spun up just to drive Tailwind, which made every
   call pay bundler-init cost and discarded Tailwind's internal caches
   between calls. Going directly through `tailwindcss`'s own `compile()`
   API drops both costs and brings the production build into the same
   fast path as dev. */
export const compileTailwind = async (
	input: string,
	output: string,
	buildPath: string,
	styleTransformConfig?: StylePreprocessorConfig,
	extraSources: string[] = [],
	changedFiles: string[] = []
) => {
	const outputPath = join(buildPath, output);
	await mkdir(dirname(outputPath), { recursive: true });
	await incrementalTailwindBuild(
		{ input, output },
		buildPath,
		changedFiles,
		styleTransformConfig,
		extraSources
	);
};

export const compileTailwindConfig = async (
	tailwind: TailwindConfig,
	buildPath: string,
	styleTransformConfig?: StylePreprocessorConfig,
	extraSources: string[] = [],
	changedFiles: string[] = []
) =>
	compileTailwind(
		tailwind.input,
		tailwind.output,
		buildPath,
		styleTransformConfig,
		extraSources,
		changedFiles
	);
