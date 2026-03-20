import { readFileSync, statSync } from 'node:fs';
import { dirname, extname, resolve, relative } from 'node:path';
import { getTransformed, setTransformed, invalidate } from './transformCache';

const SRC_PREFIX = '/@src/';

const jsTranspiler = new Bun.Transpiler({
	loader: 'js',
	trimUnusedImports: true
});

// Shared transpiler for TypeScript files — trimUnusedImports strips
// type-only imports so the browser doesn't request unnecessary modules
const tsTranspiler = new Bun.Transpiler({
	loader: 'tsx',
	trimUnusedImports: true
});

const TRANSPILABLE = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']);

// Regex to find all export names in original TypeScript source
const ALL_EXPORTS_RE =
	/export\s+(?:type|interface|const|let|var|function|class|enum|abstract\s+class)\s+(\w+)/g;

// After transpilation, type exports are stripped. Inject stubs so
// importing modules can resolve the names (as undefined).
const preserveTypeExports = (
	originalSource: string,
	transpiled: string,
	valueExports: string[]
) => {
	const allExports: string[] = [];
	let match;
	ALL_EXPORTS_RE.lastIndex = 0;
	while ((match = ALL_EXPORTS_RE.exec(originalSource)) !== null) {
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
};

const escapeRegex = (str: string) =>
	str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildImportRewriter = (vendorPaths: Record<string, string>) => {
	const entries = Object.entries(vendorPaths).sort(
		([a], [b]) => b.length - a.length
	);
	if (entries.length === 0) return null;

	const alt = entries.map(([spec]) => escapeRegex(spec)).join('|');
	const lookup = new Map(entries);

	const fromRegex = new RegExp(`(from\\s*["'])(${alt})(["'])`, 'g');
	const sideEffectRegex = new RegExp(
		`(import\\s*["'])(${alt})(["']\\s*;?)`,
		'g'
	);
	const dynamicRegex = new RegExp(
		`(import\\s*\\(\\s*["'])(${alt})(["']\\s*\\))`,
		'g'
	);

	return { dynamicRegex, fromRegex, lookup, sideEffectRegex };
};

const rewriteImports = (
	code: string,
	filePath: string,
	projectRoot: string,
	rewriter: ReturnType<typeof buildImportRewriter>
) => {
	let result = code;

	// Step 1: Rewrite KNOWN vendor specifiers (safe — no false matches
	// because the alternation only matches exact package names).
	if (rewriter) {
		const replacer = (
			_match: string,
			prefix: string,
			specifier: string,
			suffix: string
		) => {
			const webPath = rewriter.lookup.get(specifier);
			if (!webPath) return _match;
			return `${prefix}${webPath}${suffix}`;
		};

		rewriter.fromRegex.lastIndex = 0;
		rewriter.sideEffectRegex.lastIndex = 0;
		rewriter.dynamicRegex.lastIndex = 0;
		result = result.replace(rewriter.fromRegex, replacer);
		result = result.replace(rewriter.sideEffectRegex, replacer);
		result = result.replace(rewriter.dynamicRegex, replacer);
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

	result = result.replace(
		/^(import\s+.+?\s+from\s*["'])([^"'./][^"']*)(["'])/gm,
		stubReplace
	);
	result = result.replace(
		/^(import\s*["'])([^"'./][^"']*)(["'])/gm,
		stubReplace
	);
	result = result.replace(
		/^(export\s+.+?\s+from\s*["'])([^"'./][^"']*)(["'])/gm,
		stubReplace
	);
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
				const extensions = ['.tsx', '.ts', '.jsx', '.js'];
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
			return `${prefix}${SRC_PREFIX}${srcPath.replace(/\\/g, '/')}${suffix}`;
		}
	);

	// Rewrite dynamic relative imports
	result = result.replace(
		/(import\s*\(\s*["'])(\.\.?\/[^"']+)(["']\s*\))/g,
		(_match, prefix, relPath, suffix) => {
			const absPath = resolve(fileDir, relPath);
			const rel = relative(projectRoot, absPath);
			return `${prefix}${SRC_PREFIX}${rel.replace(/\\/g, '/')}${suffix}`;
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
				const extensions = ['.tsx', '.ts', '.jsx', '.js', '.css'];
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
			return `${prefix}${SRC_PREFIX}${srcPath.replace(/\\/g, '/')}${suffix}`;
		}
	);

	// Rewrite absolute filesystem paths (from generated index files that
	// import hmrClient, refreshSetup, etc. via absolute paths)
	result = result.replace(
		/((?:from|import)\s*["'])(\/[^"']+\.(tsx?|jsx?|ts))(["'])/g,
		(_match, prefix, absPath, _ext, suffix) => {
			if (absPath.startsWith(projectRoot)) {
				const rel = relative(projectRoot, absPath).replace(
					/\\/g,
					'/'
				);
				return `${prefix}${SRC_PREFIX}${rel}${suffix}`;
			}
			// Path outside project root (e.g., node_modules package src)
			// Try to make it relative to project root anyway
			const rel = relative(projectRoot, absPath).replace(/\\/g, '/');
			if (!rel.startsWith('..')) {
				return `${prefix}${SRC_PREFIX}${rel}${suffix}`;
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
			new RegExp(
				`export\\s+(?:const|let)\\s+(${comp.name}\\s*=)`
			),
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
	const valueExports = tsTranspiler.scan(raw).exports;
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
	transpiled = transpiled.replace(/\$RefreshReg\$_[a-z0-9]+/g, '$RefreshReg$');
	transpiled = transpiled.replace(/\$RefreshSig\$_[a-z0-9]+/g, '$RefreshSig$');
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

	const transpiler = isTS ? tsTranspiler : jsTranspiler;
	const valueExports = isTS ? transpiler.scan(raw).exports : [];
	let transpiled = transpiler.transformSync(raw);

	if (isTS) {
		transpiled = preserveTypeExports(raw, transpiled, valueExports);
	}

	return rewriteImports(transpiled, filePath, projectRoot, rewriter);
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

export const createModuleServer = (config: ModuleServerConfig) => {
	const { projectRoot, vendorPaths } = config;
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

		if (!pathname.startsWith(SRC_PREFIX)) return undefined;

		const relPath = pathname.slice(SRC_PREFIX.length);
		let filePath = resolve(projectRoot, relPath);
		let ext = extname(filePath);

		// Resolve missing extensions (e.g., /@src/src/pages/Home → Home.tsx)
		if (!ext) {
			const tryExts = ['.tsx', '.ts', '.jsx', '.js'];
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

		try {
			if (ext === '.css') {
				return new Response(handleCssRequest(filePath), {
					headers: {
						'Cache-Control': 'no-cache',
						'Content-Type': 'application/javascript'
					}
				});
			}

			if (!TRANSPILABLE.has(ext)) return undefined;

			// Check transform cache first
			const cached = getTransformed(filePath);
			if (cached) {
				return new Response(cached, {
					headers: {
						'Cache-Control': 'no-cache',
						'Content-Type': 'application/javascript'
					}
				});
			}

			const stat = statSync(filePath);
			let content: string;

			if (REACT_EXTENSIONS.has(ext)) {
				content = transformReactFile(filePath, projectRoot, rewriter);
			} else {
				content = transformPlainFile(filePath, projectRoot, rewriter);
			}

			setTransformed(filePath, content, stat.mtimeMs);

			return new Response(content, {
				headers: {
					'Cache-Control': 'no-cache',
					'Content-Type': 'application/javascript'
				}
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return new Response(
				`console.error('[ModuleServer] Transform error:', ${JSON.stringify(message)});`,
				{
					headers: { 'Content-Type': 'application/javascript' },
					status: 500
				}
			);
		}
	};
};

export const invalidateModule = invalidate;

// Pre-transpile a /@src/ URL and cache the result so the browser
// fetch is instant. Called before sending the WebSocket HMR message.
export const warmCache = (pathname: string) => {
	if (!pathname.startsWith(SRC_PREFIX)) return;
	if (!globalModuleServer) return;
	// Trigger the handler — the result is cached by setTransformed
	globalModuleServer(pathname);
};

// Store the module server handler globally so warmCache can access it
let globalModuleServer: ((pathname: string) => Promise<Response | undefined> | Response | undefined) | null =
	null;

export const setGlobalModuleServer = (
	handler: typeof globalModuleServer
) => {
	globalModuleServer = handler;
};

export const SRC_URL_PREFIX = SRC_PREFIX;
