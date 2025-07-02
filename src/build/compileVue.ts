import { mkdir } from 'node:fs/promises';
import { basename, extname, join, relative } from 'node:path';
import {
	parse,
	compileScript,
	compileTemplate,
	compileStyle
} from '@vue/compiler-sfc';
import { file, write } from 'bun';

export const compileVue = async (
	entryPoints: string[],
	outputDirectory: string
) => {
	const pagesDir = join(outputDirectory, 'pages');
	const scriptsDir = join(outputDirectory, 'scripts');
	const stylesDir = join(outputDirectory, 'styles');
	const clientDir = join(outputDirectory, 'client');
	const indexesDir = join(outputDirectory, 'indexes');

	await Promise.all([
		mkdir(pagesDir, { recursive: true }),
		mkdir(scriptsDir, { recursive: true }),
		mkdir(stylesDir, { recursive: true }),
		mkdir(clientDir, { recursive: true }),
		mkdir(indexesDir, { recursive: true })
	]);

	const results = await Promise.all(
		entryPoints.map(async (entry) => {
			const source = await file(entry).text();
			const filename = basename(entry);
			const name = basename(entry, extname(entry));
			const { descriptor } = parse(source, { filename });

			const cssFiles = await Promise.all(
				descriptor.styles.map(async (styleBlock, idx) => {
					const outName =
						descriptor.styles.length === 1
							? `${name}.css`
							: `${name}.${idx}.css`;
					const { code } = compileStyle({
						filename,
						id: name,
						scoped: Boolean(styleBlock.scoped),
						source: styleBlock.content,
						trim: true
					});
					await write(join(stylesDir, outName), code);

					return outName;
				})
			);

			const scriptBlock = compileScript(descriptor, {
				id: name,
				inlineTemplate: false
			});
			const scriptPath = join(scriptsDir, `${name}.ts`);
			const cleanedScript = scriptBlock.content.replace(
				/setup\(\s*__props\s*:\s*any/g,
				'setup(__props'
			);
			await write(scriptPath, cleanedScript);

			const ssrTpl = compileTemplate({
				compilerOptions: {
					bindingMetadata: scriptBlock.bindings,
					prefixIdentifiers: true
				},
				filename,
				id: name,
				source: descriptor.template?.content ?? '',
				ssr: true,
				ssrCssVars: descriptor.cssVars
			});

			const serverImport = `import scriptMod, * as named from '../scripts/${name}.ts';`;
			let ssrCode = ssrTpl.code.replace(
				/(import\s+[^\n]+["']vue\/server-renderer["'][^\n]*\n)/,
				`$1${serverImport}\n`
			);
			if (/import\s*\{[^}]+\}\s*from\s*['"]vue['"]/.test(ssrCode)) {
				ssrCode = ssrCode.replace(
					/import\s*\{([^}]+)\}\s*from\s*['"]vue['"];?/,
					(_, imports) =>
						`import { defineComponent, ${imports.trim()} } from 'vue';`
				);
			} else {
				ssrCode = `import { defineComponent } from 'vue';\n${ssrCode}`;
			}

			const ssrPath = join(pagesDir, `${name}.js`);
			await write(
				ssrPath,
				[
					ssrCode,
					`export default defineComponent({ ...scriptMod, ...named, ssrRender });`
				].join('\n')
			);

			const clientTpl = compileTemplate({
				compilerOptions: {
					bindingMetadata: scriptBlock.bindings,
					cacheHandlers: true,
					hoistStatic: true,
					mode: 'module',
					prefixIdentifiers: true
				},
				filename,
				id: name,
				source: descriptor.template?.content ?? ''
			});

			let clientCode = clientTpl.code;
			const clientImport = `import scriptMod, * as named from '../scripts/${name}.ts'`;
			if (/import\s*\{[^}]+\}\s*from\s*['"]vue['"]/.test(clientCode)) {
				clientCode = clientCode.replace(
					/import\s*\{([^}]+)\}\s*from\s*['"]vue['"];?/,
					(_, imports) =>
						`import { defineComponent, ${imports.trim()} } from 'vue';\n${clientImport}`
				);
			} else {
				clientCode = `import { defineComponent } from 'vue';\n${clientImport}\n${clientCode}`;
			}

			const clientComponentPath = join(clientDir, `${name}.js`);
			await write(
				clientComponentPath,
				[
					clientCode,
					`export default defineComponent({ ...scriptMod, ...named, render })`
				].join('\n')
			);

			const clientIndexPath = join(indexesDir, `${name}.js`);
			await write(
				clientIndexPath,
				[
					`import Comp from '${relative(indexesDir, clientComponentPath)}'`,
					`import { createSSRApp } from 'vue'`,
					`const props = window.__INITIAL_PROPS__ ?? {}`,
					`const app = createSSRApp(Comp, props)`,
					`app.mount('#app')`
				].join('\n')
			);

			return {
				clientIndexPath,
				cssFiles,
				cssKey: `${name}CSS`,
				serverPath: ssrPath
			};
		})
	);

	const vueClientPaths = results.map(
		({ clientIndexPath }) => clientIndexPath
	);
	const vueServerPaths = results.map(({ serverPath }) => serverPath);
	const vueCssPaths = results.reduce<Record<string, string[]>>(
		(acc, { cssKey, cssFiles }) => {
			acc[cssKey] = cssFiles;

			return acc;
		},
		{}
	);

	return { vueClientPaths, vueCssPaths, vueServerPaths };
};
