/* Wire `globalThis.__absAngularRemount` so the injected
 * `__ng_hmr_remount` blocks (in `hmrInjectionPlugin.ts`) can call into
 * the shared remount implementation. The bundle's listener captures
 * the class via closure and the metadata via dynamic import; everything
 * else is generic, so the implementation is shared rather than baked
 * into every component bundle. */

import { remountComponentClass, type RemountResult } from './angularRemount';

declare global {
	var __absAngularRemount:
		| ((
				Class: new (...args: unknown[]) => unknown,
				applyMetadata: (
					Class: unknown,
					namespaces: unknown[],
					...locals: unknown[]
				) => void,
				namespaces: unknown[],
				locals: unknown[],
				core: {
					createComponent: (
						type: unknown,
						options: {
							hostElement?: Element;
							environmentInjector: unknown;
						}
					) => {
						instance: unknown;
						hostView: {
							_lView?: unknown[];
							detectChanges?: () => void;
						};
						destroy: () => void;
					};
					ApplicationRef?: unknown;
				},
				className: string
		  ) => Promise<RemountResult>)
		| undefined;
}

let installed = false;

export const installAngularRemountGlobal = () => {
	if (installed) return;
	if (typeof globalThis === 'undefined') return;
	globalThis.__absAngularRemount = remountComponentClass;
	installed = true;
};
