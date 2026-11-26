/** One object in a page store, as `list` reports it. */
export type PageStoreEntry = {
	key: string;
	/** Anything that changes when the object does: an ETag, a
	 *  timestamp, a counter. Compared for equality and never
	 *  interpreted. */
	version: string;
};

/** A place several machines can all reach, where the pre-rendered
 *  pages they change are kept so the others can pick them up.
 *
 *  Four operations over string keys and string bodies, which is what an
 *  object store, a key-value store and a database table all offer.
 *  Keys use `/` as a separator; `list` is by prefix. */
export type PageStore = {
	/** Removes an object. A key that is not there is not an error. */
	delete: (key: string) => Promise<void>;
	/** The object's body, or `undefined` when there is none. */
	get: (key: string) => Promise<string | undefined>;
	/** Every object whose key starts with `prefix`, with a version. */
	list: (prefix: string) => Promise<PageStoreEntry[]>;
	/** Stores `body` under `key`, replacing what was there.
	 *
	 *  May resolve to the version `list` will report for what was just
	 *  written. A store that can say so spares the writer fetching its
	 *  own page back on its next check; one that cannot resolves to
	 *  nothing, which costs that one fetch and nothing else. */
	put: (key: string, body: string) => Promise<string | void>;
};

export type PageStoreOptions = {
	/** How often, in milliseconds, a machine asks the store what
	 *  changed. Default 5000. The longest another machine keeps serving
	 *  a page after it was revalidated elsewhere. */
	interval?: number;
};

/** A pre-rendered page as it travels between machines: every file that
 *  makes it up, or the fact that it was taken down. */
export type StoredPage =
	| { files: Record<string, string>; removed?: undefined }
	| { files?: undefined; removed: true };
