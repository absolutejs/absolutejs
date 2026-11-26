/** The part of an S3 client the S3 page store uses. `Bun.S3Client` is
 *  one; so is anything else with these four methods. */
export type S3PageStoreClient = {
	delete: (path: string) => Promise<unknown>;
	file: (path: string) => { text: () => Promise<string> };
	list: (options: S3PageStoreListOptions) => Promise<S3PageStoreListing>;
	write: (
		path: string,
		data: string,
		options?: { type?: string }
	) => Promise<unknown>;
};

export type S3PageStoreListOptions = {
	continuationToken?: string;
	prefix?: string;
};

export type S3PageStoreListing = {
	contents?: { eTag?: string; key: string; lastModified?: string }[];
	isTruncated?: boolean;
	nextContinuationToken?: string;
};

/** The part of a Redis client the Redis page store uses: sending a
 *  command. `Bun.RedisClient` is one. */
export type RedisPageStoreClient = {
	send: (command: string, args: string[]) => Promise<unknown>;
};

export type PageStorePrefixOptions = {
	/** Put in front of every key, so the store can share a bucket or a
	 *  database with other things. */
	prefix?: string;
};

/** A built-in page store named in `absolute.config.ts`. Only what is
 *  not a secret: credentials come from the server's environment, the
 *  way Bun's own clients read them. */
export type PageStoreConfig =
	| {
			/** Default: the `S3_BUCKET` / `AWS_BUCKET` environment variable. */
			bucket?: string;
			/** For an S3-compatible service; default: the environment's. */
			endpoint?: string;
			/** Milliseconds between checks for changes. Default 5000. */
			interval?: number;
			prefix?: string;
			region?: string;
			type: 's3';
	  }
	| {
			interval?: number;
			prefix?: string;
			type: 'redis';
	  };
