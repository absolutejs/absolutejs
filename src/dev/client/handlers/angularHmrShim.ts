/* `globalThis.__angularHmr` runtime shim.
 *
 * The HMR injection plugin
 * (`src/dev/angular/hmrInjectionPlugin.ts`) appends per-component
 * `__ng_hmr_load` blocks that subscribe via
 * `globalThis.__angularHmr.on('angular:component-update', cb)`.
 * This file installs that bus.
 *
 * It must run before any component chunk does — the injected blocks
 * `if (… && globalThis.__angularHmr.on)` no-op if the shim isn't
 * defined yet, so a registration would silently miss. We keep the
 * shim setup synchronous + at module scope so it's installed during
 * `hmrClient.ts`'s import-evaluation pass, before page chunks load. */

export type AngularHmrEvent =
	| 'angular:component-update'
	| 'angular:component-remount';
export type AngularComponentUpdate = {
	id: string;
	timestamp: number;
};
export type AngularHmrListener = (data: AngularComponentUpdate) => void;

type AngularHmrBus = {
	on(event: AngularHmrEvent, cb: AngularHmrListener): void;
	off(event: AngularHmrEvent, cb: AngularHmrListener): void;
	dispatch(event: AngularHmrEvent, data: AngularComponentUpdate): void;
};

declare global {
	interface Window {
		__angularHmr?: AngularHmrBus;
	}
	// eslint-disable-next-line no-var
	var __angularHmr: AngularHmrBus | undefined;
}

const installAngularHmrShim = (): AngularHmrBus => {
	const listeners = new Map<AngularHmrEvent, Set<AngularHmrListener>>();

	const bus: AngularHmrBus = {
		on(event, cb) {
			let set = listeners.get(event);
			if (!set) {
				set = new Set();
				listeners.set(event, set);
			}
			set.add(cb);
		},
		off(event, cb) {
			listeners.get(event)?.delete(cb);
		},
		dispatch(event, data) {
			const set = listeners.get(event);
			if (!set) return;
			// Snapshot before iterating — handlers could remove themselves.
			for (const cb of [...set]) {
				try {
					cb(data);
				} catch (err) {
					console.error('[absolutejs] angular HMR listener threw', err);
				}
			}
		}
	};

	return bus;
};

if (typeof globalThis !== 'undefined' && !globalThis.__angularHmr) {
	globalThis.__angularHmr = installAngularHmrShim();
}

export const dispatchAngularComponentUpdate = (
	data: AngularComponentUpdate
) => {
	globalThis.__angularHmr?.dispatch('angular:component-update', data);
};

export const dispatchAngularComponentRemount = (
	data: AngularComponentUpdate
) => {
	globalThis.__angularHmr?.dispatch('angular:component-remount', data);
};
