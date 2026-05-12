const DEFAULT_RETRY_DELAY_MS = 500;
const DEFAULT_MAX_RETRIES = 120;

export const fetchPage = async (url: string) => {
	const res = await fetch(url);
	const html = await res.text();

	return { headers: res.headers, html, status: res.status };
};
export const waitForServer = async (
	url: string,
	maxRetries = DEFAULT_MAX_RETRIES,
	tlsOptionsOrDelay?:
		| number
		| { rejectUnauthorized?: boolean; delayMs?: number }
) => {
	const delayMs =
		typeof tlsOptionsOrDelay === 'number'
			? tlsOptionsOrDelay
			: (tlsOptionsOrDelay?.delayMs ?? DEFAULT_RETRY_DELAY_MS);
	// `tls: { rejectUnauthorized: false }` bypasses the self-signed
	// cert reject when probing HTTPS dev servers.
	const fetchInit =
		typeof tlsOptionsOrDelay === 'object' &&
		tlsOptionsOrDelay?.rejectUnauthorized === false
			? ({
					tls: { rejectUnauthorized: false }
				} as unknown as RequestInit)
			: undefined;
	for (let i = 0; i < maxRetries; i++) {
		try {
			const res = await fetch(url, fetchInit);
			if (res.ok) return true;
		} catch {
			// Server not ready yet
		}
		await Bun.sleep(delayMs);
	}
	throw new Error(
		`Server at ${url} did not become ready after ${maxRetries} retries`
	);
};
