import { readFile, writeFile } from 'node:fs/promises';
import { toPascal } from '../utils/stringModifiers';
import { scanEntryPoints } from './scanEntryPoints';

export const updateHTMLAssetPaths = async (
	manifest: Record<string, string>,
	htmlDir: string
) => {
	const htmlFiles = await scanEntryPoints(htmlDir, '*.html');
	const assetRegex =
		/((?:<script[^>]+src=|<link[^>]*?rel=["']stylesheet["'][^>]*?href=)["'])(\/?(?:.*\/)?)([^./"']+)(?:\.[^."'/]+)?(\.(?:js|ts|css))(["'][^>]*>)/g;

	const tasks = htmlFiles.map(async (filePath) => {
		const original = await readFile(filePath, 'utf8');
		const updated = original.replace(
			assetRegex,
			(match, prefix, _dir, name, ext, suffix) => {
				const key = ext === '.css' ? `${toPascal(name)}CSS` : name;
				const newPath = manifest[key];
				if (newPath) return `${prefix}${newPath}${suffix}`;
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
