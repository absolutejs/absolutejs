import { readFile, writeFile } from 'node:fs/promises';
import { scanEntryPoints } from './scanEntryPoints';

export const updateScriptTags = async (
	manifest: Record<string, string>,
	htmlDir: string
) => {
	const htmlFiles = await scanEntryPoints(htmlDir, '*.html');

	const tasks = htmlFiles.map(async (filePath) => {
		const original = await readFile(filePath, 'utf8');
		const updated = Object.entries(manifest).reduce(
			(html, [scriptName, newPath]) => {
				const esc = scriptName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
				const regex = new RegExp(
					`(<script[^>]+src=["'])(/?(?:.*/)?${esc})(?:\\.[^."'/]+)?(\\.(?:js|ts))(["'][^>]*>)`,
					'g'
				);

				return html.replace(
					regex,
					(_match, prefix, _oldPath, _ext, suffix) =>
						`${prefix}${newPath}${suffix}`
				);
			},
			original
		);

		await writeFile(filePath, updated, 'utf8');
	});

	await Promise.all(tasks);
};
