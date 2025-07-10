import { promises as fs } from 'fs';
import { join, basename, sep, dirname } from 'path';
import {
	readConfiguration,
	createCompilerHost,
	performCompilation,
	EmitFlags
} from '@angular/compiler-cli';
import ts from 'typescript';
import { toPascal } from '../utils/stringModifiers';

export const compileAngularFile = async (inputPath: string, outDir: string) => {
	const { options } = readConfiguration('./tsconfig.json');
	options.outDir = outDir;

	const host = createCompilerHost({ options });
	const emitted: Record<string, string> = {};
	host.writeFile = (fileName, text) => {
		emitted[fileName] = text;
	};

	const { diagnostics } = performCompilation({
		emitFlags: EmitFlags.Default,
		host,
		options,
		rootNames: [inputPath]
	});
	if (diagnostics?.length)
		throw new Error(
			diagnostics
				.map((d) =>
					ts.flattenDiagnosticMessageText(d.messageText, '\n')
				)
				.join('\n')
		);

	const pagesDir = join(outDir, 'pages');
	const jsFiles: string[] = [];

	for (const [fileName, content] of Object.entries(emitted)) {
		if (!fileName.endsWith('.js')) continue;

		const target = join(pagesDir, basename(fileName));
		await fs.mkdir(dirname(target), { recursive: true });
		await fs.writeFile(target, content, 'utf-8');
		jsFiles.push(target);
	}

	return jsFiles;
};

export const compileAngular = async (
	entryPoints: string[],
	outRoot: string
) => {
	const compiledRoot = join(outRoot, 'compiled');
	const indexesDir = join(compiledRoot, 'indexes');

	await fs.rm(compiledRoot, { force: true, recursive: true });
	await fs.mkdir(indexesDir, { recursive: true });

	const serverPaths: string[] = [];
	const clientPaths: string[] = [];

	for (const entry of entryPoints) {
		const outputs = await compileAngularFile(entry, compiledRoot);
		const fileBase = basename(entry).replace(/\.[tj]s$/, '');
		const jsName = `${fileBase}.js`;
		const rawServerFile = outputs.find((f) =>
			f.endsWith(`${sep}pages${sep}${jsName}`)
		);
		if (!rawServerFile)
			throw new Error(`Compiled output not found for ${entry}`);

		const original = await fs.readFile(rawServerFile, 'utf-8');
		const rewritten = `${original.replace(
			new RegExp(`templateUrl:\\s*['"]\\.\\/${fileBase}\\.html['"]`),
			`templateUrl: '../../pages/${fileBase}.html'`
		)}\nexport default ${toPascal(fileBase)};\n`;

		await fs.writeFile(rawServerFile, rewritten, 'utf-8');
		serverPaths.push(rawServerFile);

		const className = toPascal(fileBase);
		const importPath = `../pages/${jsName}`;
		const clientFile = join(indexesDir, jsName);
		const hydration = `
import { bootstrapApplication } from '@angular/platform-browser'
import { provideClientHydration } from '@angular/platform-browser'
import { ${className} } from '${importPath}'

bootstrapApplication(${className}, { providers: [provideClientHydration()] })
`.trim();

		await fs.writeFile(clientFile, hydration, 'utf-8');
		clientPaths.push(clientFile);
	}

	return { clientPaths, serverPaths };
};
