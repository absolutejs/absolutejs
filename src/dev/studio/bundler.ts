import { compileSvelte } from '../../build/compileSvelte';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

// Cached compilation
let builtAppHtml: string | null = null;
let builtAppJs: string | null = null;

const studioTemplate = `
<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Absolute Studio</title>
	<base href="/__absolute_studio/" />
</head>
<body>
	<div id="app"></div>
	<!-- ABSOLUTE_STUDIO_INJECT -->
</body>
</html>
`;

export const getStudioAppHtml = async (): Promise<string> => {
    if (builtAppHtml) return builtAppHtml;

    try {
        // Use Absolute's Svelte compiler to build the studio
        // Note: compileSvelte primarily emits JS files.
        // For the studio, we just need the JS to mount the App.svelte.

        const uiDir = resolve(import.meta.dir, 'ui');
        const appSveltePath = join(uiDir, 'App.svelte');

        if (!existsSync(appSveltePath)) {
            return 'Studio UI source not found at ' + appSveltePath;
        }

        // Compile the single app file.
        // Svelte compiler in Absolute returns paths to built artifacts
        const { svelteClientPaths, svelteIndexPaths } = await compileSvelte(
            [appSveltePath],
            join(process.cwd(), '.absolutejs', 'studio-build'),
            new Map(),
            false
        );

        if (svelteIndexPaths.length > 0 && svelteIndexPaths[0]) {
            // Svelte compiler from Absolute returns an index.js file inside svelteIndexPaths
            // We can use that one since it already contains the mount bootstrapping
            const indexJsPath = svelteIndexPaths[0];
            const clientJs = readFileSync(indexJsPath, 'utf-8');

            // Simple bootstrap logic for the studio app
            const mountScript = `
				<script type="module">
					${clientJs
                    .replace(/from\s+['"]svelte['"]/g, 'from "https://esm.sh/svelte@5.35.2"')
                    .replace(/(import|from)\s+['"]svelte\/([^'"]+)['"]/g, '$1 "https://esm.sh/svelte@5.35.2/$2"')
                    .replace(/import Component from\s+['"][^'"]+['"]/g, 'import Component from "/__absolute_studio/App.js"')}
				</script>
			`;

            builtAppHtml = studioTemplate.replace('<!-- ABSOLUTE_STUDIO_INJECT -->', mountScript);
            return builtAppHtml;
        }

        return 'Failed to compile Studio UI';
    } catch (e) {
        console.error('Studio compilation error', e);
        return `Error compiling Studio UI: ${String(e)}`;
    }
};
