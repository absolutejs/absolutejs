import { $ } from 'bun';
import {
	rm,
	cp,
	mkdir,
	readdir,
	readFile,
	stat,
	writeFile
} from 'node:fs/promises';
import { dirname, join, resolve, relative } from 'node:path';
import type { AngularCompilerOptions } from '@angular/compiler-cli';
import ts from 'typescript';

const DIST = 'dist';

const SERVER_ENTRY_POINTS = [
	'src/index.ts',
	'src/build.ts',
	'src/ai/index.ts',
	'src/ai/providers/anthropic.ts',
	'src/ai/providers/openai.ts',
	'src/ai/providers/ollama.ts',
	'src/ai/providers/openaiCompatible.ts',
	'src/ai/providers/openaiResponses.ts',
	'src/ai/providers/gemini.ts',
	'src/ai/client/index.ts',
	'src/angular/index.ts',
	'src/angular/browser.ts',
	'src/angular/server.ts',
	'src/angular/ai/index.ts',
	'src/client/index.ts',
	'src/islands/browser.ts',
	'src/islands/index.ts',
	'src/react/index.ts',
	'src/react/browser.ts',
	'src/react/server.ts',
	'src/react/ai/index.ts',
	'src/react/components/index.ts',
	'src/react/hooks/index.ts',
	'src/svelte/index.ts',
	'src/svelte/browser.ts',
	'src/svelte/server.ts',
	'src/svelte/ai/index.ts',
	'src/vue/index.ts',
	'src/vue/browser.ts',
	'src/vue/server.ts',
	'src/vue/ai/index.ts',
	'src/vue/components/index.ts'
];

const EXTERNALS = [
	'react',
	'react-dom',
	'vue',
	'@vue/compiler-sfc',
	'vue/server-renderer',
	'svelte',
	'svelte/compiler',
	'svelte/server',
	'elysia',
	'@elysiajs/static',
	'@angular/compiler-cli',
	'@angular/core',
	'@angular/common',
	'@angular/platform-browser',
	'@angular/platform-server',
	'@angular/ssr',
	'zone.js',
	'debug',
	'sharp',
	'@absolutejs/native-linux-x64',
	'@absolutejs/native-linux-arm64',
	'@absolutejs/native-darwin-x64',
	'@absolutejs/native-darwin-arm64'
];

const build = async () => {
	console.log('Cleaning dist/...');
	await rm(DIST, { force: true, recursive: true });

	console.log('Building server entry points...');
	const serverBuild = await Bun.build({
		entrypoints: SERVER_ENTRY_POINTS,
		external: EXTERNALS,
		outdir: DIST,
		root: 'src',
		sourcemap: 'linked',
		target: 'bun'
	});

	if (!serverBuild.success) {
		console.error('Server build failed:');
		for (const log of serverBuild.logs) console.error(log);
		process.exit(1);
	}

	console.log('Building image client (browser target)...');
	const imageBuild = await Bun.build({
		entrypoints: ['src/utils/imageClient.ts'],
		outdir: join(DIST, 'image-client'),
		target: 'browser'
	});

	if (!imageBuild.success) {
		console.error('Image client build failed:');
		for (const log of imageBuild.logs) console.error(log);
		process.exit(1);
	}

	console.log('Building React components (browser target)...');
	const reactBrowserBuild = await Bun.build({
		entrypoints: ['src/react/components/index.ts'],
		external: [
			'react',
			'react-dom',
			'react/jsx-runtime',
			'react/jsx-dev-runtime'
		],
		outdir: join(DIST, 'react', 'components', 'browser'),
		root: 'src/react/components',
		target: 'browser'
	});

	if (!reactBrowserBuild.success) {
		console.error('React browser build failed:');
		for (const log of reactBrowserBuild.logs) console.error(log);
		process.exit(1);
	}

	console.log('Building AI client hooks (browser target)...');
	const aiBrowserBuild = await Bun.build({
		entrypoints: [
			'src/react/ai/index.ts',
			'src/vue/ai/index.ts',
			'src/angular/ai/index.ts'
		],
		external: [
			'react',
			'react-dom',
			'react/jsx-runtime',
			'react/jsx-dev-runtime',
			'vue',
			'@angular/core'
		],
		outdir: join(DIST, 'ai-client'),
		target: 'browser'
	});

	if (!aiBrowserBuild.success) {
		console.error('AI client build failed:');
		for (const log of aiBrowserBuild.logs) console.error(log);
		process.exit(1);
	}

	console.log('Building CLI...');
	const cliBuild = await Bun.build({
		entrypoints: ['src/cli/index.ts'],
		outdir: join(DIST, 'cli'),
		target: 'bun'
	});

	if (!cliBuild.success) {
		console.error('CLI build failed:');
		for (const log of cliBuild.logs) console.error(log);
		process.exit(1);
	}

	console.log('Generating type declarations...');
	await $`tsc --emitDeclarationOnly --project tsconfig.build.json`;

	console.log('Copying static assets...');

	await copyPublishedDevClientSources();

	await mkdir(join(DIST, 'svelte', 'components'), { recursive: true });
	const svelteFiles = await readdir('src/svelte/components');
	for (const file of svelteFiles.filter((entry) =>
		entry.endsWith('.svelte')
	)) {
		// eslint-disable-next-line no-await-in-loop
		await cp(
			join('src', 'svelte', 'components', file),
			join(DIST, 'svelte', 'components', file)
		);
	}

	await mkdir(join(DIST, 'vue', 'components'), { recursive: true });
	const vueFiles = await readdir('src/vue/components');
	for (const file of vueFiles.filter((entry) => entry.endsWith('.vue'))) {
		// eslint-disable-next-line no-await-in-loop
		await cp(
			join('src', 'vue', 'components', file),
			join(DIST, 'vue', 'components', file)
		);
	}

	// Generate .d.ts files for SFC components so consumers get type safety
	console.log('Generating SFC type declarations...');
	await generateSfcDeclarations();

	console.log('Fixing Svelte browser entry...');
	await fixSvelteBrowserEntry();

	// Compile Angular components with partial compilation (ɵɵngDeclareComponent)
	// so they work in both AOT (via linker) and JIT (via runtime fallback)
	console.log('Compiling Angular components (partial)...');
	await compileAngularComponentsPartial();

	console.log('Verifying exports...');
	await verifyExports();

	console.log('Build complete.');
};

const rewritePublishedDevClientSource = (
	content: string,
	relativePath: string
) => {
	const normalized = content
		.replaceAll('../.././../../types/', '../../../../types/')
		.replace(
			/((?:\.\.\/)+)types\/(client|globals|vue)/g,
			(_match, parents: string, target: string) => {
				const trimmed = parents.replace(/^\.\.\//, '');

				return `${trimmed}types/${target}`;
			}
		);

	const dir =
		dirname(relativePath) === '.'
			? ''
			: dirname(relativePath).replaceAll('\\', '/');
	const nestedDepth = dir ? dir.split('/').length : 0;
	const globalsPath = `${'../'.repeat(nestedDepth + 2)}types/globals`;
	const header = `import type {} from '${globalsPath}';\n`;

	return normalized.startsWith(header)
		? normalized
		: `${header}${normalized}`;
};

const copyPublishedDevClientEntry = async (
	entry: string,
	sourcePath: string,
	targetPath: string,
	relativePath: string
) => {
	const entryStat = await stat(sourcePath);
	if (entryStat.isDirectory()) {
		await copyPublishedDevClientDirectory(
			sourcePath,
			targetPath,
			relativePath
		);

		return;
	}

	if (!entry.endsWith('.ts')) {
		await cp(sourcePath, targetPath);

		return;
	}

	const sourceText = await readFile(sourcePath, 'utf8');
	const rewritten = rewritePublishedDevClientSource(sourceText, relativePath);
	await writeFile(targetPath, rewritten);
};

const copyPublishedDevClientDirectory = async (
	sourceDir: string,
	targetDir: string,
	relativeDir = ''
) => {
	await mkdir(targetDir, { recursive: true });
	const entries = await readdir(sourceDir);
	for (const entry of entries) {
		const sourcePath = join(sourceDir, entry);
		const targetPath = join(targetDir, entry);
		const relativePath = relativeDir ? join(relativeDir, entry) : entry;
		// eslint-disable-next-line no-await-in-loop
		await copyPublishedDevClientEntry(
			entry,
			sourcePath,
			targetPath,
			relativePath
		);
	}
};

const fixSvelteBrowserEntry = async () => {
	const browserPath = join(DIST, 'svelte', 'browser.js');
	const source = await readFile(browserPath, 'utf8');
	const assetPattern = /^var Island_default = ['"][^'"]+\.svelte['"];$/m;

	if (!assetPattern.test(source)) {
		return;
	}

	const nextSource = source.replace(
		assetPattern,
		'import Island_default from "./components/Island.svelte";'
	);

	await writeFile(browserPath, nextSource);
};

const copyPublishedDevClientSources = async () => {
	await mkdir(join(DIST, 'dev'), { recursive: true });
	await copyPublishedDevClientDirectory(
		join('src', 'dev', 'client'),
		join(DIST, 'dev', 'client')
	);
	await mkdir(join(DIST, 'types'), { recursive: true });
	await cp(
		join('types', 'globals.d.ts'),
		join(DIST, 'types', 'globals.d.ts')
	);
};

const buildSvelteDts = (name: string, propsType: string | undefined) => {
	if (propsType === 'ImageProps') {
		return `import type { ImageProps } from '../../types/image';\nimport { SvelteComponent } from 'svelte';\ndeclare const __propDef: { props: ImageProps };\ntype Props = typeof __propDef.props;\nexport default class ${name} extends SvelteComponent<Props> {}\n`;
	}
	if (propsType) {
		return `import type { ${propsType} } from '../../types/metadata';\nimport { SvelteComponent } from 'svelte';\ndeclare const __propDef: { props: ${propsType} };\ntype Props = typeof __propDef.props;\nexport default class ${name} extends SvelteComponent<Props> {}\n`;
	}

	return `import { SvelteComponent } from 'svelte';\nexport default class ${name} extends SvelteComponent {}\n`;
};

const buildVueDts = (name: string, hasImageProps: boolean) => {
	if (name === 'Image' || hasImageProps) {
		return `import type { ImageProps } from '../../types/image';\nimport { DefineComponent } from 'vue';\ndeclare const _default: DefineComponent<ImageProps>;\nexport default _default;\n`;
	}

	return `import { DefineComponent } from 'vue';\ndeclare const _default: DefineComponent;\nexport default _default;\n`;
};

const generateSfcDeclarations = async () => {
	// Svelte component declarations
	const svelteComponentDir = join(DIST, 'svelte', 'components');
	const svelteFiles = await readdir(svelteComponentDir);
	for (const file of svelteFiles.filter((entry) =>
		entry.endsWith('.svelte')
	)) {
		// eslint-disable-next-line no-await-in-loop
		const content = await Bun.file(join(svelteComponentDir, file)).text();
		const propsMatch = content.match(/\}:\s*(\w+)\s*=\s*\$props\(\)/);
		const propsType = propsMatch?.[1];
		const name = file.replace(/\.svelte$/, '');

		const dts = buildSvelteDts(name, propsType);
		// eslint-disable-next-line no-await-in-loop
		await writeFile(join(svelteComponentDir, `${file}.d.ts`), dts);
	}

	// Vue component declarations
	const vueComponentDir = join(DIST, 'vue', 'components');
	const vueFiles = await readdir(vueComponentDir);
	for (const file of vueFiles.filter((entry) => entry.endsWith('.vue'))) {
		// eslint-disable-next-line no-await-in-loop
		const content = await Bun.file(join(vueComponentDir, file)).text();
		const name = file.replace(/\.vue$/, '');

		// Check if it uses defineProps<ImageProps> or inline props
		const hasImageProps =
			content.includes('ImageProps') || content.includes('defineProps<{');
		const dts = buildVueDts(name, hasImageProps);
		// eslint-disable-next-line no-await-in-loop
		await writeFile(join(vueComponentDir, `${file}.d.ts`), dts);
	}
};

const addJsExtensions = (content: string) =>
	content.replace(
		/from\s+(['"])(\.\.?\/[^'"]+)(\1)/g,
		(match, quote, path) => {
			if (!path.match(/\.(js|ts|mjs|cjs)$/)) {
				return `from ${quote}${path}.js${quote}`;
			}

			return match;
		}
	);

const logAngularErrorsAndExit = (errors: ts.Diagnostic[]) => {
	console.error('Angular partial compilation errors:');
	for (const diag of errors)
		console.error(ts.flattenDiagnosticMessageText(diag.messageText, '\n'));
	process.exit(1);
};

const compileAngularComponentsPartial = async () => {
	const { readConfiguration, performCompilation, EmitFlags } = await import(
		'@angular/compiler-cli'
	);

	const finalDir = join(DIST, 'angular', 'components');
	await mkdir(finalDir, { recursive: true });

	// Use a temp output dir outside dist/ to avoid conflicts with existing compiled files
	const tmpDir = '.angular-partial-tmp';
	const outDir = join(tmpDir, 'out');
	const srcDir = join(tmpDir, 'src');
	await mkdir(outDir, { recursive: true });
	await mkdir(srcDir, { recursive: true });

	const srcFiles = await readdir('src/angular/components');
	for (const file of srcFiles.filter((entry) => entry.endsWith('.ts'))) {
		// eslint-disable-next-line no-await-in-loop
		let content = await Bun.file(
			join('src', 'angular', 'components', file)
		).text();
		content = content.replace(
			/from\s+(['"])\.\.\/\.\.\/utils\/imageProcessing['"]/g,
			'from $1@absolutejs/absolute/image$1'
		);
		// eslint-disable-next-line no-await-in-loop
		await Bun.write(join(srcDir, file), content);
	}

	const config = readConfiguration('./tsconfig.json');
	const tsOptions: ts.CompilerOptions = {
		declaration: false,
		emitDecoratorMetadata: true,
		experimentalDecorators: true,
		module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.Bundler,
		newLine: ts.NewLineKind.LineFeed,
		outDir,
		rootDir: resolve('.'),
		skipLibCheck: true,
		suppressOutputPathCheck: true,
		target: ts.ScriptTarget.ES2022
	};

	const options: AngularCompilerOptions & { compilationMode: 'partial' } = {
		...config.options,
		...tsOptions,
		compilationMode: 'partial' as const
	};

	const host = ts.createCompilerHost(tsOptions);

	// Capture only files emitted from our source dir (not external deps like imageClient)
	const emitted: Record<string, string> = {};
	const resolvedSrcInOut = resolve(
		outDir,
		relative(resolve('.'), resolve(srcDir))
	);
	host.writeFile = (fileName, text) => {
		const absFileName = resolve(fileName);
		if (!absFileName.startsWith(resolvedSrcInOut)) return;
		const rel = absFileName.substring(resolvedSrcInOut.length + 1);
		emitted[rel] = text;
	};

	const rootNames = srcFiles
		.filter((entry) => entry.endsWith('.ts'))
		.map((entry) => resolve(srcDir, entry));

	const { diagnostics } = performCompilation({
		emitFlags: EmitFlags.Default,
		host,
		options,
		rootNames
	});

	const errors = diagnostics.filter(
		(diag: ts.Diagnostic) => diag.category === ts.DiagnosticCategory.Error
	);
	if (errors.length > 0) logAngularErrorsAndExit(errors);

	// Copy emitted JS files to final dir, adding .js extensions to relative imports
	for (const [fileName, content] of Object.entries(emitted)) {
		if (!fileName.endsWith('.js')) continue;
		const processed = addJsExtensions(content);
		// eslint-disable-next-line no-await-in-loop
		await writeFile(join(finalDir, fileName), processed);
	}

	// Clean up temp dir
	await rm(tmpDir, { force: true, recursive: true });
};

const verifyExports = async () => {
	const pkg = await Bun.file('package.json').json();
	const exports: Record<string, { import?: string; types?: string }> =
		pkg.exports ?? {};
	const missing: string[] = [];

	for (const [key, value] of Object.entries(exports)) {
		if (!value.import) continue;
		const importPath = value.import.replace('./', '');
		const importFile = Bun.file(importPath);
		// eslint-disable-next-line no-await-in-loop
		if (!(await importFile.exists()))
			missing.push(`${key} → ${value.import}`);
	}

	if (pkg.main) {
		const mainPath = pkg.main.replace('./', '');
		const mainFile = Bun.file(mainPath);
		if (!(await mainFile.exists())) missing.push(`main → ${pkg.main}`);
	}

	if (missing.length > 0) {
		console.error('\nExport verification failed! Missing files:');
		for (const msg of missing) console.error(`  ${msg}`);
		process.exit(1);
	}
};

build();
