/* Elysia's server lifecycle across a hot swap (see docs/BACKEND_HMR.md).
 *
 * `app.listen()` runs an app's `setup` hooks once the server is up, and
 * `app.stop()` runs its `cleanup` hooks. A hot swap does neither: the new
 * app takes over the running server through `Bun.serve.reload`. So the swap
 * runs them itself — the replaced app's `cleanup` (including cleanups its
 * setup hooks registered), then the new app's `setup` — exactly as a stop
 * followed by a listen would, minus closing the port. */

type Hook = (app: unknown) => unknown;

const cleanupsRegisteredDuringSetup = new WeakMap<object, Hook[]>();

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
	if (previous && previous !== next) await tearDown(previous);
	await setUp(next);
};
