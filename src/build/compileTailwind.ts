import { mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { build as bunBuild } from 'bun';
import type {
	StylePreprocessorConfig,
	TailwindConfig
} from '../../types/build';
import { compileStyleSource } from './stylePreprocessor';

const TAILWIND_NATIVE_TEMP_DIR = '.absolute-tailwind-native';

const postprocessTailwindCss = async (
	css: string,
	outputPath: string,
	styleTransformConfig?: StylePreprocessorConfig
) =>
	compileStyleSource(outputPath, css, 'css', styleTransformConfig);

export const compileTailwind = async (
	input: string,
	output: string,
	buildPath: string,
	styleTransformConfig?: StylePreprocessorConfig
) => {
	const outputPath = join(buildPath, output);
	const tempDir = join(buildPath, TAILWIND_NATIVE_TEMP_DIR);

	await mkdir(dirname(outputPath), { recursive: true });
	await rm(tempDir, { force: true, recursive: true });

	let tailwindPlugin: typeof import('bun-plugin-tailwind').default;
	try {
		tailwindPlugin = (await import('bun-plugin-tailwind')).default;
	} catch {
		throw new Error(
			'Tailwind support requires bun-plugin-tailwind. Install it with `bun add -d bun-plugin-tailwind`.'
		);
	}

	const result = await bunBuild({
		entrypoints: [input],
		outdir: tempDir,
		plugins: [tailwindPlugin],
		target: 'browser',
		throw: false,
		write: false
	} as Parameters<typeof bunBuild>[0] & { write: false });

	if (!result.success) {
		const details = result.logs.map(String).join('\n').trim();
		throw new Error(
			`Tailwind native build failed${details ? `:\n${details}` : ''}`
		);
	}

	const cssOutput = result.outputs.find((artifact) =>
		artifact.path.endsWith('.css')
	);
	if (!cssOutput) throw new Error('Tailwind native build emitted no CSS.');

	const css = await cssOutput.text();
	await Bun.write(
		outputPath,
		await postprocessTailwindCss(css, outputPath, styleTransformConfig)
	);
	await rm(tempDir, { force: true, recursive: true });
};

export const compileTailwindConfig = async (
	tailwind: TailwindConfig,
	buildPath: string,
	styleTransformConfig?: StylePreprocessorConfig
) =>
	compileTailwind(
		tailwind.input,
		tailwind.output,
		buildPath,
		styleTransformConfig
	);
