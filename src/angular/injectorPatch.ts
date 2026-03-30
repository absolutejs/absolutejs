import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

// --- Patch Angular injector singleton for HMR compatibility ---
// Bun's --hot mode can create duplicate Angular module instances during
// HMR rebuilds. Angular's _currentInjector is a module-level variable in
// _not_found-chunk.mjs — when duplicated, R3Injector.get() sets it in
// instance A while the factory's inject() reads from instance B (undefined),
// causing NG0203. This patch stores _currentInjector on globalThis so all
// instances share the same value.

const applyInjectorPatch = (chunkPath: string, content: string) => {
	if (content.includes('Symbol.for("angular.currentInjector")')) {
		return;
	}

	const original = [
		'let _currentInjector = undefined;',
		'function getCurrentInjector() {',
		'  return _currentInjector;',
		'}',
		'function setCurrentInjector(injector) {',
		'  const former = _currentInjector;',
		'  _currentInjector = injector;',
		'  return former;',
		'}'
	].join('\n');

	const replacement = [
		'const _injSym = Symbol.for("angular.currentInjector");',
		'if (!globalThis[_injSym]) globalThis[_injSym] = { v: undefined };',
		'function getCurrentInjector() {',
		'  return globalThis[_injSym].v;',
		'}',
		'function setCurrentInjector(injector) {',
		'  const former = globalThis[_injSym].v;',
		'  globalThis[_injSym].v = injector;',
		'  return former;',
		'}'
	].join('\n');

	const patched = content.replace(original, replacement);

	if (patched === content) {
		return;
	}

	writeFileSync(chunkPath, patched, 'utf-8');
};

const resolveAngularCoreDir = () => {
	const fromProject = resolve(process.cwd(), 'node_modules/@angular/core');

	if (existsSync(join(fromProject, 'package.json'))) {
		return fromProject;
	}

	return dirname(require.resolve('@angular/core/package.json'));
};

export const patchAngularInjectorSingleton = () => {
	try {
		const coreDir = resolveAngularCoreDir();
		const chunkPath = join(coreDir, 'fesm2022', '_not_found-chunk.mjs');
		const content = readFileSync(chunkPath, 'utf-8');
		applyInjectorPatch(chunkPath, content);
	} catch {
		// Non-fatal — HMR may see NG0203 on second+ edits
	}
};

// Apply immediately at module load so the file is patched before any
// Angular module is first evaluated by Bun's --hot mode or linker plugin.
patchAngularInjectorSingleton();
