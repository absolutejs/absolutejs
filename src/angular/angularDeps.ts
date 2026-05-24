import type { AngularDeps } from '../../types/angular';
import { resolveAngularRuntimePath } from './resolveAngularPackage';
import {
	isDevelopmentRuntime,
	isProductionRuntime
} from '../utils/runtimeMode';

const initDominoAdapter = (platformServer: {
	ɵDominoAdapter?: { makeCurrent?: () => void };
}) => {
	try {
		platformServer.ɵDominoAdapter?.makeCurrent?.();
	} catch (err) {
		console.error('Failed to initialize DominoAdapter:', err);
	}
};

const loadAngularDeps = async () => {
	// JIT compiler is only needed in development, where user pages are
	// runtime-compiled by `compileAngularFileJIT` and emit partial
	// declarations that need the compiler facade to link. In production
	// the linker has already processed every partial declaration into
	// final ɵdir/ɵcmp/ɵfac at vendor build time, so the compiler isn't
	// imported and isn't part of the prod vendor bundle.
	if (!isProductionRuntime()) {
		// Bare specifier in dev — Bun's module cache dedupes on
		// normalized specifier, so this is the same instance as the
		// `import "@angular/compiler"` baked into bundled server pages.
		await import('@angular/compiler');
	}

	// angularPatch imports @angular/platform-server internally, so it
	// must also run after the compiler is available.
	const { applyPatches } = await import('./angularPatch');
	await applyPatches();

	// In dev (no Angular server vendor on disk — see §1.1), use bare
	// specifiers so Bun resolves them through node_modules and shares
	// the same module records with the bundled server pages, which
	// also have bare `@angular/*` imports in dev. Production keeps the
	// resolved-path import because the vendor bundle is what every
	// server-side import points at, and the resolved path is stable.
	const useBareSpecifiers = !isProductionRuntime();
	const [platformBrowser, platformServer, common, core] = await Promise.all([
		import(
			useBareSpecifiers
				? '@angular/platform-browser'
				: resolveAngularRuntimePath('@angular/platform-browser')
		),
		import(
			useBareSpecifiers
				? '@angular/platform-server'
				: resolveAngularRuntimePath('@angular/platform-server')
		),
		import(
			useBareSpecifiers
				? '@angular/common'
				: resolveAngularRuntimePath('@angular/common')
		),
		import(
			useBareSpecifiers
				? '@angular/core'
				: resolveAngularRuntimePath('@angular/core')
		)
	]);

	if (!isDevelopmentRuntime()) {
		core.enableProdMode();
	}

	initDominoAdapter(platformServer);

	return {
		APP_BASE_HREF: common.APP_BASE_HREF,
		bootstrapApplication: platformBrowser.bootstrapApplication,
		Component: core.Component,
		DomSanitizer: platformBrowser.DomSanitizer,
		ENVIRONMENT_INITIALIZER: core.ENVIRONMENT_INITIALIZER,
		inject: core.inject,
		InjectionToken: core.InjectionToken,
		NgComponentOutlet: common.NgComponentOutlet,
		provideClientHydration: platformBrowser.provideClientHydration,
		provideServerRendering: platformServer.provideServerRendering,
		provideZonelessChangeDetection: core.provideZonelessChangeDetection,
		reflectComponentType: core.reflectComponentType,
		renderApplication: platformServer.renderApplication,
		REQUEST: core.REQUEST,
		REQUEST_CONTEXT: core.REQUEST_CONTEXT,
		RESPONSE_INIT: core.RESPONSE_INIT,
		Sanitizer: core.Sanitizer,
		SecurityContext: core.SecurityContext,
		withHttpTransferCacheOptions:
			platformBrowser.withHttpTransferCacheOptions
	};
};

let angularDeps: Promise<AngularDeps> | null = null;

export const getAngularDeps = () => {
	if (!angularDeps) {
		angularDeps = loadAngularDeps();
	}

	return angularDeps;
};

// TODO(test): the unit-style coverage in
// `tests/integration/angular/single-core.test.ts` checks that
// `resolveAngularRuntimePath` is consistent across calls and that two
// dynamic imports from the resolved path return the same module record
// — necessary but not sufficient. A stronger test would spawn a dev
// server, trigger an HMR cycle, and assert the SSR process never sees
// two `@angular/core` evaluations (e.g. via a marker incremented at
// module init in a vendor stub). The fixture in
// `tests/fixtures/compile-angular` is wired for compile-time checks
// only, so end-to-end verification of the SSR core uniqueness fix
// happens manually in `~/onspark/absolutejs/dealroom` (see
// docs/ABSOLUTEJS_ANGULAR_HMR.md §3.9).
