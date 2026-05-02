import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { resolveAngularPackageDir } from './resolveAngularPackage';

/* When `@angular/common` (or any other partial-AOT package) is loaded
   into a runtime that hasn't pre-loaded `@angular/compiler`, its
   top-level `ɵɵngDeclareFactory(...)` calls hit
   `_debug_node-chunk.mjs::getCompilerFacade`, which throws
   "JIT compilation failed" because `globalThis.ng.ɵcompilerFacade`
   isn't set yet.

   The vendor pipeline normally avoids this entirely: every partial
   declaration is fully linked at vendor build time and the runtime
   never needs the compiler. But there are two paths that still load
   raw `@angular/*` from `node_modules` at runtime — direct unit-test
   imports of `dist/angular/*` and the `dist/` chunk graph itself,
   which has static imports through `@angular/platform-browser` that
   transitively pull in `@angular/common` *before* its sibling
   `import "@angular/compiler"` has finished evaluating.

   This patch rewrites `getCompilerFacade` in
   `node_modules/@angular/core/fesm2022/_debug_node-chunk.mjs` to
   self-bootstrap via `require('@angular/compiler')` when the facade
   isn't yet registered, and only falls back to the original
   "compilation failed" error if the require itself fails.

   Idempotent (skips when the marker is already present), and a no-op
   when `@angular/core` isn't installed. Anchored on Angular's source
   so it silently skips if the function shape changes in a future
   minor release. */
const applyCompilerFacadePatch = (chunkPath: string, content: string) => {
	const marker = 'absolutejs.compilerFacadeAutoload';
	if (content.includes(marker)) return;

	const original = [
		'function getCompilerFacade(request) {',
		"  const globalNg = _global['ng'];",
		'  if (globalNg && globalNg.ɵcompilerFacade) {',
		'    return globalNg.ɵcompilerFacade;',
		'  }'
	].join('\n');

	const replacement = [
		'function getCompilerFacade(request) {',
		"  let globalNg = _global['ng'];",
		'  if (globalNg && globalNg.ɵcompilerFacade) {',
		'    return globalNg.ɵcompilerFacade;',
		'  }',
		`  /* ${marker} */`,
		'  try {',
		'    const { createRequire } = globalThis.process?.getBuiltinModule?.("module") ?? require("module");',
		'    const projectRequire = createRequire(globalThis.process.cwd() + "/package.json");',
		'    projectRequire("@angular/compiler");',
		"    globalNg = _global['ng'];",
		'    if (globalNg && globalNg.ɵcompilerFacade) {',
		'      return globalNg.ɵcompilerFacade;',
		'    }',
		'  } catch {',
		'    /* fall through to original error */',
		'  }'
	].join('\n');

	const patched = content.replace(original, replacement);
	if (patched === content) return;
	writeFileSync(chunkPath, patched, 'utf-8');
};

const resolveAngularCoreDir = () => {
	const resolved = resolveAngularPackageDir('@angular/core');

	if (resolved && existsSync(join(resolved, 'package.json'))) {
		return resolved;
	}

	try {
		return dirname(require.resolve('@angular/core/package.json'));
	} catch {
		return null;
	}
};

const tryApplyChunkPatch = (
	chunkPath: string,
	apply: (path: string, content: string) => void
) => {
	if (!existsSync(chunkPath)) return;
	apply(chunkPath, readFileSync(chunkPath, 'utf-8'));
};

export const patchAngularCompilerFacade = () => {
	try {
		const coreDir = resolveAngularCoreDir();
		if (!coreDir) return;
		tryApplyChunkPatch(
			join(coreDir, 'fesm2022', '_debug_node-chunk.mjs'),
			applyCompilerFacadePatch
		);
	} catch {
		// Non-fatal — runtime fallback still throws the original error.
	}
};

patchAngularCompilerFacade();
