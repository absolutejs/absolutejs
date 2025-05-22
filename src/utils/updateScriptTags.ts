// TODO : this script seems to only work after building twice maybe due to the async nature of it

import { readFile, writeFile } from "node:fs/promises";
import { Glob } from "bun";

/**
 * Updates <script> tags in all HTML files within htmlDir.
 * For each script tag whose src file base (with or without a hash) is a key in the manifest,
 * the src attribute is replaced with the new hashed file path.
 *
 * @param manifest - An object mapping script base names to the new file path.
 * @param htmlDir - The directory that contains the HTML files.
 */
export const updateScriptTags = async (
	manifest: Record<string, string>,
	htmlDir: string
) => {
	// Use Glob to find all HTML files in the specified directory
	const htmlGlob = new Glob("*.html");
	const htmlFiles: string[] = [];
	for await (const file of htmlGlob.scan({
		absolute: true,
		cwd: htmlDir
	})) {
		htmlFiles.push(file);
	}

	// Process each HTML file
	for (const filePath of htmlFiles) {
		let content = await readFile(filePath, "utf8");

		// For each script in the manifest, update matching <script> tags
		for (const [scriptName, newPath] of Object.entries(manifest)) {
			// Escape special regex characters in the scriptName
			const escapedScriptName = scriptName.replace(
				/[.*+?^${}()|[\]\\]/g,
				"\\$&"
			);
			// The regex explanation:
			// (1) (<script[^>]+src=["'])  — capture the opening of the script tag up to the src attribute value
			// (2) (\/?(?:.*\\/)?${escapedScriptName}) — capture any preceding path and the base script name
			// (3) (?:\.[^."'/]+)? — optionally capture a dot and hash (if already hashed)
			// (4) (\.js) — then capture the js extension
			// (5) (["'][^>]*>) — capture the closing quote and remainder of the script tag
			const regex = new RegExp(
				`(<script[^>]+src=["'])(\/?(?:.*\\/)?${escapedScriptName})(?:\\.[^."'/]+)?(\\.js)(["'][^>]*>)`,
				"g"
			);
			// Replace the matched src attribute with the new value from the manifest
			content = content.replace(
				regex,
				(_, prefix, _oldBase, _ext, suffix) =>
					`${prefix}${newPath}${suffix}`
			);
		}

		await writeFile(filePath, content, "utf8");
	}
};
