/* Inject HMR client script into HTML
   The actual client code lives in src/dev/client/ and is compiled by buildHMRClient.ts.
   This module only handles injecting the small <script> tag and framework-specific setup. */

/* Full HTML injection for HTML/HTMX pages (read from disk, regex-based) */
export function injectHMRClient(
	html: string,
	framework?: string | null
): string {
	// Guard: Don't inject if HMR script is already present (prevents double connection)
	if (html.includes('data-hmr-client')) {
		return html;
	}

	const headScripts = getHMRHeadScripts(framework || '');
	const bodyScripts = getHMRBodyScripts(framework || '');

	const headOpenRegex = /<head(?:\s[^>]*)?>/i;
	const bodyRegex = /<\/body\s*>/i;
	const headOpenMatch = headOpenRegex.exec(html);
	let result = html;

	if (headScripts && headOpenMatch !== null) {
		const insertPos = headOpenMatch.index + headOpenMatch[0].length;
		result =
			result.slice(0, insertPos) + headScripts + result.slice(insertPos);
	}

	const bodyMatch = bodyRegex.exec(result);
	if (bodyMatch !== null) {
		result =
			result.slice(0, bodyMatch.index) +
			bodyScripts +
			result.slice(bodyMatch.index);
	} else {
		result = result + bodyScripts;
	}

	return result;
}

/* Returns <head> scripts for HMR: React refresh stub + import map (React only) */
export function getHMRHeadScripts(framework: string): string {
	if (framework !== 'react') return '';

	const reactRefreshStub = `<script data-hmr-react-refresh-stub>
(function(){var g=typeof globalThis!=='undefined'?globalThis:window;
g.$RefreshSig$=g.$RefreshSig$||function(){return function(t){return t;}};
g.$RefreshReg$=g.$RefreshReg$||function(){};
g.$RefreshRuntime$=g.$RefreshRuntime$||{};})();
</script>`;

	const importMap = `
    <script type="importmap" data-hmr-import-map>
      {"imports":{"react":"https://esm.sh/react@19.2.1?dev","react/jsx-dev-runtime":"https://esm.sh/react@19.2.1/jsx-dev-runtime?dev","react/jsx-runtime":"https://esm.sh/react@19.2.1/jsx-runtime?dev","react-dom":"https://esm.sh/react-dom@19.2.1?dev","react-dom/client":"https://esm.sh/react-dom@19.2.1/client?dev","react-refresh/runtime":"https://esm.sh/react-refresh@0.18/runtime?dev"}}
    </script>
    <script type="module" data-react-refresh-setup>
      import RefreshRuntime from 'react-refresh/runtime';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshRuntime$ = RefreshRuntime;
      window.$RefreshReg$ = function(type, id) {
        RefreshRuntime.register(type, id);
      };
      window.$RefreshSig$ = function() {
        return RefreshRuntime.createSignatureFunctionForTransform();
      };
    </script>
  `;

	return reactRefreshStub + importMap;
}

/* Returns <body> scripts for HMR: framework global + external client script tag */
export function getHMRBodyScripts(framework: string): string {
	const frameworkScript =
		framework && /^[a-z]+$/.test(framework)
			? `<script>window.__HMR_FRAMEWORK__="${framework}";</script>`
			: '';

	const clientScript =
		'<script src="/__hmr-client.js" data-hmr-client></script>';

	return frameworkScript + clientScript;
}
