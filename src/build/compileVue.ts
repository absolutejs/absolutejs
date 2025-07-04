import { mkdir } from 'node:fs/promises';
import { basename, extname, join, relative } from 'node:path';
import {
	parse,
	compileScript,
	compileTemplate,
	compileStyle
} from '@vue/compiler-sfc';
import { file, write } from 'bun';
import { toKebab } from '../utils/stringModifiers';

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
			const kebab = toKebab(name);
			const scopeId = `data-v-${kebab}`;
			const { descriptor } = parse(source, { filename });
			const isScoped = descriptor.styles.some((s) => s.scoped);

			const styleCodes = descriptor.styles.map(
				(styleBlock) =>
					compileStyle({
						filename,
						id: kebab,
						scoped: Boolean(styleBlock.scoped),
						source: styleBlock.content,
						trim: true
					}).code
			);
			const mergedCss = styleCodes.join('\n');
			const mergedName = `${kebab}.css`;
			const mergedPath = join(stylesDir, mergedName);
			await write(mergedPath, mergedCss);

			const scriptBlock = compileScript(descriptor, {
				id: kebab,
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
				id: kebab,
				scoped: isScoped,
				source: descriptor.template?.content ?? '',
				ssr: true,
				ssrCssVars: descriptor.cssVars
			});

			let ssrCode = ssrTpl.code.replace(
				/(import\s+[^\n]+["']vue\/server-renderer["'][^\n]*\n)/,
				`$1import scriptMod, * as named from '../scripts/${name}.ts'\n`
			);
			if (/import\s*\{[^}]+\}\s*from\s*['"]vue['"]/.test(ssrCode)) {
				ssrCode = ssrCode.replace(
					/import\s*\{([^}]+)\}\s*from\s*['"]vue['"];?/,
					(_, imports) =>
						`import { defineComponent, ${imports.trim()} } from 'vue'`
				);
			} else {
				ssrCode = `import { defineComponent } from 'vue'\n${ssrCode}`;
			}

			const ssrPath = join(pagesDir, `${name}.js`);
			await write(
				ssrPath,
				[
					ssrCode,
					`const comp = defineComponent({ ...scriptMod, ...named })`,
					`comp.ssrRender = ssrRender`,
					`comp.__scopeId = '${scopeId}'`,
					`export default comp`
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
				id: kebab,
				scoped: isScoped,
				source: descriptor.template?.content ?? ''
			});

			let clientCode = clientTpl.code;
			if (/import\s*\{[^}]+\}\s*from\s*['"]vue['"]/.test(clientCode)) {
				clientCode = clientCode.replace(
					/import\s*\{([^}]+)\}\s*from\s*['"]vue['"];?/,
					(_, imports) =>
						`import { defineComponent, ${imports.trim()} } from 'vue'\nimport scriptMod, * as named from '../scripts/${name}.ts'`
				);
			} else {
				clientCode = `import { defineComponent } from 'vue'\nimport scriptMod, * as named from '../scripts/${name}.ts'\n${clientCode}`;
			}

			const clientComponentPath = join(clientDir, `${name}.js`);
			await write(
				clientComponentPath,
				[
					clientCode,
					`const comp = defineComponent({ ...scriptMod, ...named, render })`,
					`comp.__scopeId = '${scopeId}'`,
					`export default comp`
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
					`app.mount('#root')`
				].join('\n')
			);

			return {
				clientIndexPath,
				cssPath: mergedPath,
				serverPath: ssrPath
			};
		})
	);

	const vueClientPaths = results.map(
		({ clientIndexPath }) => clientIndexPath
	);
	const vueServerPaths = results.map(({ serverPath }) => serverPath);
	const vueCssPaths = results.map(({ cssPath }) => cssPath);

	return { vueClientPaths, vueCssPaths, vueServerPaths };
};
