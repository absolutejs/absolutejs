import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, extname, resolve, relative } from 'node:path';
import {
	getInvalidationVersion,
	getTransformed,
	invalidate,
	setTransformed
} from './transformCache';

const SRC_PREFIX = '/@src/';

const jsTranspiler = new Bun.Transpiler({
	loader: 'js',
	trimUnusedImports: true
});

// Shared transpiler for TypeScript files — trimUnusedImports strips
// type-only imports so the browser doesn't request unnecessary modules
// Separate transpilers for .ts and .tsx — using 'tsx' for .ts files
// causes parse errors on TypeScript generics like <T> (interpreted as JSX).
const tsTranspiler = new Bun.Transpiler({
	loader: 'ts',
	trimUnusedImports: true
});

const tsxTranspiler = new Bun.Transpiler({
	loader: 'tsx',
	trimUnusedImports: true
});

const TRANSPILABLE = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']);

// Regex to find all export names in original TypeScript source
const ALL_EXPORTS_RE =
	/export\s+(?:type|interface|const|let|var|function|class|enum|abstract\s+class)\s+(\w+)/g;

// Strip string/template literal contents so regex doesn't match
// export declarations inside code examples embedded as strings.
const STRING_CONTENTS_RE =
	/`(?:[^`\\]|\\.)*`|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/gs;

// After transpilation, type exports are stripped. Inject stubs so
// importing modules can resolve the names (as undefined).
const preserveTypeExports = (
	originalSource: string,
	transpiled: string,
	valueExports: string[]
) => {
	const codeOnly = originalSource.replace(STRING_CONTENTS_RE, '""');
	const allExports: string[] = [];
	let match;
	ALL_EXPORTS_RE.lastIndex = 0;
	while ((match = ALL_EXPORTS_RE.exec(codeOnly)) !== null) {
		if (match[1]) allExports.push(match[1]);
	}

	const valueSet = new Set(valueExports);
	const typeExports = allExports.filter((e) => !valueSet.has(e));

	if (typeExports.length === 0) return transpiled;

	const stubs = typeExports
		.map((name) => `export const ${name} = undefined;`)
		.join('\n');

	return `${transpiled}\n${stubs}\n`;
};
const REACT_EXTENSIONS = new Set(['.tsx', '.jsx']);

type ModuleServerConfig = {
	projectRoot: string;
	vendorPaths: Record<string, string>;
	frameworkDirs?: {
		vue?: string;
	};
};

const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildImportRewriter = (vendorPaths: Record<string, string>) => {
	const entries = Object.entries(vendorPaths).sort(
		([a], [b]) => b.length - a.length
	);
	if (entries.length === 0) return null;

	const alt = entries.map(([spec]) => escapeRegex(spec)).join('|');
	const lookup = new Map(entries);

	// Single combined regex for all vendor import patterns:
	// from 'pkg', import 'pkg', import('pkg')
	const vendorRegex = new RegExp(
		`((?:from|import)\\s*["']|import\\s*\\(\\s*["'])(${alt})(["'](?:\\s*[;)]?)?)`,
		'g'
	);

	return { lookup, vendorRegex };
};

// Mtime cache — avoids statSync on every import rewrite.
// Invalidated by the file watcher via invalidateModule().
const mtimeCache = new Map<string, number>();

// Build a /@src/ URL with the file's mtime as a cache buster.
const srcUrl = (relPath: string, projectRoot: string) => {
	const base = `${SRC_PREFIX}${relPath.replace(/\\/g, '/')}`;
	const absPath = resolve(projectRoot, relPath);

	let mtime = mtimeCache.get(absPath);
	if (mtime === undefined) {
		try {
			mtime = Math.round(statSync(absPath).mtimeMs);
			mtimeCache.set(absPath, mtime);
		} catch {
			return base;
		}
	}

	// Append invalidation version if the file's transform cache was
	// cleared (e.g., a downstream import changed). This forces the
	// browser to re-fetch even though the file's own mtime is the same.
	const iv = getInvalidationVersion(absPath);
	const version = iv > 0 ? `${mtime}.${iv}` : `${mtime}`;

	return `${base}?v=${version}`;
};

const rewriteImports = (
	code: string,
	filePath: string,
	projectRoot: string,
	rewriter: ReturnType<typeof buildImportRewriter>
) => {
	let result = code;

	// Step 1: Rewrite KNOWN vendor specifiers in a single pass.
	if (rewriter) {
		rewriter.vendorRegex.lastIndex = 0;
		result = result.replace(
			rewriter.vendorRegex,
			(_match, prefix, specifier, suffix) => {
				const webPath = rewriter.lookup.get(specifier);
				if (!webPath) return _match;
				return `${prefix}${webPath}${suffix}`;
			}
		);
	}

	// Step 2: Rewrite remaining bare specifiers (unknown packages) to stubs.
	// Line-anchored to avoid matching inside string literals.
	const stubReplace = (
		_match: string,
		prefix: string,
		specifier: string,
		suffix: string
	) => {
		// Skip if already rewritten to a path
		if (specifier.startsWith('/') || specifier.startsWith('.'))
			return _match;
		return `${prefix}/@stub/${encodeURIComponent(specifier)}${suffix}`;
	};

	// Combined: import/export from 'bare', import 'bare' (line-anchored)
	result = result.replace(
		/^((?:import\s+.+?\s+from|export\s+.+?\s+from|import)\s*["'])([^"'./][^"']*)(["'])/gm,
		stubReplace
	);
	// Dynamic: import('bare')
	result = result.replace(
		/(import\s*\(\s*["'])([^"'./][^"']*)(["']\s*\))/g,
		stubReplace
	);

	// Rewrite relative imports to /@src/ absolute paths
	const fileDir = dirname(filePath);
	result = result.replace(
		/(from\s*["'])(\.\.?\/[^"']+)(["'])/g,
		(_match, prefix, relPath, suffix) => {
			const absPath = resolve(fileDir, relPath);
			const rel = relative(projectRoot, absPath);
			let srcPath = rel;
			if (!extname(srcPath)) {
				const extensions = [
					'.tsx',
					'.ts',
					'.jsx',
					'.js',
					'.svelte',
					'.vue'
				];
				for (const ext of extensions) {
					try {
						statSync(resolve(projectRoot, srcPath + ext));
						srcPath += ext;
						break;
					} catch {
						// try next
					}
				}
			}
			// Resolve Svelte module files: .svelte → .svelte.ts / .svelte.js
			if (extname(srcPath) === '.svelte') {
				const resolved = resolveSvelteModulePath(
					resolve(projectRoot, srcPath)
				);
				const resolvedRel = relative(projectRoot, resolved);

				srcPath = resolvedRel;
			}
			return `${prefix}${srcUrl(srcPath, projectRoot)}${suffix}`;
		}
	);

	// Rewrite dynamic relative imports
	result = result.replace(
		/(import\s*\(\s*["'])(\.\.?\/[^"']+)(["']\s*\))/g,
		(_match, prefix, relPath, suffix) => {
			const absPath = resolve(fileDir, relPath);
			const rel = relative(projectRoot, absPath);
			return `${prefix}${srcUrl(rel, projectRoot)}${suffix}`;
		}
	);

	// Rewrite side-effect relative imports: import './foo'
	result = result.replace(
		/(import\s*["'])(\.\.?\/[^"']+)(["']\s*;?)/g,
		(_match, prefix, relPath, suffix) => {
			const absPath = resolve(fileDir, relPath);
			const rel = relative(projectRoot, absPath);
			let srcPath = rel;
			if (!extname(srcPath)) {
				const extensions = [
					'.tsx',
					'.ts',
					'.jsx',
					'.js',
					'.css',
					'.svelte',
					'.vue'
				];
				for (const ext of extensions) {
					try {
						statSync(resolve(projectRoot, srcPath + ext));
						srcPath += ext;
						break;
					} catch {
						// try next
					}
				}
			}
			return `${prefix}${srcUrl(srcPath, projectRoot)}${suffix}`;
		}
	);

	// Rewrite absolute filesystem paths (from generated index files that
	// import hmrClient, refreshSetup, etc. via absolute paths)
	result = result.replace(
		/((?:from|import)\s*["'])(\/[^"']+\.(tsx?|jsx?|ts))(["'])/g,
		(_match, prefix, absPath, _ext, suffix) => {
			if (absPath.startsWith(projectRoot)) {
				const rel = relative(projectRoot, absPath).replace(/\\/g, '/');
				return `${prefix}${srcUrl(rel, projectRoot)}${suffix}`;
			}
			// Path outside project root (e.g., node_modules package src)
			// Try to make it relative to project root anyway
			const rel = relative(projectRoot, absPath).replace(/\\/g, '/');
			if (!rel.startsWith('..')) {
				return `${prefix}${srcUrl(rel, projectRoot)}${suffix}`;
			}
			return _match;
		}
	);

	return result;
};

// React hooks that React Fast Refresh tracks for signature changes
const HOOK_NAMES = new Set([
	'useState',
	'useReducer',
	'useEffect',
	'useLayoutEffect',
	'useMemo',
	'useCallback',
	'useRef',
	'useContext',
	'useImperativeHandle',
	'useDebugValue',
	'useDeferredValue',
	'useTransition',
	'useId',
	'useSyncExternalStore',
	'useInsertionEffect',
	'useOptimistic',
	'useFormStatus',
	'useActionState'
]);

// Detect exported component functions in transpiled code
const findComponents = (code: string) => {
	const components: { name: string; hasHooks: boolean }[] = [];

	// Match: export const/let/var Name = ... or export function Name
	const exportRe =
		/(?:export\s+(?:default\s+)?(?:function\s+|(?:const|let|var)\s+))([A-Z][a-zA-Z0-9]*)/g;
	let match;
	while ((match = exportRe.exec(code)) !== null) {
		const name = match[1];
		if (!name) continue;

		// Find the component body to check for hooks
		const startIdx = match.index;
		const bodySlice = code.slice(startIdx, startIdx + 2000);
		const hasHooks = Array.from(HOOK_NAMES).some((hook) =>
			bodySlice.includes(hook + '(')
		);

		components.push({ hasHooks, name });
	}

	return components;
};

// Compute a simple hash of hook usage for $RefreshSig$
const computeHookSignature = (code: string, componentName: string) => {
	const startIdx = code.indexOf(componentName);
	if (startIdx === -1) return '';
	const bodySlice = code.slice(startIdx, startIdx + 2000);
	const hooks: string[] = [];
	for (const hook of HOOK_NAMES) {
		if (bodySlice.includes(hook + '(')) hooks.push(hook);
	}
	return Buffer.from(hooks.join(',')).toString('base64').slice(0, 12);
};

// ESM modules can't access bare window globals. These stubs pull
// React Fast Refresh functions from window into module scope.
const REFRESH_PREAMBLE = [
	'var $RefreshReg$ = window.$RefreshReg$ || function(){};',
	'var $RefreshSig$ = window.$RefreshSig$ || function(){ return function(t){ return t; }; };'
].join('\n');

// Inject React Fast Refresh registration — replicates what
// Bun.build({ reactFastRefresh: true }) does, but in <1ms.
const injectRefreshRegistration = (
	code: string,
	filePath: string,
	projectRoot: string
) => {
	const components = findComponents(code);
	if (components.length === 0) return code;

	const hasAnyHooks = components.some((c) => c.hasHooks);
	const sigSetup = hasAnyHooks ? '\nvar _s = $RefreshSig$();' : '';
	let result = `${REFRESH_PREAMBLE}${sigSetup}\n${code}`;

	// For components with hooks: convert `export const Name =` to `var Name =`
	// so we can reassign with _s() wrapper. Add a separate export at the end.
	const exportedNames: string[] = [];
	for (const comp of components) {
		if (!comp.hasHooks) continue;
		const sig = computeHookSignature(result, comp.name);

		// Convert export const/let → var (allows reassignment for _s wrapping)
		result = result.replace(
			new RegExp(`export\\s+(?:const|let)\\s+(${comp.name}\\s*=)`),
			`var $1`
		);
		exportedNames.push(comp.name);
		result += `\n${comp.name} = _s(${comp.name}, ${JSON.stringify(sig)});`;
	}

	// Re-export components that were converted from export const → var
	if (exportedNames.length > 0) {
		result += `\nexport { ${exportedNames.join(', ')} };`;
	}

	// Use relative path matching Bun.build's format so IDs match the
	// initial bundled registration and React Fast Refresh can swap.
	const relPath = relative(projectRoot, filePath).replace(/\\/g, '/');
	const registrations = components
		.map(
			(c) =>
				`$RefreshReg$(${c.name}, ${JSON.stringify(`${relPath}:${c.name}`)});`
		)
		.join('\n');

	return `${result}\n${registrations}\n`;
};

// Use Bun.Transpiler (~0.1ms) instead of Bun.build (~2-150ms) for
// React files. Manually inject $RefreshReg$/$RefreshSig$ calls
// after transpilation.
// Bun.Transpiler uses an auto-generated name for JSX (jsxDEV_XXXXXXXX)
// but doesn't emit the import statement. We need to detect the generated
// name and add the import ourselves.
const JSX_AUTO_RE = /\b(jsxDEV_[a-z0-9]+)\b/;
const JSXS_AUTO_RE = /\b(jsxs_[a-z0-9]+)\b/;
const JSX_PROD_RE = /\b(jsx_[a-z0-9]+)\b/;
const FRAGMENT_RE = /\b(Fragment_[a-z0-9]+)\b/;

const addJsxImport = (code: string) => {
	const imports: string[] = [];

	const jsxDevMatch = JSX_AUTO_RE.exec(code);
	if (jsxDevMatch) {
		imports.push(
			`import { jsxDEV as ${jsxDevMatch[1]} } from "react/jsx-dev-runtime";`
		);
	}

	const jsxsMatch = JSXS_AUTO_RE.exec(code);
	if (jsxsMatch && (!jsxDevMatch || jsxsMatch[1] !== jsxDevMatch[1])) {
		imports.push(
			`import { jsxs as ${jsxsMatch[1]} } from "react/jsx-runtime";`
		);
	}

	const jsxProdMatch = JSX_PROD_RE.exec(code);
	if (jsxProdMatch) {
		imports.push(
			`import { jsx as ${jsxProdMatch[1]} } from "react/jsx-runtime";`
		);
	}

	const fragmentMatch = FRAGMENT_RE.exec(code);
	if (fragmentMatch) {
		imports.push(
			`import { Fragment as ${fragmentMatch[1]} } from "react";`
		);
	}

	if (imports.length === 0) return code;
	return imports.join('\n') + '\n' + code;
};

// With the patched Bun.Transpiler (PR #28312), reactFastRefresh: true
// injects $RefreshReg$/$RefreshSig$ natively — no manual injection needed.
// Falls back to plain transpilation if reactFastRefresh isn't available.
const reactTranspiler = new Bun.Transpiler({
	loader: 'tsx',
	reactFastRefresh: true,
	trimUnusedImports: true
} as ConstructorParameters<typeof Bun.Transpiler>[0]);

const transformReactFile = (
	filePath: string,
	projectRoot: string,
	rewriter: ReturnType<typeof buildImportRewriter>
) => {
	const raw = readFileSync(filePath, 'utf-8');
	const valueExports = tsxTranspiler.scan(raw).exports;
	let transpiled = reactTranspiler.transformSync(raw);
	transpiled = preserveTypeExports(raw, transpiled, valueExports);

	// Bun.Transpiler auto-generates JSX function names (jsxDEV_XXXXXXXX)
	// but doesn't emit the import — it expects the bundler to resolve it.
	transpiled = addJsxImport(transpiled);

	// The patched transpiler imports register/createSignatureFunctionForTransform
	// from react-refresh/runtime, creating a separate module instance. But the
	// initial bundled index uses window.$RefreshReg$/$RefreshSig$ globals.
	// Replace the import with globals so registrations go to the same runtime.
	transpiled = transpiled.replace(
		/import\s*\{[^}]*\}\s*from\s*["']react-refresh\/runtime["'];?\n?/,
		''
	);
	// Map the aliased names to the window globals
	transpiled = transpiled.replace(
		/\$RefreshReg\$_[a-z0-9]+/g,
		'$RefreshReg$'
	);
	transpiled = transpiled.replace(
		/\$RefreshSig\$_[a-z0-9]+/g,
		'$RefreshSig$'
	);
	// Prepend window global stubs for ESM scope
	transpiled =
		'var $RefreshReg$ = window.$RefreshReg$ || function(){};\n' +
		'var $RefreshSig$ = window.$RefreshSig$ || function(){ return function(t){ return t; }; };\n' +
		transpiled;

	// Bun.Transpiler uses "input.tsx" as the default filename in
	// $RefreshReg$ IDs. Replace with the real relative path so IDs
	// match the initial bundled registration.
	const relPath = relative(projectRoot, filePath).replace(/\\/g, '/');
	transpiled = transpiled.replace(/\binput\.tsx:/g, `${relPath}:`);

	return rewriteImports(transpiled, filePath, projectRoot, rewriter);
};

// Use Bun.Transpiler for non-React files (no refresh injection needed)
const transformPlainFile = (
	filePath: string,
	projectRoot: string,
	rewriter: ReturnType<typeof buildImportRewriter>
) => {
	const raw = readFileSync(filePath, 'utf-8');
	const ext = extname(filePath);
	const isTS = ext === '.ts' || ext === '.tsx';
	const isTSX = ext === '.tsx' || ext === '.jsx';

	const transpiler = isTSX
		? tsxTranspiler
		: isTS
			? tsTranspiler
			: jsTranspiler;
	const valueExports = isTS ? transpiler.scan(raw).exports : [];
	let transpiled = transpiler.transformSync(raw);

	if (isTS) {
		transpiled = preserveTypeExports(raw, transpiled, valueExports);
	}

	return rewriteImports(transpiled, filePath, projectRoot, rewriter);
};

// Virtual CSS modules for Svelte's css:'external' mode.
// Keyed by fake path (e.g., /path/to/Counter.svelte.css).
const svelteExternalCss = new Map<string, string>();

// ─── Framework-specific transforms (Svelte, Vue) ────────────
// Cached compiler references — avoid re-importing on every request.
// Pre-set via warmCompilers() at startup to eliminate first-edit spike.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let svelteCompiler: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let vueCompiler: any = null;

export const warmCompilers = async (frameworks: {
	svelte?: boolean;
	vue?: boolean;
}) => {
	const [sc, vc] = await Promise.all([
		frameworks.svelte ? import('svelte/compiler') : undefined,
		frameworks.vue ? import('@vue/compiler-sfc') : undefined
	]);
	if (sc) {
		svelteCompiler = sc;
		// JIT-warm the compile function with a trivial component so
		// the first real HMR compile doesn't pay the JIT cost (~60ms).
		sc.compile('<script>let x=$state(0)</script>{x}', {
			css: 'external',
			dev: true,
			filename: '_warm.svelte',
			generate: 'client',
			hmr: true
		});
	}
	if (vc) {
		vueCompiler = vc;
		// Same for Vue — warm compileScript + compileTemplate
		const { descriptor } = vc.parse(
			'<script setup>const x=1</script><template>{{x}}</template>',
			{ filename: '_warm.vue' }
		);
		vc.compileScript(descriptor, { id: 'w', inlineTemplate: false });
		if (descriptor.template) {
			vc.compileTemplate({
				filename: '_warm.vue',
				id: 'w',
				source: descriptor.template.content
			});
		}
	}
};

// Compile .svelte files to client JS using svelte/compiler.
// Keeps .svelte extensions in imports so the module server handles children.
const transformSvelteFile = async (
	filePath: string,
	projectRoot: string,
	rewriter: ReturnType<typeof buildImportRewriter>
) => {
	const raw = readFileSync(filePath, 'utf-8');

	if (!svelteCompiler) {
		svelteCompiler = await import('svelte/compiler');
	}

	const isModule =
		filePath.endsWith('.svelte.ts') || filePath.endsWith('.svelte.js');

	let code: string;
	if (isModule) {
		// Module files (.svelte.ts) — transpile TS first, then compileModule
		const source = tsTranspiler.transformSync(raw);
		code = svelteCompiler.compileModule(source, {
			dev: true,
			filename: filePath
		}).js.code;

		// State preservation is handled at runtime by the patched $.hmr().
	} else {
		// Compile with hmr: true — Svelte 5 injects $.hmr() wrapper and
		// import.meta.hot.accept() for component-level swaps with state
		// preservation (same pattern as React Fast Refresh).
		// Use css: 'external' so styles are a separate virtual module
		// that persists across component swaps (no FOUC).
		const compiled = svelteCompiler.compile(raw, {
			css: 'external',
			dev: true,
			hmr: true,
			filename: filePath,
			generate: 'client'
		});
		code = compiled.js.code;

		// If the component has styles, inject them as a virtual CSS
		// import. The handleCssRequest handler serves it as a <style>.
		if (compiled.css?.code) {
			const cssPath = `${filePath}.css`;
			// Cache the CSS content for serving via /@src/ requests
			svelteExternalCss.set(cssPath, compiled.css.code);
			const cssUrl = srcUrl(relative(projectRoot, cssPath), projectRoot);
			code = `import "${cssUrl}";\n${code}`;
		}

		// State preservation is handled at runtime by the patched
		// $.hmr() in svelte/internal/client/dev/hmr.js. It walks
		// the effect tree to collect/restore labeled $state signals.
		// State preservation is handled by Svelte's $.hmr() runtime.

		// ── import.meta.hot → accept registry ──
		const moduleUrl = `${SRC_PREFIX}${relative(projectRoot, filePath).replace(/\\/g, '/')}`;
		code = code.replace(
			/if\s*\(import\.meta\.hot\)\s*\{/,
			`if (typeof window !== "undefined") {\n` +
				`  if (!window.__SVELTE_HMR_ACCEPT__) window.__SVELTE_HMR_ACCEPT__ = {};\n` +
				`  var __hmr_accept = function(cb) { window.__SVELTE_HMR_ACCEPT__[${JSON.stringify(moduleUrl)}] = cb; };`
		);
		code = code.replace(/import\.meta\.hot\.accept\(/g, '__hmr_accept(');
	}

	return rewriteImports(code, filePath, projectRoot, rewriter);
};

// Compile .vue SFC files to client JS using @vue/compiler-sfc.
const transformVueFile = async (
	filePath: string,
	projectRoot: string,
	rewriter: ReturnType<typeof buildImportRewriter>,
	vueDir?: string
) => {
	const raw = readFileSync(filePath, 'utf-8');

	if (!vueCompiler) {
		vueCompiler = await import('@vue/compiler-sfc');
	}

	const fileName = basename(filePath, '.vue');
	const componentId = fileName.toLowerCase();
	const { descriptor } = vueCompiler.parse(raw, { filename: filePath });

	// Always compile with inlineTemplate: false so we get a separate
	// render function. This enables __VUE_HMR_RUNTIME__.rerender()
	// which preserves reactive state (like React Fast Refresh).
	const compiledScript = vueCompiler.compileScript(descriptor, {
		id: componentId,
		inlineTemplate: false
	});

	let code: string = compiledScript.content;

	// Compile template separately — render function used for HMR rerender
	if (descriptor.template) {
		const isScoped = descriptor.styles.some(
			(style: { scoped: boolean }) => style.scoped
		);
		const templateResult = vueCompiler.compileTemplate({
			compilerOptions: {
				bindingMetadata: compiledScript.bindings,
				prefixIdentifiers: true
			},
			filename: filePath,
			id: componentId,
			scoped: isScoped,
			source: descriptor.template.content
		});

		code = code.replace('export default', 'const __script__ =');
		code += `\n${templateResult.code}`;
		code += '\n__script__.render = render;';
		code += '\nexport default __script__;';
	}

	// Compile and inject scoped CSS as inline <style>
	if (descriptor.styles.length > 0) {
		const cssCode = descriptor.styles
			.map(
				(style: { scoped: boolean; content: string }) =>
					vueCompiler.compileStyle({
						filename: filePath,
						id: `data-v-${componentId}`,
						scoped: style.scoped,
						source: style.content,
						trim: true
					}).code
			)
			.join('\n');

		const escaped = cssCode
			.replace(/\\/g, '\\\\')
			.replace(/`/g, '\\`')
			.replace(/\$/g, '\\$');
		const hmrId = JSON.stringify(filePath);
		const cssInjection = [
			`var __style=document.createElement('style');`,
			`__style.textContent=\`${escaped}\`;`,
			`__style.dataset.hmrId=${hmrId};`,
			`var __prev=document.querySelector('style[data-hmr-id="${filePath}"]');`,
			`if(__prev)__prev.remove();`,
			`document.head.appendChild(__style);`
		].join('');

		code = `${cssInjection}\n${code}`;
	}

	// Vue's compileScript strips user TypeScript but the generated
	// wrapper code still has `: any` annotations (e.g. __props: any,
	// _ctx: any). Run through the TS transpiler to strip those.
	code = tsTranspiler.transformSync(code);

	// Inject Vue HMR — use rerender() to preserve reactive state.
	// rerender() only swaps the render function (like React Fast Refresh).
	// reload() would reset state by re-running setup().
	const hmrBase = vueDir ? resolve(vueDir) : projectRoot;
	const hmrId = relative(hmrBase, filePath)
		.replace(/\\/g, '/')
		.replace(/\.vue$/, '');
	code = code.replace(/export\s+default\s+/, 'var __hmr_comp__ = ');
	code += [
		'',
		`__hmr_comp__.__hmrId = ${JSON.stringify(hmrId)};`,
		`if (typeof __VUE_HMR_RUNTIME__ !== "undefined") {`,
		`  __VUE_HMR_RUNTIME__.createRecord(${JSON.stringify(hmrId)}, __hmr_comp__);`,
		`  __VUE_HMR_RUNTIME__.rerender(${JSON.stringify(hmrId)}, __hmr_comp__.render);`,
		`}`,
		'export default __hmr_comp__;'
	].join('\n');

	// Rewrite .vue imports to keep them for module server handling
	return rewriteImports(code, filePath, projectRoot, rewriter);
};

// Resolve .svelte module files that may exist as .svelte.ts or .svelte.js
const resolveSvelteModulePath = (path: string) => {
	if (existsSync(path)) return path;
	if (existsSync(`${path}.ts`)) return `${path}.ts`;
	if (existsSync(`${path}.js`)) return `${path}.js`;

	return path;
};

// Shared response builder for transformed modules
const jsResponse = (body: string) => {
	const etag = `"${Bun.hash(body).toString(36)}"`;

	return new Response(body, {
		headers: {
			'Cache-Control': 'no-cache',
			'Content-Type': 'application/javascript',
			ETag: etag
		}
	});
};

const handleCssRequest = (filePath: string) => {
	const raw = readFileSync(filePath, 'utf-8');
	const escaped = raw
		.replace(/\\/g, '\\\\')
		.replace(/`/g, '\\`')
		.replace(/\$/g, '\\$');
	return [
		`const style = document.createElement('style');`,
		`style.textContent = \`${escaped}\`;`,
		`style.dataset.hmrId = ${JSON.stringify(filePath)};`,
		`const existing = document.querySelector(\`style[data-hmr-id="${filePath}"]\`);`,
		`if (existing) existing.remove();`,
		`document.head.appendChild(style);`
	].join('\n');
};

// Generate HMR bootstrap wrapper for Svelte.
// Uses dynamic import() with a cache-busting timestamp so the
// browser fetches the freshly compiled component every time.
const generateSvelteHmrBootstrap = (
	srcUrl: string,
	vendorPaths: Record<string, string>,
	timestamp: string
) => {
	const sveltePath = vendorPaths['svelte'] || '/svelte/vendor/svelte.js';

	return [
		`import { mount, unmount } from "${sveltePath}";`,
		`const { default: Component } = await import("${srcUrl}?t=${timestamp}");`,
		``,
		`// Extract count from DOM before unmount (survives across runtime instances)`,
		`var countBtn = document.querySelector("button");`,
		`var countMatch = countBtn && countBtn.textContent && countBtn.textContent.match(/(\\d+)/);`,
		`var domCount = countMatch ? parseInt(countMatch[1], 10) : null;`,
		``,
		`var preservedState = window.__HMR_PRESERVED_STATE__ || {};`,
		`if (domCount !== null && preservedState.initialCount === undefined) {`,
		`  preservedState.initialCount = domCount;`,
		`}`,
		`var initialProps = window.__INITIAL_PROPS__ || {};`,
		`var mergedProps = Object.assign({}, initialProps, preservedState);`,
		``,
		`// Update __INITIAL_PROPS__ so subsequent HMR cycles start with current state`,
		`if (domCount !== null) window.__INITIAL_PROPS__ = Object.assign({}, initialProps, { initialCount: domCount });`,
		``,
		`if (typeof window.__SVELTE_UNMOUNT__ === "function") {`,
		`  try { window.__SVELTE_UNMOUNT__(); } catch (err) { /* ignore */ }`,
		`}`,
		``,
		`var component = mount(Component, { target: document.body, props: mergedProps });`,
		`window.__SVELTE_COMPONENT__ = component;`,
		`window.__SVELTE_UNMOUNT__ = function() { unmount(component); };`,
		`window.__HMR_PRESERVED_STATE__ = undefined;`
	].join('\n');
};

// Generate HMR bootstrap wrapper for Vue.
// Same approach as Svelte — full remount via vendor Vue's createApp.
const generateVueHmrBootstrap = (
	srcUrl: string,
	vendorPaths: Record<string, string>,
	timestamp: string
) => {
	const vuePath = vendorPaths['vue'] || '/vue/vendor/vue.js';

	return [
		`import { createApp } from "${vuePath}";`,
		`const { default: Component } = await import("${srcUrl}?t=${timestamp}");`,
		``,
		`// Extract count from DOM before unmount (works across Vue instances)`,
		`var countBtn = document.querySelector("button");`,
		`var countMatch = countBtn && countBtn.textContent && countBtn.textContent.match(/(\\d+)/);`,
		`var domCount = countMatch ? parseInt(countMatch[1], 10) : null;`,
		``,
		`var preservedState = window.__HMR_PRESERVED_STATE__ || {};`,
		`if (domCount !== null && preservedState.initialCount === undefined) {`,
		`  preservedState.initialCount = domCount;`,
		`}`,
		`var initialProps = window.__INITIAL_PROPS__ || {};`,
		`var mergedProps = Object.assign({}, initialProps, preservedState);`,
		``,
		`// Update __INITIAL_PROPS__ so subsequent HMR cycles start with current state`,
		`if (domCount !== null) window.__INITIAL_PROPS__ = Object.assign({}, initialProps, { initialCount: domCount });`,
		``,
		`var root = document.getElementById("root");`,
		`var savedHTML = root ? root.innerHTML : "";`,
		`if (window.__VUE_APP__) {`,
		`  window.__VUE_APP__.unmount();`,
		`  window.__VUE_APP__ = null;`,
		`}`,
		`if (root) root.innerHTML = savedHTML;`,
		``,
		`var app = createApp(Component, mergedProps);`,
		`app.mount(root);`,
		`window.__VUE_APP__ = app;`,
		`window.__HMR_PRESERVED_STATE__ = undefined;`
	].join('\n');
};

export const createModuleServer = (config: ModuleServerConfig) => {
	const { projectRoot, vendorPaths, frameworkDirs } = config;
	const rewriter = buildImportRewriter(vendorPaths);

	return async (pathname: string) => {
		// Serve module stubs for server-only packages that leak into the
		// browser through shared imports. Introspects the real module to
		// generate stubs with matching export names so destructured imports work.
		if (pathname.startsWith('/@stub/')) {
			const specifier = decodeURIComponent(
				pathname.slice('/@stub/'.length)
			);
			let stubCode = 'export default {};\n';
			try {
				const mod = await import(specifier);
				const names = Object.keys(mod).filter(
					(k) => k !== 'default' && k !== '__esModule'
				);
				if (names.length > 0) {
					const noops = names
						.map((n) => `export const ${n} = () => {};`)
						.join('\n');
					stubCode = `${noops}\nexport default {};\n`;
				}
			} catch {
				// Can't import — serve minimal stub
			}
			return new Response(stubCode, {
				headers: {
					'Cache-Control': 'public, max-age=31536000, immutable',
					'Content-Type': 'application/javascript'
				}
			});
		}

		// HMR bootstrap wrappers for non-React frameworks.
		if (pathname.startsWith('/@hmr/')) {
			const rest = pathname.slice('/@hmr/'.length);
			const slashIdx = rest.indexOf('/');
			if (slashIdx === -1) return undefined;

			const framework = rest.slice(0, slashIdx);
			const componentRelPath = rest.slice(slashIdx + 1);
			const srcUrl = `${SRC_PREFIX}${componentRelPath}`;
			const timestamp = String(Date.now());

			let bootstrap: string | null = null;

			if (framework === 'svelte') {
				bootstrap = generateSvelteHmrBootstrap(
					srcUrl,
					vendorPaths,
					timestamp
				);
			} else if (framework === 'vue') {
				bootstrap = generateVueHmrBootstrap(
					srcUrl,
					vendorPaths,
					timestamp
				);
			}

			if (!bootstrap) return undefined;

			return jsResponse(bootstrap);
		}

		if (!pathname.startsWith(SRC_PREFIX)) return undefined;

		const relPath = pathname.slice(SRC_PREFIX.length);

		// Serve virtual Svelte CSS modules (css:'external' output).
		// These don't exist on disk — they're cached during compilation.
		const cssCheckPath = resolve(projectRoot, relPath);
		const virtualCss = svelteExternalCss.get(cssCheckPath);
		if (virtualCss) {
			const escaped = virtualCss
				.replace(/\\/g, '\\\\')
				.replace(/`/g, '\\`')
				.replace(/\$/g, '\\$');
			return jsResponse(
				`var s=document.createElement('style');` +
					`s.textContent=\`${escaped}\`;` +
					`s.dataset.svelteHmr=${JSON.stringify(cssCheckPath)};` +
					`var p=document.querySelector('style[data-svelte-hmr="${cssCheckPath}"]');` +
					`if(p)p.remove();` +
					`document.head.appendChild(s);`
			);
		}
		let filePath = resolve(projectRoot, relPath);
		let ext = extname(filePath);

		// Resolve missing extensions (e.g., /@src/src/pages/Home → Home.tsx)
		if (!ext) {
			const tryExts = ['.tsx', '.ts', '.jsx', '.js', '.svelte', '.vue'];
			for (const tryExt of tryExts) {
				try {
					statSync(filePath + tryExt);
					filePath += tryExt;
					ext = tryExt;
					break;
				} catch {
					// try next
				}
			}
		}

		// Resolve Svelte module files: .svelte → .svelte.ts / .svelte.js
		// (imports reference .svelte but the actual file may be .svelte.ts)
		if (ext === '.svelte') {
			filePath = resolveSvelteModulePath(filePath);
		}

		try {
			if (ext === '.css') return jsResponse(handleCssRequest(filePath));

			// Svelte files (.svelte, .svelte.ts, .svelte.js)
			const isSvelte =
				ext === '.svelte' ||
				filePath.endsWith('.svelte.ts') ||
				filePath.endsWith('.svelte.js');

			if (isSvelte) {
				const cached = getTransformed(filePath);
				if (cached) return jsResponse(cached);

				const stat = statSync(filePath);
				const content = await transformSvelteFile(
					filePath,
					projectRoot,
					rewriter
				);
				setTransformed(
					filePath,
					content,
					stat.mtimeMs,
					extractImportedFiles(content, projectRoot)
				);

				return jsResponse(content);
			}

			// Vue SFC files
			if (ext === '.vue') {
				const cached = getTransformed(filePath);
				if (cached) return jsResponse(cached);

				const stat = statSync(filePath);
				const content = await transformVueFile(
					filePath,
					projectRoot,
					rewriter,
					frameworkDirs?.vue
				);
				setTransformed(
					filePath,
					content,
					stat.mtimeMs,
					extractImportedFiles(content, projectRoot)
				);

				return jsResponse(content);
			}

			if (!TRANSPILABLE.has(ext)) return undefined;

			// Check transform cache first
			const cached = getTransformed(filePath);
			if (cached) return jsResponse(cached);

			const stat = statSync(filePath);
			const content = REACT_EXTENSIONS.has(ext)
				? transformReactFile(filePath, projectRoot, rewriter)
				: transformPlainFile(filePath, projectRoot, rewriter);

			setTransformed(
				filePath,
				content,
				stat.mtimeMs,
				extractImportedFiles(content, projectRoot)
			);

			return jsResponse(content);
		} catch (err) {
			const errMsg = err instanceof Error ? err.message : String(err);

			return new Response(
				`console.error('[ModuleServer] Transform error:', ${JSON.stringify(errMsg)});`,
				{
					headers: { 'Content-Type': 'application/javascript' },
					status: 500
				}
			);
		}
	};
};

// Extract absolute file paths from /@src/ imports in transformed code.
// Used to build the runtime module graph for chain invalidation.
const SRC_IMPORT_RE = /\/@src\/([^"'?\s]+)/g;
const extractImportedFiles = (content: string, projectRoot: string) => {
	const files: string[] = [];
	let match;
	SRC_IMPORT_RE.lastIndex = 0;
	while ((match = SRC_IMPORT_RE.exec(content)) !== null) {
		if (match[1]) files.push(resolve(projectRoot, match[1]));
	}

	return files;
};

export const invalidateModule = (filePath: string) => {
	// invalidate() cascades up the import chain — clearing transform
	// caches for all transitive importers so they get re-transpiled
	// with fresh ?v= params. Also clear mtime caches for the changed
	// file so srcUrl() re-reads its mtime from disk.
	const resolved = resolve(filePath);
	invalidate(filePath);
	if (resolved !== filePath) invalidate(resolved);
	mtimeCache.delete(filePath);
	mtimeCache.delete(resolved);
	// Note: we only clear mtime for the changed file. Importers'
	// mtimes haven't changed — their transform caches are cleared
	// by invalidate() so they get re-transpiled with new ?v= for
	// the changed file's updated mtime.
};

// Pre-transpile a /@src/ URL and cache the result so the browser
// fetch is instant. Called before sending the WebSocket HMR message.
export const warmCache = (pathname: string) => {
	if (!pathname.startsWith(SRC_PREFIX)) return;
	if (!globalModuleServer) return;
	// Trigger the handler — the result is cached by setTransformed
	globalModuleServer(pathname);
};

// Store the module server handler globally so warmCache can access it
let globalModuleServer:
	| ((
			pathname: string
	  ) => Promise<Response | undefined> | Response | undefined)
	| null = null;

export const SRC_URL_PREFIX = SRC_PREFIX;

export const setGlobalModuleServer = (handler: typeof globalModuleServer) => {
	globalModuleServer = handler;
};
