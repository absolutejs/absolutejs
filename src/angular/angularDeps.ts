import type { AngularDeps, SsrDepsResult } from '../../types/angular';
import { patchAngularInjectorSingleton } from './injectorPatch';
import { resolveAngularPackage } from './resolveAngularPackage';

const initDominoAdapter = (platformServer: SsrDepsResult['platformServer']) => {
	try {
		const DominoAdapter: { makeCurrent?: () => void } | undefined =
			platformServer.ɵDominoAdapter;
		DominoAdapter?.makeCurrent?.();
	} catch (err) {
		console.error('Failed to initialize DominoAdapter:', err);
	}
};

const loadAngularDeps = async () => {
	// Patch Angular's _currentInjector to use globalThis BEFORE any
	// Angular module is loaded — this prevents NG0203 when Bun's --hot
	// mode creates duplicate module instances during HMR rebuilds.
	patchAngularInjectorSingleton();

	// JIT compiler MUST be fully loaded before any other Angular import.
	// Angular packages like @angular/common contain partially compiled
	// injectables (e.g. PlatformLocation) that need the JIT compiler
	// facade to be registered first.
	await import(resolveAngularPackage('@angular/compiler'));

	// angularPatch imports @angular/platform-server internally, so it
	// must also run after the compiler is available.
	const { applyPatches } = await import('./angularPatch');
	await applyPatches();

	// Now safe to load all Angular packages in parallel
	const [platformBrowser, platformServer, common, core] = await Promise.all([
		import(resolveAngularPackage('@angular/platform-browser')),
		import(resolveAngularPackage('@angular/platform-server')),
		import(resolveAngularPackage('@angular/common')),
		import(resolveAngularPackage('@angular/core'))
	]);

	if (process.env.NODE_ENV !== 'development') {
		core.enableProdMode();
	}

	initDominoAdapter(platformServer);

	return {
		APP_BASE_HREF: common.APP_BASE_HREF,
		bootstrapApplication: platformBrowser.bootstrapApplication,
		DomSanitizer: platformBrowser.DomSanitizer,
		ENVIRONMENT_INITIALIZER: core.ENVIRONMENT_INITIALIZER,
		inject: core.inject,
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
