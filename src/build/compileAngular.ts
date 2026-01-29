import { promises as fs } from 'fs';
import { join, basename, dirname } from 'path';
import { normalizePath } from '../utils/normalizePath';
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
	if (diagnostics?.length) {
		throw new Error(
			diagnostics
				.map((diagnostic) =>
					ts.flattenDiagnosticMessageText(
						diagnostic.messageText,
						'\n'
					)
				)
				.join('\n')
		);
	}

	const pagesDir = join(outDir, 'pages');
	const entries = Object.entries(emitted)
		.filter(([fileName]) => fileName.endsWith('.js'))
		.map(([fileName, content]) => {
			const target = join(pagesDir, basename(fileName));

			return { content, target };
		});

	await Promise.all(
		entries.map(({ target }) =>
			fs.mkdir(dirname(target), { recursive: true })
		)
	);
	await Promise.all(
		entries.map(({ target, content }) =>
			fs.writeFile(target, content, 'utf-8')
		)
	);

	return entries.map(({ target }) => target);
};

export const compileAngular = async (
	entryPoints: string[],
	outRoot: string
) => {
	const compiledRoot = join(outRoot, 'compiled');
	const indexesDir = join(compiledRoot, 'indexes');

	await fs.rm(compiledRoot, { force: true, recursive: true });
	await fs.mkdir(indexesDir, { recursive: true });

	const compileTasks = entryPoints.map(async (entry) => {
		const outputs = await compileAngularFile(entry, compiledRoot);
		const fileBase = basename(entry).replace(/\.[tj]s$/, '');
		const jsName = `${fileBase}.js`;

		const rawServerFile = outputs.find((f) =>
			normalizePath(f).endsWith(`/pages/${jsName}`)
		);
		if (!rawServerFile) {
			throw new Error(`Compiled output not found for ${entry}`);
		}

		const original = await fs.readFile(rawServerFile, 'utf-8');
		const rewritten = `${original.replace(
			new RegExp(`templateUrl:\\s*['"]\\.\\/${fileBase}\\.html['"]`),
			`templateUrl: '../../pages/${fileBase}.html'`
		)}\nexport default ${toPascal(fileBase)};\n`;
		await fs.writeFile(rawServerFile, rewritten, 'utf-8');

		const className = toPascal(fileBase);
		const clientFile = join(indexesDir, jsName);
		const hydration = `
import { bootstrapApplication } from '@angular/platform-browser';
import { provideClientHydration } from '@angular/platform-browser';
import { ${className} } from '../pages/${jsName}';

bootstrapApplication(${className}, { providers: [provideClientHydration()] });
`.trim();
		await fs.writeFile(clientFile, hydration, 'utf-8');

		return { clientPath: clientFile, serverPath: rawServerFile };
	});

	const results = await Promise.all(compileTasks);
	const serverPaths = results.map((r) => r.serverPath);
	const clientPaths = results.map((r) => r.clientPath);

	return { clientPaths, serverPaths };
};
