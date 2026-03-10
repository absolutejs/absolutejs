import type { AngularDeps } from '../../types/angular';
import { patchAngularInjectorSingleton } from './injectorPatch';

const initDominoAdapter = (platformServer: any) => {
	try {
		const DominoAdapter = platformServer.ɵDominoAdapter as
			| { makeCurrent?: () => void }
			| undefined;
		DominoAdapter?.makeCurrent?.();
	} catch (err) {
		console.error('Failed to initialize DominoAdapter:', err);
	}
};

const patchQuerySelectorAll = (headProto: any) => {
	if (!headProto || typeof headProto.querySelectorAll === 'function') {
		return;
	}

	headProto.querySelectorAll = function (sel: string) {
		const doc = this.ownerDocument;
		if (!doc?.querySelectorAll) {
			return [];
		}

		const all = doc.querySelectorAll(sel);
		const self = this;

		return Array.from(all).filter(
			(elm: any) => elm.parentElement === self || self.contains(elm)
		);
	};
};

const patchQuerySelector = (headProto: any) => {
	if (!headProto || typeof headProto.querySelector === 'function') {
		return;
	}

	headProto.querySelector = function (sel: string) {
		const doc = this.ownerDocument;
		if (!doc?.querySelector) {
			return null;
		}

		const elm = doc.querySelector(sel);
		if (elm && (elm.parentElement === this || this.contains(elm))) {
			return elm;
		}

		return null;
	};
};

const patchDominoPrototype = (domino: NonNullable<AngularDeps['domino']>) => {
	if (!domino.createWindow) {
		return;
	}

	try {
		const probeWin = domino.createWindow('', '/');
		const headProto = Object.getPrototypeOf(probeWin.document.head);
		patchQuerySelectorAll(headProto);
		patchQuerySelector(headProto);
	} catch {
		// Probe failed — per-document polyfills will handle it
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
	await import('@angular/compiler');

	// angularPatch imports @angular/platform-server internally, so it
	// must also run after the compiler is available.
	const { applyPatches } = await import('./angularPatch');
	await applyPatches();

	// Now safe to load all Angular packages in parallel
	const [platformBrowser, platformServer, common, core, domino] =
		await Promise.all([
			import('@angular/platform-browser'),
			import('@angular/platform-server'),
			import('@angular/common'),
			import('@angular/core'),
			import('domino' as string).catch(() => null) as Promise<{
				createWindow?: (
					html: string,
					url: string
				) => { document: Document };
			} | null>
		]);

	if (process.env.NODE_ENV !== 'development') {
		core.enableProdMode();
	}

	initDominoAdapter(platformServer);

	// Patch domino's head prototype once — these polyfills fix missing
	// DOM APIs that Angular SSR expects (querySelector, querySelectorAll,
	// children). Applied to the prototype so every domino document
	// inherits them automatically.
	if (domino) {
		patchDominoPrototype(domino);
	}

	return {
		APP_BASE_HREF: common.APP_BASE_HREF,
		bootstrapApplication: platformBrowser.bootstrapApplication,
		domino,
		DomSanitizer: platformBrowser.DomSanitizer,
		provideClientHydration: platformBrowser.provideClientHydration,
		provideServerRendering: platformServer.provideServerRendering,
		provideZonelessChangeDetection: core.provideZonelessChangeDetection,
		renderApplication: platformServer.renderApplication,
		Sanitizer: core.Sanitizer,
		SecurityContext: core.SecurityContext
	};
};

let angularDeps: Promise<AngularDeps> | null = null;

export const getAngularDeps = () => {
	if (!angularDeps) {
		angularDeps = loadAngularDeps();
	}

	return angularDeps;
};
