import { readFile, writeFile } from "node:fs/promises";
import { Glob } from "bun";

export const updateScriptTags = async (
	manifest: Record<string, string>,
	htmlDir: string
) => {
	const glob = new Glob("*.html");
	const htmlFiles: string[] = [];
	const fileIterator = glob.scan({ absolute: true, cwd: htmlDir });
	for await (const filePath of fileIterator) {
		htmlFiles.push(filePath);
	}

	const tasks = htmlFiles.map(async (filePath) => {
		const original = await readFile(filePath, "utf8");
		const updated = Object.entries(manifest).reduce(
			(html, [scriptName, newPath]) => {
				const esc = scriptName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
				const regex = new RegExp(
					`(<script[^>]+src=["'])(/?(?:.*/)?${esc})(?:\\.[^."'/]+)?(\\.js)(["'][^>]*>)`,
					"g"
				);

				return html.replace(
					regex,
					(_, prefix, __, ___, suffix) =>
						`${prefix}${newPath}${suffix}`
				);
			},
			original
		);

		await writeFile(filePath, updated, "utf8");
	});

	await Promise.all(tasks);
};
