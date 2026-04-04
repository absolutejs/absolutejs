import { BASE_36_RADIX, UNFOUND_INDEX } from '../constants';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, extname, resolve, relative } from 'node:path';
import { resolvePackageImport } from '../build/resolvePackageImport';
import { buildIslandMetadataExports } from '../islands/sourceMetadata';
import { lowerSvelteIslandSyntax } from '../svelte/lowerIslandSyntax';
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
	const typeExports = allExports.filter((exp) => !valueSet.has(exp));

	if (typeExports.length === 0) return transpiled;

	const stubs = typeExports
		.map((name) => `export const ${name} = undefined;`)
		.join('\n');

	return `${transpiled}\n${stubs}\n`;
};
// Try known extensions to resolve an extensionless path. Returns
// the original path if none match (existsSync-based probing).
const resolveRelativeExtension = (
	srcPath: string,
	projectRoot: string,
	extensions: string[]
) => {
	const found = extensions.find((ext) =>
		existsSync(resolve(projectRoot, srcPath + ext))
	);

	return found ? srcPath + found : srcPath;
};

const IMPORT_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js', '.svelte', '.vue'];
const SIDE_EFFECT_EXTENSIONS = [
	'.tsx',
	'.ts',
	'.jsx',
	'.js',
	'.css',
	'.svelte',
	'.vue'
];
const MODULE_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js', '.svelte', '.vue'];
const RESOLVED_MODULE_EXTENSIONS = new Set([
	...IMPORT_EXTENSIONS,
	...SIDE_EFFECT_EXTENSIONS,
	'.mjs',
	'.css'
]);

const REACT_EXTENSIONS = new Set(['.tsx', '.jsx']);

type ModuleServerConfig = {
	projectRoot: string;
	vendorPaths: Record<string, string>;
	frameworkDirs?: {
		angular?: string;
		react?: string;
		svelte?: string;
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

// Append invalidation version if the file's transform cache was
// cleared (e.g., a downstream import changed). This forces the
// browser to re-fetch even though the file's own mtime is the same.
const buildVersion = (mtime: number, absPath: string) => {
	const invalidationVersion = getInvalidationVersion(absPath);

	return invalidationVersion > 0
		? `${mtime}.${invalidationVersion}`
		: `${mtime}`;
};

// Build a /@src/ URL with the file's mtime as a cache buster.
const srcUrl = (relPath: string, projectRoot: string) => {
	const base = `${SRC_PREFIX}${relPath.replace(/\\/g, '/')}`;
	const absPath = resolve(projectRoot, relPath);

	const cached = mtimeCache.get(absPath);
	if (cached !== undefined)
		return `${base}?v=${buildVersion(cached, absPath)}`;

	try {
		const mtime = Math.round(statSync(absPath).mtimeMs);
		mtimeCache.set(absPath, mtime);

		return `${base}?v=${buildVersion(mtime, absPath)}`;
	} catch {
		return base;
	}
};

// Resolve a relative import specifier to a /@src/ URL path.
// Probes known extensions, resolves .svelte module files.
const resolveRelativeImport = (
	relPath: string,
	fileDir: string,
	projectRoot: string,
	extensions: string[]
) => {
	const absPath = resolve(fileDir, relPath);
	const rel = relative(projectRoot, absPath);
	const extension = extname(rel);
	let srcPath = RESOLVED_MODULE_EXTENSIONS.has(extension)
		? rel
		: resolveRelativeExtension(rel, projectRoot, extensions);

	// Resolve Svelte module files: .svelte → .svelte.ts / .svelte.js
	if (extname(srcPath) === '.svelte') {
		srcPath = relative(
			projectRoot,
			resolveSvelteModulePath(resolve(projectRoot, srcPath))
		);
	}

	return srcUrl(srcPath, projectRoot);
};

// Resolve @absolutejs/absolute/* specifiers to project-relative paths.
// Returns the relative path string on success, or undefined if resolution fails.
const resolveAbsoluteSpecifier = (specifier: string, projectRoot: string) => {
	try {
		const target =
			resolvePackageImport(specifier, ['browser', 'import']) ??
			Bun.resolveSync(specifier, projectRoot);

		return relative(projectRoot, target);
	} catch {
		// Resolution failed — caller falls through to stub
		return undefined;
	}
};

const rewriteImports = (
	code: string,
	filePath: string,
	projectRoot: string,
	rewriter: ReturnType<typeof buildImportRewriter>
) => {
	let result = code;

	// Step 1: Rewrite KNOWN vendor specifiers in a single pass.
	const vendorReplace = (
		_match: string,
		prefix: string,
		specifier: string,
		suffix: string
	) => {
		const webPath = rewriter?.lookup.get(specifier);

		return webPath ? `${prefix}${webPath}${suffix}` : _match;
	};

	if (rewriter) {
		rewriter.vendorRegex.lastIndex = 0;
		result = result.replace(rewriter.vendorRegex, vendorReplace);
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

		// Serve @absolutejs/absolute client-safe exports as real modules
		// instead of stubbing them — they contain Image/Head/JsonLd components
		// needed for client-side hydration.
		if (!specifier.startsWith('@absolutejs/absolute/'))
			return `${prefix}/@stub/${encodeURIComponent(specifier)}${suffix}`;

		const resolved = resolveAbsoluteSpecifier(specifier, projectRoot);
		if (resolved) {
			return `${prefix}${srcUrl(resolved, projectRoot)}${suffix}`;
		}

		return `${prefix}/@stub/${encodeURIComponent(specifier)}${suffix}`;
	};

	// Combined: import/export from 'bare', import 'bare' (line-anchored)
	// Uses [\s\S]+? to match multi-line imports (e.g., import {\n  foo\n} from 'pkg')
	result = result.replace(
		/^((?:import\s+[\s\S]+?\s+from|export\s+[\s\S]+?\s+from|import)\s*["'])([^"'./][^"']*)(["'])/gm,
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
		(_match, prefix, relPath, suffix) =>
			`${prefix}${resolveRelativeImport(relPath, fileDir, projectRoot, IMPORT_EXTENSIONS)}${suffix}`
	);

	// Rewrite dynamic relative imports
	result = result.replace(
		/(import\s*\(\s*["'])(\.\.?\/[^"']+)(["']\s*\))/g,
		(_match, prefix, relPath, suffix) =>
			`${prefix}${resolveRelativeImport(relPath, fileDir, projectRoot, IMPORT_EXTENSIONS)}${suffix}`
	);

	// Rewrite side-effect relative imports: import './foo'
	result = result.replace(
		/(import\s*["'])(\.\.?\/[^"']+)(["']\s*;?)/g,
		(_match, prefix, relPath, suffix) =>
			`${prefix}${resolveRelativeImport(relPath, fileDir, projectRoot, SIDE_EFFECT_EXTENSIONS)}${suffix}`
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

	// Rewrite new URL('./relative', import.meta.url) for web workers / assets
	result = result.replace(
		/new\s+URL\(\s*["'](\.\.?\/[^"']+)["']\s*,\s*import\.meta\.url\s*\)/g,
		(_match, relPath) => {
			const absPath = resolve(fileDir, relPath);
			const rel = relative(projectRoot, absPath);

			return `new URL('${srcUrl(rel, projectRoot)}', import.meta.url)`;
		}
	);

	// Rewrite import.meta.resolve('./relative') for asset/worker references
	result = result.replace(
		/import\.meta\.resolve\(\s*["'](\.\.?\/[^"']+)["']\s*\)/g,
		(_match, relPath) => {
			const absPath = resolve(fileDir, relPath);
			const rel = relative(projectRoot, absPath);

			return `'${srcUrl(rel, projectRoot)}'`;
		}
	);

	return result;
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

	return `${imports.join('\n')}\n${code}`;
};

// With the patched Bun.Transpiler (PR #28312), reactFastRefresh: true
// injects $RefreshReg$/$RefreshSig$ natively — no manual injection needed.
// Falls back to plain transpilation if reactFastRefresh isn't available.
// reactFastRefresh is available via patched Bun (PR #28312) but not
// yet in the upstream type definitions, so we extend the options type.
const reactTranspilerOptions: ConstructorParameters<
	typeof Bun.Transpiler
>[0] & {
	reactFastRefresh?: boolean;
} = {
	loader: 'tsx',
	reactFastRefresh: true,
	trimUnusedImports: true
};
const reactTranspiler = new Bun.Transpiler(reactTranspilerOptions);

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
		`var $RefreshReg$ = window.$RefreshReg$ || function(){};\n` +
		`var $RefreshSig$ = window.$RefreshSig$ || function(){ return function(t){ return t; }; };\n${
			transpiled
		}`;

	// Bun.Transpiler uses "input.tsx" as the default filename in
	// $RefreshReg$ IDs. Replace with the real relative path so IDs
	// match the initial bundled registration.
	const relPath = relative(projectRoot, filePath).replace(/\\/g, '/');
	transpiled = transpiled.replace(/\binput\.tsx:/g, `${relPath}:`);
	transpiled += buildIslandMetadataExports(raw);

	return rewriteImports(transpiled, filePath, projectRoot, rewriter);
};

// Use Bun.Transpiler for non-React files (no refresh injection needed)
const transformPlainFile = (
	filePath: string,
	projectRoot: string,
	rewriter: ReturnType<typeof buildImportRewriter>,
	vueDir?: string
) => {
	const raw = readFileSync(filePath, 'utf-8');
	const ext = extname(filePath);
	const isTS = ext === '.ts' || ext === '.tsx';
	const isTSX = ext === '.tsx' || ext === '.jsx';

	let transpiler = jsTranspiler;
	if (isTSX) transpiler = tsxTranspiler;
	else if (isTS) transpiler = tsTranspiler;
	const valueExports = isTS ? transpiler.scan(raw).exports : [];
	let transpiled = transpiler.transformSync(raw);

	if (isTS) {
		transpiled = preserveTypeExports(raw, transpiled, valueExports);
	}

	transpiled = rewriteImports(transpiled, filePath, projectRoot, rewriter);

	// Vue composable HMR state tracking: wrap exported use* functions
	// so ref values are captured and restored across HMR reloads.
	if (!vueDir || !filePath.startsWith(vueDir) || !isTS) return transpiled;

	const useExports = valueExports.filter((e) => e.startsWith('use'));
	if (useExports.length === 0) return transpiled;

	return injectComposableTracking(transpiled, filePath, useExports);
};

// Classify a character for brace-counting: returns the new string
// context and whether to skip further processing.
const classifyChar = (
	char: string,
	prevChar: string,
	inString: string | false
): { nextString: string | false; skip: boolean } => {
	if (inString) {
		const closed = char === inString && prevChar !== '\\';

		return { nextString: closed ? false : inString, skip: true };
	}
	if (char === '"' || char === "'" || char === '`')
		return { nextString: char, skip: true };

	return { nextString: false, skip: false };
};

// Find the end of a function expression by counting braces/parens,
// skipping string literals. Returns the index of the trailing ';'.
const findFunctionEnd = (source: string, startPos: number) => {
	let depth = 0;
	let inString: string | false = false;
	for (let idx = startPos; idx < source.length; idx++) {
		const char = source[idx] ?? '';
		const classified = classifyChar(char, source[idx - 1] ?? '', inString);
		inString = classified.nextString;
		if (classified.skip) continue;

		if (char === '{' || char === '(') depth++;
		if (char === '}' || char === ')') depth--;
		if (depth === 0 && char === ';') return idx;
	}

	return startPos;
};

/** Inject HMR state tracking into Vue composable exports.
 *  Wraps each use* export to capture/restore ref values across reloads. */
const injectComposableTracking = (
	code: string,
	filePath: string,
	useExports: string[]
) => {
	const moduleId = JSON.stringify(filePath);

	// Inject the tracking runtime at the top
	const runtime = [
		`var __hmr_cs = (globalThis.__HMR_COMPOSABLE_STATE__ ??= {});`,
		`var __hmr_mid = ${moduleId};`,
		`var __hmr_prev_refs = __hmr_cs[__hmr_mid];`,
		`var __hmr_idx = {};`,
		`__hmr_cs[__hmr_mid] = {};`,
		`function __hmr_wrap(name, fn) {`,
		`  return function() {`,
		`    var idx = (__hmr_idx[name] = (__hmr_idx[name] ?? -1) + 1);`,
		`    var result = fn.apply(this, arguments);`,
		`    if (result && typeof result === "object") {`,
		`      var refs = {};`,
		`      for (var k in result) {`,
		`        var v = result[k];`,
		`        if (v && typeof v === "object" && "value" in v && !v.effect && typeof v.value !== "function") {`,
		`          refs[k] = v;`,
		`        }`,
		`      }`,
		`      (__hmr_cs[__hmr_mid][name] ??= [])[idx] = refs;`,
		`      if (__hmr_prev_refs && __hmr_prev_refs[name] && __hmr_prev_refs[name][idx]) {`,
		`        var old = __hmr_prev_refs[name][idx];`,
		`        for (var k in old) {`,
		`          var nv = result[k];`,
		`          var ov = old[k];`,
		`          if (nv && ov && typeof nv === "object" && "value" in nv && !nv.effect && typeof nv.value === typeof ov.value) {`,
		`            nv.value = ov.value;`,
		`          }`,
		`        }`,
		`      }`,
		`    }`,
		`    return result;`,
		`  };`,
		`}`
	].join('\n');

	let result = `${runtime}\n${code}`;

	// Wrap each use* export with __hmr_wrap.
	// Find the export assignment, then use brace/paren counting to locate
	// the end of the function expression (handles nested braces in the body).
	for (const name of useExports) {
		result = wrapComposableExport(result, name);
	}

	return result;
};

// Find and wrap a single use* export with __hmr_wrap().
const wrapComposableExport = (source: string, name: string) => {
	const marker = new RegExp(
		`export\\s+(?:const|var|let)\\s+${name}\\s*=\\s*`
	);
	const match = marker.exec(source);
	if (!match) return source;

	const insertPos = match.index + match[0].length;
	const endPos = findFunctionEnd(source, insertPos);
	const funcBody = source.slice(insertPos, endPos);

	return `${source.slice(0, insertPos)}__hmr_wrap(${JSON.stringify(name)}, ${funcBody})${source.slice(endPos)}`;
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
	const [svelteModule, vueModule] = await Promise.all([
		frameworks.svelte ? import('svelte/compiler') : undefined,
		frameworks.vue ? import('@vue/compiler-sfc') : undefined
	]);
	if (svelteModule) {
		svelteCompiler = svelteModule;
		// JIT-warm the compile function with a trivial component so
		// the first real HMR compile doesn't pay the JIT cost (~60ms).
		svelteModule.compile('<script>let x=$state(0)</script>{x}', {
			css: 'external',
			dev: true,
			filename: '_warm.svelte',
			generate: 'client',
			hmr: true
		});
	}
	if (!vueModule) return;

	vueCompiler = vueModule;
	// Same for Vue — warm compileScript + compileTemplate
	const { descriptor } = vueModule.parse(
		'<script setup>const x=1</script><template>{{x}}</template>',
		{ filename: '_warm.vue' }
	);
	vueModule.compileScript(descriptor, { id: 'w', inlineTemplate: false });
	if (!descriptor.template) return;

	vueModule.compileTemplate({
		filename: '_warm.vue',
		id: 'w',
		source: descriptor.template.content
	});
};

// Compile a .svelte.ts module file — transpile TS, then compileModule.
const compileSvelteModule = (raw: string, filePath: string) => {
	const source = tsTranspiler.transformSync(raw);

	return svelteCompiler.compileModule(source, {
		dev: true,
		filename: filePath
	}).js.code;
};

// Compile a .svelte component file — hmr: true, css: 'external'.
const compileSvelteComponent = (
	raw: string,
	filePath: string,
	projectRoot: string,
	enableAsync = false
) => {
	const compiled = svelteCompiler.compile(raw, {
		css: 'external',
		dev: true,
		experimental: {
			async: enableAsync
		},
		filename: filePath,
		generate: 'client',
		hmr: true
	});
	let { code } = compiled.js;

	// If the component has styles, inject them as a virtual CSS
	// import. The handleCssRequest handler serves it as a <style>.
	if (compiled.css?.code) {
		const cssPath = `${filePath}.css`;
		svelteExternalCss.set(cssPath, compiled.css.code);
		const cssUrl = srcUrl(relative(projectRoot, cssPath), projectRoot);
		code = `import "${cssUrl}";\n${code}`;
	}

	// ── import.meta.hot → accept registry ──
	const moduleUrl = `${SRC_PREFIX}${relative(projectRoot, filePath).replace(/\\/g, '/')}`;
	code = code.replace(
		/if\s*\(import\.meta\.hot\)\s*\{/,
		`if (typeof window !== "undefined") {\n` +
			`  if (!window.__SVELTE_HMR_ACCEPT__) window.__SVELTE_HMR_ACCEPT__ = {};\n` +
			`  var __hmr_accept = function(cb) { window.__SVELTE_HMR_ACCEPT__[${JSON.stringify(moduleUrl)}] = cb; };`
	);

	return code.replace(/import\.meta\.hot\.accept\(/g, '__hmr_accept(');
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
	const loweredSource = isModule
		? { code: raw, transformed: false }
		: lowerSvelteIslandSyntax(raw, 'client');
	const source = loweredSource.code;

	const code = isModule
		? compileSvelteModule(source, filePath)
		: compileSvelteComponent(
				source,
				filePath,
				projectRoot,
				loweredSource.transformed
			);

	return rewriteImports(code, filePath, projectRoot, rewriter);
};

type VueSFCDescriptor = {
	styles: Array<{ content: string; scoped: boolean }>;
	template?: { content: string } | null;
};

type VueSFCCompiledScript = {
	bindings: Record<string, string>;
	content: string;
};

// Compile a Vue SFC template and attach the render function to the script.
const compileVueTemplate = (
	descriptor: VueSFCDescriptor,
	compiledScript: VueSFCCompiledScript,
	filePath: string,
	componentId: string
) => {
	const scriptContent = compiledScript.content;
	if (!descriptor.template) return scriptContent;

	const isScoped = descriptor.styles.some((style) => style.scoped);
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

	let code = scriptContent.replace('export default', 'const __script__ =');
	code += `\n${templateResult.code}`;
	code += '\n__script__.render = render;';
	code += '\nexport default __script__;';

	return code;
};

// Compile and inject scoped CSS as inline <style> for a Vue SFC.
const compileVueStyles = (
	descriptor: VueSFCDescriptor,
	filePath: string,
	componentId: string,
	code: string
) => {
	if (descriptor.styles.length === 0) return code;

	const cssCode = descriptor.styles
		.map(
			(style) =>
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

	return `${cssInjection}\n${code}`;
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

	const compiledScript = vueCompiler.compileScript(descriptor, {
		id: componentId,
		inlineTemplate: false
	});

	let code = compileVueTemplate(
		descriptor,
		compiledScript,
		filePath,
		componentId
	);
	code = compileVueStyles(descriptor, filePath, componentId, code);

	// Vue's compileScript strips user TypeScript but the generated
	// wrapper code still has `: any` annotations (e.g. __props: any,
	// _ctx: any). Run through the TS transpiler to strip those.
	code = tsTranspiler.transformSync(code);

	// Inject Vue HMR — use rerender() to preserve reactive state.
	// rerender() only swaps the render function (like React Fast Refresh).
	// reload() would reset state by re-running setup().
	code = injectVueHmr(code, filePath, projectRoot, vueDir);

	return rewriteImports(code, filePath, projectRoot, rewriter);
};

// Inject Vue HMR runtime registration and rerender call.
const injectVueHmr = (
	code: string,
	filePath: string,
	projectRoot: string,
	vueDir?: string
) => {
	const hmrBase = vueDir ? resolve(vueDir) : projectRoot;
	const hmrId = relative(hmrBase, filePath)
		.replace(/\\/g, '/')
		.replace(/\.vue$/, '');
	let result = code.replace(/export\s+default\s+/, 'var __hmr_comp__ = ');
	result += [
		'',
		`__hmr_comp__.__hmrId = ${JSON.stringify(hmrId)};`,
		`if (typeof __VUE_HMR_RUNTIME__ !== "undefined") {`,
		`  __VUE_HMR_RUNTIME__.createRecord(${JSON.stringify(hmrId)}, __hmr_comp__);`,
		`  __VUE_HMR_RUNTIME__.rerender(${JSON.stringify(hmrId)}, __hmr_comp__.render);`,
		`}`,
		'export default __hmr_comp__;'
	].join('\n');

	return result;
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
	const etag = `"${Bun.hash(body).toString(BASE_36_RADIX)}"`;

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
	moduleUrl: string,
	vendorPaths: Record<string, string>,
	timestamp: string
) => {
	const sveltePath = vendorPaths['svelte'] || '/svelte/vendor/svelte.js';

	return [
		`import { mount, unmount } from "${sveltePath}";`,
		`const { default: Component } = await import("${moduleUrl}?t=${timestamp}");`,
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
	moduleUrl: string,
	vendorPaths: Record<string, string>,
	timestamp: string
) => {
	const vuePath = vendorPaths['vue'] || '/vue/vendor/vue.js';

	return [
		`import { createApp } from "${vuePath}";`,
		`const { default: Component } = await import("${moduleUrl}?t=${timestamp}");`,
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

// Generate a stub module for a server-only package so browser imports resolve.
const handleStubRequest = async (pathname: string) => {
	const specifier = decodeURIComponent(pathname.slice('/@stub/'.length));
	const stubCode = await buildStubCode(specifier);

	return new Response(stubCode, {
		headers: {
			'Cache-Control': 'no-cache',
			'Content-Type': 'application/javascript'
		}
	});
};

// Introspect a module's exports and generate noop stubs for each.
const buildStubCode = async (specifier: string) => {
	try {
		const mod = await import(specifier);
		const names = Object.keys(mod).filter(
			(key) => key !== 'default' && key !== '__esModule'
		);
		if (names.length === 0) return 'export default {};\n';

		const noops = names
			.map((n) => `export const ${n} = () => {};`)
			.join('\n');

		return `${noops}\nexport default {};\n`;
	} catch {
		return 'export default {};\n';
	}
};

// Handle HMR bootstrap wrappers for non-React frameworks.
const handleHmrBootstrap = (
	pathname: string,
	vendorPaths: Record<string, string>
) => {
	const rest = pathname.slice('/@hmr/'.length);
	const slashIdx = rest.indexOf('/');
	if (slashIdx === UNFOUND_INDEX) return undefined;

	const framework = rest.slice(0, slashIdx);
	const componentRelPath = rest.slice(slashIdx + 1);
	const url = `${SRC_PREFIX}${componentRelPath}`;
	const timestamp = String(Date.now());

	const generators: Record<string, typeof generateSvelteHmrBootstrap> = {
		svelte: generateSvelteHmrBootstrap,
		vue: generateVueHmrBootstrap
	};
	const generate = generators[framework];
	if (!generate) return undefined;

	return jsResponse(generate(url, vendorPaths, timestamp));
};

// Serve a virtual Svelte CSS module (css:'external' output).
const handleVirtualSvelteCss = (cssCheckPath: string) => {
	const virtualCss = svelteExternalCss.get(cssCheckPath);
	if (!virtualCss) return undefined;

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
};

// Resolve a /@src/ path to an absolute file path and extension,
// probing known extensions if the path has none.
const resolveSourcePath = (relPath: string, projectRoot: string) => {
	const filePath = resolve(projectRoot, relPath);
	const ext = extname(filePath);

	if (ext === '.svelte')
		return { ext, filePath: resolveSvelteModulePath(filePath) };
	if (ext) return { ext, filePath };

	// No extension — probe known extensions
	const found = MODULE_EXTENSIONS.find((candidate) =>
		existsSync(filePath + candidate)
	);
	if (!found) return { ext, filePath };

	const resolved = filePath + found;
	if (found === '.svelte')
		return { ext: found, filePath: resolveSvelteModulePath(resolved) };

	return { ext: found, filePath: resolved };
};

// Transform and cache a source file, returning a JS Response.
const transformAndCache = async (
	filePath: string,
	ext: string,
	projectRoot: string,
	rewriter: ReturnType<typeof buildImportRewriter>,
	vueDir?: string
) => {
	if (ext === '.css') return jsResponse(handleCssRequest(filePath));

	const isSvelte =
		ext === '.svelte' ||
		filePath.endsWith('.svelte.ts') ||
		filePath.endsWith('.svelte.js');

	const cached = getTransformed(filePath);
	if (cached) return jsResponse(cached);

	if (isSvelte)
		return transformAndCacheSvelte(filePath, projectRoot, rewriter);
	if (ext === '.vue')
		return transformAndCacheVue(filePath, projectRoot, rewriter, vueDir);
	if (!TRANSPILABLE.has(ext)) return undefined;

	const stat = statSync(filePath);
	const resolvedVueDir = vueDir ? resolve(vueDir) : undefined;
	const content = REACT_EXTENSIONS.has(ext)
		? transformReactFile(filePath, projectRoot, rewriter)
		: transformPlainFile(filePath, projectRoot, rewriter, resolvedVueDir);

	setTransformed(
		filePath,
		content,
		stat.mtimeMs,
		extractImportedFiles(content, projectRoot)
	);

	return jsResponse(content);
};

const transformAndCacheSvelte = async (
	filePath: string,
	projectRoot: string,
	rewriter: ReturnType<typeof buildImportRewriter>
) => {
	const stat = statSync(filePath);
	const content = await transformSvelteFile(filePath, projectRoot, rewriter);
	setTransformed(
		filePath,
		content,
		stat.mtimeMs,
		extractImportedFiles(content, projectRoot)
	);

	return jsResponse(content);
};

const transformAndCacheVue = async (
	filePath: string,
	projectRoot: string,
	rewriter: ReturnType<typeof buildImportRewriter>,
	vueDir?: string
) => {
	const stat = statSync(filePath);
	const content = await transformVueFile(
		filePath,
		projectRoot,
		rewriter,
		vueDir
	);
	setTransformed(
		filePath,
		content,
		stat.mtimeMs,
		extractImportedFiles(content, projectRoot)
	);

	return jsResponse(content);
};

// Build a transform-error response for the browser console.
const transformErrorResponse = (err: unknown) => {
	const errMsg = err instanceof Error ? err.message : String(err);

	return new Response(
		`console.error('[ModuleServer] Transform error:', ${JSON.stringify(errMsg)});`,
		{
			headers: { 'Content-Type': 'application/javascript' },
			status: 500
		}
	);
};

export const createModuleServer = (config: ModuleServerConfig) => {
	const { projectRoot, vendorPaths, frameworkDirs } = config;
	const rewriter = buildImportRewriter(vendorPaths);

	return async (pathname: string) => {
		if (pathname.startsWith('/@stub/')) return handleStubRequest(pathname);
		if (pathname.startsWith('/@hmr/'))
			return handleHmrBootstrap(pathname, vendorPaths);
		if (!pathname.startsWith(SRC_PREFIX)) return undefined;

		const relPath = pathname.slice(SRC_PREFIX.length);

		const virtualCssResponse = handleVirtualSvelteCss(
			resolve(projectRoot, relPath)
		);
		if (virtualCssResponse) return virtualCssResponse;

		const { filePath, ext } = resolveSourcePath(relPath, projectRoot);

		try {
			return await transformAndCache(
				filePath,
				ext,
				projectRoot,
				rewriter,
				frameworkDirs?.vue
			);
		} catch (err) {
			return transformErrorResponse(err);
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
