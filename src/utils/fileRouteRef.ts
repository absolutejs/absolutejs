/* Which file route the request being handled is for.
 *
 * A route folder's `error` and `not-found` belong to a ROUTE, and the
 * code that renders them is handed a page's name — which for a React
 * page is its component's (`Page`), nothing a route could be found by.
 * So `fileRoutes()` notes the route against the request as it starts
 * serving one, and whatever renders a convention for that request, at
 * any depth, can ask.
 *
 * Noted against the request's own entry in the request storage
 * (`absoluteRequestContext` enters one per request), reached through
 * the storage's global key: this module is bundled into each
 * framework's page handler and must not pull the server in with it. */

const STORAGE_KEY = Symbol.for('absolutejs.requestAsyncLocalStorage');
const MARKS_KEY = Symbol.for('absolutejs.fileRouteOfRequest');

type Marks = WeakMap<object, string>;

const isMarks = (value: unknown): value is Marks => value instanceof WeakMap;

const marks = () => {
	const existing: unknown = Reflect.get(globalThis, MARKS_KEY);
	if (isMarks(existing)) return existing;
	const created: Marks = new WeakMap();
	Reflect.set(globalThis, MARKS_KEY, created);

	return created;
};

const isObject = (value: unknown): value is object =>
	typeof value === 'object' && value !== null;

/* The current request's entry, when there is one and it is something a
 * WeakMap can hold. */
const currentEntry = () => {
	const storage: unknown = Reflect.get(globalThis, STORAGE_KEY);
	if (!isObject(storage)) return undefined;
	const getStore: unknown = Reflect.get(storage, 'getStore');
	if (typeof getStore !== 'function') return undefined;
	const entry: unknown = Reflect.apply(getStore, storage, []);

	return isObject(entry) ? entry : undefined;
};

/** The page name of the file route this request is being served by,
 *  when it is one. */
export const currentFileRoute = () => {
	const entry = currentEntry();

	return entry ? marks().get(entry) : undefined;
};

/** Notes that the current request is being served by the file route
 *  with this page name. Does nothing outside a request. */
export const markCurrentFileRoute = (name: string) => {
	const entry = currentEntry();
	if (entry) marks().set(entry, name);
};
