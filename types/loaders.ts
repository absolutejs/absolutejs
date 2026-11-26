/** What `defineLoader` returns: the function it was given, held to one
 *  run per request for each distinct set of arguments. */
export type Loader<Args extends unknown[], Result> = (
	...args: Args
) => Promise<Result>;

export type LoadAllOptions = {
	/** `true` lets one entry fail without failing the rest: a failed
	 *  entry's value is a `LoaderError` instead of the call throwing. */
	partial?: boolean;
};

/** The entries `loadAll` takes: a value or a promise per key.
 *
 *  A function is refused, because it is nearly always a loader someone
 *  forgot to call — `{ user: currentUser }` for `{ user: currentUser() }`
 *  — and awaiting a function "succeeds" with the function itself. */
export type LoadAllEntries<Entries> = {
	[Key in keyof Entries]: Entries[Key] extends (...args: never[]) => unknown
		? never
		: Entries[Key];
};

/** What `loadAll` resolves to: each key with its entry's awaited value. */
export type LoadAllResult<Entries> = {
	[Key in keyof Entries]: Awaited<Entries[Key]>;
};

/** What `loadAll(…, { partial: true })` resolves to: each key with its
 *  value, or with `Failure` where that entry rejected. */
export type LoadAllPartialResult<Entries, Failure> = {
	[Key in keyof Entries]: Awaited<Entries[Key]> | Failure;
};
