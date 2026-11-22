/* Waiting for a server, and fetching a page the way a browser would.
 *
 * Both were already written and exercised across this repository's own
 * integration suites; neither was reachable from a project that installs
 * the package, so everyone testing an AbsoluteJS app wrote them again. */

const DEFAULT_DELAY_MS = 500;
const DEFAULT_MAX_RETRIES = 120;

export type WaitForServerOptions = {
	/** Delay between attempts. Default 500ms. */
	delayMs?: number;
	/** Treat a 2xx as ready only when this also returns true — for a
	 *  server that answers before the thing under test is live. */
	isReady?: (response: Response) => boolean | Promise<boolean>;
	/** Attempts before giving up. Default 120, so 60s at the default
	 *  delay. Lower it in a test that EXPECTS boot to fail, or it eats
	 *  the whole timeout. */
	maxRetries?: number;
	/** Accept a self-signed certificate, which is what `absolute dev`
	 *  generates for HTTPS when mkcert is not installed. */
	rejectUnauthorized?: boolean;
};

/** GET a page with `accept: text/html`, so the server's HTML error and
 *  not-found conventions run instead of its JSON ones. */
export const fetchPage = async (url: string) => {
	const response = await fetch(url, { headers: { accept: 'text/html' } });
	const html = await response.text();

	return { headers: response.headers, html, status: response.status };
};

/* One attempt. Separated so the retry loop stays flat and a connection
 * refusal reads as "not yet" rather than as a failure. */
const probeOnce = async (url: string, options: WaitForServerOptions) => {
	try {
		const response = await fetch(
			url,
			options.rejectUnauthorized === false
				? { tls: { rejectUnauthorized: false } }
				: undefined
		);
		if (!response.ok) return false;

		return options.isReady === undefined
			? true
			: await options.isReady(response);
	} catch {
		return false;
	}
};

/** Resolve once `url` answers. Throws naming the url and the attempt
 *  count rather than hanging, because a test that hangs tells you
 *  nothing. */
export const waitForServer = async (
	url: string,
	options: WaitForServerOptions = {}
) => {
	const { delayMs = DEFAULT_DELAY_MS, maxRetries = DEFAULT_MAX_RETRIES } =
		options;

	for (let attempt = 0; attempt < maxRetries; attempt += 1) {
		/* eslint-disable-next-line no-await-in-loop -- a readiness probe
		 * is sequential by definition. */
		if (await probeOnce(url, options)) return true;
		/* eslint-disable-next-line no-await-in-loop -- the delay is the
		 * point. */
		await Bun.sleep(delayMs);
	}

	throw new Error(
		`Server at ${url} did not become ready after ${maxRetries} attempts`
	);
};
