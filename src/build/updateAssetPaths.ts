import { readFile, writeFile } from 'node:fs/promises';
import { toPascal } from '../utils/stringModifiers';
import { scanEntryPoints } from './scanEntryPoints';

export const updateAssetPaths = async (
	manifest: Record<string, string>,
	directory: string
) => {
	const htmlFiles = await scanEntryPoints(directory, '*.html');
	const assetRegex =
		/((?:<script[^>]+src=|<link[^>]*?rel=["']stylesheet["'][^>]*?href=)["'])(?!\/?(?:.*\/)?htmx\.min\.js)(\/?(?:.*\/)?)([^./"']+)(?:\.[^."'/]+)?(\.(?:js|ts|css))(["'][^>]*>)/g;

	const tasks = htmlFiles.map(async (filePath) => {
		const original = await readFile(filePath, 'utf8');
		const updated = original.replace(
			assetRegex,
			(match, prefix, dir, name, ext, suffix) => {
				const pascal = toPascal(name);

				let key;
				if (ext === '.css') {
					key = `${pascal}CSS`;
				} else if (dir.includes('/indexes/')) {
					key = `${pascal}Index`;
				} else {
					key = pascal;
				}

				const newPath = manifest[key];
				if (newPath) {
					// For script tags (JS/TS), add type="module" if not already present
					// Required because Bun bundles with format: 'esm'
					if (ext === '.js' || ext === '.ts') {
						const hasTypeModule = /type\s*=\s*["']module["']/i.test(match);

						if (!hasTypeModule) {
							// Inject type="module" before the closing >
							const newSuffix = suffix.replace(/>$/, ' type="module">');
							return `${prefix}${newPath}${newSuffix}`;
						}
					}
					return `${prefix}${newPath}${suffix}`;
				}

				console.error(
					`error: no manifest entry for ${ext.slice(1)} "${name}" referenced in ${filePath}`
				);

				return match;
			}
		);
		await writeFile(filePath, updated, 'utf8');
	});

	await Promise.all(tasks);
};
