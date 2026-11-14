/* Elysia's server lifecycle across a hot swap (see docs/BACKEND_HMR.md).
 *
 * `app.listen()` runs an app's `setup` hooks once the server is up, and
 * `app.stop()` runs its `cleanup` hooks (registered with `onStart` and
 * `onStop`; Elysia keeps them under those names). A hot swap does neither:
 * the new app takes over the running server through `Bun.serve.reload`. So
 * the swap runs them itself — the replaced app's `cleanup` (including cleanups its
 * setup hooks registered), then the new app's `setup` — exactly as a stop
 * followed by a listen would, minus closing the port.
 *
 * Only when the hooks changed, though. An app's `onStop` is usually its
 * shutdown: it closes the database pool, the audit log, the queues — values
 * that unchanged top-level statements created and that the new app keeps
 * (statements that did not change keep their values). Running it on every
 * swap left the new app holding closed resources. So hooks are treated like
 * statements: when the new app's setup and cleanup hooks are the same code
 * as the replaced app's, what they started carries across the swap and
 * neither runs. When any of them was added, removed or edited, the old app
 * is stopped and the new one started, so a start and its stop stay paired. */

export type Hook = (app: unknown) => unknown;

// On globalThis: the app that listened and the app that replaces it can be
// handled by different bundles' copies of this module.
const cleanupsRegisteredDuringSetup = (globalThis.__absoluteHotSetupCleanups ??=
	new WeakMap<object, Hook[]>());

const hooksOf = (app: object, kind: 'cleanup' | 'setup') => {
	const ext: unknown = Reflect.get(app, '~ext');
	if (typeof ext !== 'object' || ext === null) return [];
	const hooks: unknown = Reflect.get(ext, kind);

	return Array.isArray(hooks)
		? hooks.filter((hook): hook is Hook => typeof hook === 'function')
		: [];
};

const runHooks = async (app: object, hooks: Hook[], phase: string) =>
	hooks.reduce<Promise<void>>(
		(previous, hook) =>
			previous.then(async () => {
				try {
					await hook(app);
				} catch (error) {
					console.error(
						`[hmr] an Elysia ${phase} hook failed:`,
						error
					);
				}
			}),
		Promise.resolve()
	);

/** Run `next`'s setup hooks, collecting cleanups they register (Elysia
 *  attaches those to the listen that ran setup; there is none here). */
const setUp = async (next: object) => {
	const ext: unknown = Reflect.get(next, '~ext');
	const collected: Hook[] = [];
	const restore =
		typeof ext === 'object' && ext !== null
			? Reflect.get(ext, 'cleanupEpoch')
			: undefined;
	if (typeof ext === 'object' && ext !== null)
		Reflect.set(ext, 'cleanupEpoch', (hook: unknown) => {
			if (typeof hook === 'function') collected.push((app) => hook(app));
			else if (Array.isArray(hook))
				for (const item of hook)
					if (typeof item === 'function')
						collected.push((app) => item(app));

			return true;
		});
	try {
		await runHooks(next, hooksOf(next, 'setup'), 'setup');
	} finally {
		if (typeof ext === 'object' && ext !== null)
			Reflect.set(ext, 'cleanupEpoch', restore);
	}
	cleanupsRegisteredDuringSetup.set(next, collected);
};

/* A hook's identity across versions is its code: every version creates new
 * closures, so the functions themselves always differ. */
const hookSignature = (app: object) =>
	(['setup', 'cleanup'] as const)
		.map((kind) =>
			hooksOf(app, kind)
				.map((hook) => Function.prototype.toString.call(hook))
				.sort()
				.join('\u0000')
		)
		.join('\u0001');

const tearDown = async (previous: object) => {
	const registered = cleanupsRegisteredDuringSetup.get(previous) ?? [];
	cleanupsRegisteredDuringSetup.delete(previous);
	await runHooks(
		previous,
		[...registered, ...hooksOf(previous, 'cleanup')],
		'cleanup'
	);
};

/** The app that just started serving through `listen()`. */
export const adoptListeningApp = (app: object) => {
	globalThis.__absoluteLiveApp = app;
};

/** Hand the running server from the live app to `next`. */
export const swapApp = async (next: object) => {
	const previous = globalThis.__absoluteLiveApp;
	globalThis.__absoluteLiveApp = next;
	if (previous === next) return;
	if (previous && hookSignature(previous) === hookSignature(next)) {
		// Same hooks: the started state carries, including any cleanups the
		// replaced app's setup registered, which the new app now owns.
		cleanupsRegisteredDuringSetup.set(
			next,
			cleanupsRegisteredDuringSetup.get(previous) ?? []
		);
		cleanupsRegisteredDuringSetup.delete(previous);

		return;
	}
	if (previous) await tearDown(previous);
	await setUp(next);
};
