import {
	createAbsoluteHttpTransport,
	installAbsoluteHttpTransport,
	type AbsoluteHttpFetch
} from '@absolutejs/http';

export const installAbsoluteMobileShellHttp = (
	origin: string,
	fetch: AbsoluteHttpFetch = globalThis.fetch
) =>
	installAbsoluteHttpTransport(
		createAbsoluteHttpTransport({ fetch, origin, runtime: 'native' })
	);
