/* Adapter over the published helper, so this repository and a user's
 * project exercise the same implementation.
 *
 * The published `waitForServer(url, options)` takes one options object.
 * This repository's ~14 call sites pass `(url, retries, delayMs)` or
 * `(url, retries, { delayMs, isReady, rejectUnauthorized })`, so the old
 * positional shape is kept here rather than touched in every caller: the
 * point of this change is one implementation, not a rename. */

import { waitForServer as wait } from '../../src/testing/http';

export { fetchPage } from '../../src/testing/http';

type LegacyOptions = {
	delayMs?: number;
	isReady?: (response: Response) => boolean | Promise<boolean>;
	rejectUnauthorized?: boolean;
};

export const waitForServer = (
	url: string,
	maxRetries?: number,
	tlsOptionsOrDelay?: LegacyOptions | number
) =>
	wait(url, {
		...(typeof tlsOptionsOrDelay === 'number'
			? { delayMs: tlsOptionsOrDelay }
			: (tlsOptionsOrDelay ?? {})),
		...(maxRetries === undefined ? {} : { maxRetries })
	});
