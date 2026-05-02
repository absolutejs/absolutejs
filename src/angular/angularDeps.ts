import type { AngularDeps } from '../../types/angular';
import { resolveAngularRuntimePath } from './resolveAngularPackage';

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
	if (process.env.NODE_ENV !== 'production') {
		await import(resolveAngularRuntimePath('@angular/compiler'));
	}

	// angularPatch imports @angular/platform-server internally, so it
	// must also run after the compiler is available.
	const { applyPatches } = await import('./angularPatch');
	await applyPatches();

	// Now safe to load all Angular packages in parallel
	const [platformBrowser, platformServer, common, core] = await Promise.all([
		import(resolveAngularRuntimePath('@angular/platform-browser')),
		import(resolveAngularRuntimePath('@angular/platform-server')),
		import(resolveAngularRuntimePath('@angular/common')),
		import(resolveAngularRuntimePath('@angular/core'))
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
