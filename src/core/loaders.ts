/* `defineLoader` and `loadAll`: data a page needs, fetched once and
 * together.
 *
 * Two different waits hide in a route's `load`. One is the waterfall:
 * three sources awaited one after another take the sum of their times
 * where they could take the longest. `loadAll` is the fix, and is not
 * much more than `Promise.all` with the keys kept.
 *
 * The other is the repeat, and `Promise.all` does nothing for it: the
 * folder's guard reads the signed-in user to decide whether to let the
 * request through, the route's `load` reads the same user for the page,
 * and a helper two calls down reads it a third time. Each is a query.
 * A loader made with `defineLoader` runs once per request however many
 * places call it — the second caller is handed the first call's promise
 * — so "who is the user" is asked where it is needed rather than fetched
 * at the top and threaded down.
 *
 * A request is the whole lifetime of a held value. Nothing is shared
 * between two requests, which is what makes this safe to use for data
 * that depends on who is asking. */

import { NotFound } from 'elysia';
import type {
	LoadAllEntries,
	LoadAllOptions,
	LoadAllPartialResult,
	LoadAllResult,
	Loader
} from '../../types/loaders';
import {
	type AbsoluteRequestStore,
	getAbsoluteRequestStore
} from './requestContext';

const messageOf = (cause: unknown) =>
	cause instanceof Error ? cause.message : String(cause);

/** A `loadAll` entry that failed, in a call made with `partial: true`.
 *  `key` is the entry's name and `cause` what it rejected with. */
export class LoaderError extends Error {
	readonly key: string;

	constructor(key: string, cause: unknown) {
		super(`The "${key}" entry failed to load: ${messageOf(cause)}`, {
			cause
		});
		this.name = 'LoaderError';
		this.key = key;
	}
}

const isPlainObject = (value: object) => {
	const prototype: unknown = Object.getPrototypeOf(value);

	return prototype === Object.prototype || prototype === null;
};

/* The key two calls must share to be the same call.
 *
 * Written so that a WRONG match is impossible and a missed one merely
 * costs a second run: every kind of value is tagged (`"1"` and `1`
 * differ, as do `null` and `undefined`), object keys are sorted so their
 * order does not matter, and anything whose identity is not its content —
 * a class instance, a `Map`, a function, a symbol — has no key at all.
 * A call with such an argument is never deduplicated. `JSON.stringify`
 * would have been shorter and is wrong in exactly those places: it
 * writes a `Map` as `{}` and `undefined` in an array as `null`. */
const wrapKeys = (open: string, keys: (string | undefined)[], close: string) =>
	keys.every((key) => key !== undefined)
		? `${open}${keys.join(',')}${close}`
		: undefined;

const fieldKey = (name: string, key: string | undefined) =>
	key === undefined ? undefined : `${JSON.stringify(name)}:${key}`;

const keyOfValue = (value: unknown): string | undefined => {
	if (value === null) return 'null';
	if (value === undefined) return 'undefined';
	if (typeof value === 'string') return JSON.stringify(value);
	if (typeof value === 'number') return `n${String(value)}`;
	if (typeof value === 'boolean') return `b${String(value)}`;
	if (typeof value === 'bigint') return `i${String(value)}`;
	if (value instanceof Date) return `d${String(value.getTime())}`;
	if (Array.isArray(value)) return wrapKeys('[', value.map(keyOfValue), ']');
	if (typeof value !== 'object' || !isPlainObject(value)) return undefined;
	const names = Object.keys(value).sort();

	return wrapKeys(
		'{',
		names.map((name) =>
			fieldKey(name, keyOfValue(Reflect.get(value, name)))
		),
		'}'
	);
};

/* `async`, so a loader that throws before its first `await` rejects like
 * one that throws after it: every caller gets a promise either way. */
const start = async <Args extends unknown[], Result>(
	load: (...args: Args) => Promise<Result>,
	args: Args
) => load(...args);

/** Wraps a function that loads data so that it runs once per request.
 *
 * Call the result wherever the data is needed — a guard, a route's
 * `load`, a helper, a component rendering on the server. The first call
 * in a request runs the function; every later call with the same
 * arguments is handed that call's promise, a failed one included.
 *
 * Arguments are compared by content: strings, numbers, booleans, `null`,
 * `undefined`, bigints, dates, and arrays and plain objects of those. A
 * call given anything else (a class instance, a `Map`, a function) is
 * not held and runs every time, as does any call made outside a request
 * — at build time from `entries()`, in a script, in a test. */
export const defineLoader = <Args extends unknown[], Result>(
	load: (...args: Args) => Promise<Result>
) => {
	/* Per loader, keyed by the request's store: typed without a cast,
	 * and collected with the request, so nothing has to clear it. */
	const held = new WeakMap<
		AbsoluteRequestStore,
		Map<string, Promise<Result>>
	>();
	const resultsFor = (store: AbsoluteRequestStore) => {
		const existing = held.get(store);
		if (existing) return existing;
		const created = new Map<string, Promise<Result>>();
		held.set(store, created);

		return created;
	};
	const loader: Loader<Args, Result> = (...args) => {
		const store = getAbsoluteRequestStore();
		const key = store ? keyOfValue(args) : undefined;
		if (!store || key === undefined) return start(load, args);
		const results = resultsFor(store);
		const existing = results.get(key);
		if (existing) return existing;
		const started = start(load, args);
		results.set(key, started);

		return started;
	};

	return loader;
};

/* Not failures: a `NotFound` or a thrown `Response` is the entry
 * answering the request — render the not-found page, go to /login — and
 * `partial` exists to tolerate a source being down, not to swallow that. */
const isAnswer = (reason: unknown) =>
	reason instanceof NotFound || reason instanceof Response;

const assertNotFunction = (key: string, value: unknown) => {
	if (typeof value !== 'function') return;
	throw new TypeError(
		`loadAll() was given a function for "${key}". Pass what it returns — \`${key}: ${value.name || 'loader'}()\` — or every entry would "load" instantly and resolve to the function itself.`
	);
};

const settledValue = (key: string, outcome: PromiseSettledResult<unknown>) => {
	if (outcome.status === 'fulfilled') return outcome.value;
	if (isAnswer(outcome.reason)) throw outcome.reason;

	return new LoaderError(key, outcome.reason);
};

/** Waits for every entry at once and returns them under the same keys.
 *
 *     const { user, stats } = await loadAll({
 *         user: currentUser(),
 *         stats: stats()
 *     });
 *
 * The entries are already running when this is called — it is the
 * waiting that happens together — so the time taken is the slowest
 * entry's, not the sum.
 *
 * If an entry rejects, this rejects with that entry's own error,
 * untouched, so a `NotFound` thrown by a loader still renders the
 * not-found page. With `{ partial: true }` a failed entry's value is a
 * `LoaderError` instead and the others are returned as usual; a
 * `NotFound` or a thrown `Response` is still thrown, since those answer
 * the request rather than report a failure. */
export function loadAll<Entries extends Record<string, unknown>>(
	entries: LoadAllEntries<Entries>,
	options: LoadAllOptions & { partial: true }
): Promise<LoadAllPartialResult<Entries, LoaderError>>;
export function loadAll<Entries extends Record<string, unknown>>(
	entries: LoadAllEntries<Entries>,
	options?: LoadAllOptions & { partial?: false }
): Promise<LoadAllResult<Entries>>;
export async function loadAll(
	entries: Record<string, unknown>,
	options: LoadAllOptions = {}
) {
	const pairs = Object.entries(entries);
	pairs.forEach(([key, value]) => assertNotFunction(key, value));
	const keys = pairs.map(([key]) => key);
	const pending = pairs.map(([, value]) => value);
	if (options.partial !== true) {
		const values = await Promise.all(pending);

		return Object.fromEntries(
			keys.map((key, index) => [key, values[index]])
		);
	}
	const outcomes = await Promise.allSettled(pending);

	return Object.fromEntries(
		outcomes.map((outcome, index) => {
			const key = keys[index] ?? '';

			return [key, settledValue(key, outcome)];
		})
	);
}
