/* How a SuspenseSlot inside a React Server Component turns its resolved
 * React node into HTML. Classic SSR renders it with react-dom/server, but a
 * server component runs on React's react-server build, where react-dom/server
 * throws on import ("not supported in React Server Components"), so the slot
 * silently kept its fallback. handleReactServerPageRequest provides a
 * renderer for the duration of the Flight render instead: the node goes
 * through Flight and then the build's SSR renderer, the same way the page
 * itself does.
 *
 * The storage sits on globalThis: the slot runs from the page's
 * react-server bundle, the handler from the framework's own module, and
 * each has its copy of this file. No node: imports here, so the slot's
 * module stays importable anywhere. */

export type ReactServerNodeRenderer = (node: unknown) => Promise<string>;

type RendererStorage = {
	getStore: () => unknown;
	run: <Result>(
		store: ReactServerNodeRenderer,
		callback: () => Result
	) => Result;
};

const STORAGE_KEY = Symbol.for('absolutejs.reactServerNodeRendererStorage');

const isRendererStorage = (value: unknown): value is RendererStorage =>
	typeof value === 'object' &&
	value !== null &&
	'getStore' in value &&
	typeof value.getStore === 'function' &&
	'run' in value &&
	typeof value.run === 'function';

const isRenderer = (value: unknown): value is ReactServerNodeRenderer =>
	typeof value === 'function';

const readStorage = () => {
	const storage: unknown = Reflect.get(globalThis, STORAGE_KEY);

	return isRendererStorage(storage) ? storage : undefined;
};

/** The renderer of the React Server Components render in progress, or
 *  undefined outside one (classic SSR). */
export const getReactServerNodeRenderer = () => {
	const store = readStorage()?.getStore();

	return isRenderer(store) ? store : undefined;
};

/** Runs `render` (the Flight render) with `renderer` available to the
 *  SuspenseSlots it renders. `createStorage` makes the AsyncLocalStorage
 *  on first use. */
export const runWithReactServerNodeRenderer = <Result>(
	renderer: ReactServerNodeRenderer,
	createStorage: () => RendererStorage,
	render: () => Result
) => {
	let storage = readStorage();
	if (!storage) {
		storage = createStorage();
		Reflect.set(globalThis, STORAGE_KEY, storage);
	}

	return storage.run(renderer, render);
};
