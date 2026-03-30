import { $ } from 'bun';
import { rm, cp, mkdir, readdir, writeFile } from 'node:fs/promises';
import { join, dirname, basename, resolve, relative } from 'node:path';
import ts from 'typescript';

const DIST = 'dist';

const SERVER_ENTRY_POINTS = [
	'src/index.ts',
	'src/build.ts',
	'src/angular/index.ts',
	'src/react/index.ts',
	'src/react/components/index.ts',
	'src/react/hooks/index.ts',
	'src/svelte/index.ts',
	'src/vue/index.ts',
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

async function build() {
	console.log('Cleaning dist/...');
	await rm(DIST, { recursive: true, force: true });

	console.log('Building server entry points...');
	const serverBuild = await Bun.build({
		entrypoints: SERVER_ENTRY_POINTS,
		outdir: DIST,
		sourcemap: 'linked',
		target: 'bun',
		external: EXTERNALS,
		root: 'src'
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
		outdir: join(DIST, 'react', 'components', 'browser'),
		target: 'browser',
		root: 'src/react/components',
		external: [
			'react',
			'react-dom',
			'react/jsx-runtime',
			'react/jsx-dev-runtime'
		]
	});

	if (!reactBrowserBuild.success) {
		console.error('React browser build failed:');
		for (const log of reactBrowserBuild.logs) console.error(log);
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

	await mkdir(join(DIST, 'dev'), { recursive: true });
	await cp('src/dev/client', join(DIST, 'dev', 'client'), {
		recursive: true
	});

	await mkdir(join(DIST, 'svelte', 'components'), { recursive: true });
	const svelteFiles = await readdir('src/svelte/components');
	for (const file of svelteFiles.filter((f) => f.endsWith('.svelte'))) {
		await cp(
			join('src', 'svelte', 'components', file),
			join(DIST, 'svelte', 'components', file)
		);
	}

	await mkdir(join(DIST, 'vue', 'components'), { recursive: true });
	const vueFiles = await readdir('src/vue/components');
	for (const file of vueFiles.filter((f) => f.endsWith('.vue'))) {
		await cp(
			join('src', 'vue', 'components', file),
			join(DIST, 'vue', 'components', file)
		);
	}

	// Generate .d.ts files for SFC components so consumers get type safety
	console.log('Generating SFC type declarations...');
	await generateSfcDeclarations();

	// Compile Angular components with partial compilation (ɵɵngDeclareComponent)
	// so they work in both AOT (via linker) and JIT (via runtime fallback)
	console.log('Compiling Angular components (partial)...');
	await compileAngularComponentsPartial();

	console.log('Verifying exports...');
	await verifyExports();

	console.log('Build complete.');
}

async function generateSfcDeclarations() {
	// Svelte component declarations
	const svelteComponentDir = join(DIST, 'svelte', 'components');
	const svelteFiles = await readdir(svelteComponentDir);
	for (const file of svelteFiles.filter((f) => f.endsWith('.svelte'))) {
		const content = await Bun.file(join(svelteComponentDir, file)).text();
		const propsMatch = content.match(/\}:\s*(\w+)\s*=\s*\$props\(\)/);
		const propsType = propsMatch?.[1];
		const name = file.replace(/\.svelte$/, '');

		let dts: string;
		if (propsType === 'ImageProps') {
			dts = `import type { ImageProps } from '../../types/image';\nimport { SvelteComponent } from 'svelte';\ndeclare const __propDef: { props: ImageProps };\ntype Props = typeof __propDef.props;\nexport default class ${name} extends SvelteComponent<Props> {}\n`;
		} else if (propsType) {
			dts = `import type { ${propsType} } from '../../types/metadata';\nimport { SvelteComponent } from 'svelte';\ndeclare const __propDef: { props: ${propsType} };\ntype Props = typeof __propDef.props;\nexport default class ${name} extends SvelteComponent<Props> {}\n`;
		} else {
			dts = `import { SvelteComponent } from 'svelte';\nexport default class ${name} extends SvelteComponent {}\n`;
		}
		await writeFile(join(svelteComponentDir, `${file}.d.ts`), dts);
	}

	// Vue component declarations
	const vueComponentDir = join(DIST, 'vue', 'components');
	const vueFiles = await readdir(vueComponentDir);
	for (const file of vueFiles.filter((f) => f.endsWith('.vue'))) {
		const content = await Bun.file(join(vueComponentDir, file)).text();
		const name = file.replace(/\.vue$/, '');

		// Check if it uses defineProps<ImageProps> or inline props
		const hasImageProps =
			content.includes('ImageProps') || content.includes('defineProps<{');
		let dts: string;
		if (name === 'Image' || hasImageProps) {
			dts = `import type { ImageProps } from '../../types/image';\nimport { DefineComponent } from 'vue';\ndeclare const _default: DefineComponent<ImageProps>;\nexport default _default;\n`;
		} else {
			dts = `import { DefineComponent } from 'vue';\ndeclare const _default: DefineComponent;\nexport default _default;\n`;
		}
		await writeFile(join(vueComponentDir, `${file}.d.ts`), dts);
	}
}

async function compileAngularComponentsPartial() {
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
	for (const file of srcFiles.filter((f) => f.endsWith('.ts'))) {
		let content = await Bun.file(
			join('src', 'angular', 'components', file)
		).text();
		content = content.replace(
			/from\s+(['"])\.\.\/\.\.\/utils\/imageProcessing['"]/g,
			'from $1@absolutejs/absolute/image$1'
		);
		await Bun.write(join(srcDir, file), content);
	}

	const config = readConfiguration('./tsconfig.json');
	const options = {
		...config.options,
		compilationMode: 'partial' as const,
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

	const host = ts.createCompilerHost(options);

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
		.filter((f) => f.endsWith('.ts'))
		.map((f) => resolve(srcDir, f));

	const { diagnostics } = performCompilation({
		emitFlags: EmitFlags.Default,
		host,
		options,
		rootNames
	});

	const errors = diagnostics.filter(
		(d: ts.Diagnostic) => d.category === ts.DiagnosticCategory.Error
	);
	if (errors.length > 0) {
		console.error('Angular partial compilation errors:');
		for (const d of errors) {
			console.error(ts.flattenDiagnosticMessageText(d.messageText, '\n'));
		}
		process.exit(1);
	}

	// Copy emitted JS files to final dir, adding .js extensions to relative imports
	for (const [fileName, content] of Object.entries(emitted)) {
		if (!fileName.endsWith('.js')) continue;
		const processed = content.replace(
			/from\s+(['"])(\.\.?\/[^'"]+)(\1)/g,
			(match, quote, path) => {
				if (!path.match(/\.(js|ts|mjs|cjs)$/)) {
					return `from ${quote}${path}.js${quote}`;
				}
				return match;
			}
		);
		await writeFile(join(finalDir, fileName), processed);
	}

	// Clean up temp dir
	await rm(tmpDir, { recursive: true, force: true });
}

async function verifyExports() {
	const pkg = await Bun.file('package.json').json();
	const exports = pkg.exports as Record<
		string,
		{ import?: string; types?: string }
	>;
	const missing: string[] = [];

	for (const [key, value] of Object.entries(exports)) {
		if (value.import) {
			const path = value.import.replace('./', '');
			const file = Bun.file(path);
			if (!(await file.exists())) {
				missing.push(`${key} → ${value.import}`);
			}
		}
	}

	if (pkg.main) {
		const mainPath = pkg.main.replace('./', '');
		const file = Bun.file(mainPath);
		if (!(await file.exists())) {
			missing.push(`main → ${pkg.main}`);
		}
	}

	if (missing.length > 0) {
		console.error('\nExport verification failed! Missing files:');
		for (const m of missing) console.error(`  ${m}`);
		process.exit(1);
	}
}

build();
