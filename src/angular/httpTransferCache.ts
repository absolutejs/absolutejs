import type { HttpTransferCacheOptions } from '@angular/common/http';

export const ABSOLUTE_HTTP_TRANSFER_CACHE_SKIP_HEADER = 'x-skip-transfer-cache';

export type AbsoluteHttpTransferCacheOptions = Omit<
	HttpTransferCacheOptions,
	'filter'
> & {
	filter?: NonNullable<HttpTransferCacheOptions['filter']>;
	skipHeader?: string;
};

export const buildAbsoluteHttpTransferCacheOptions = (
	options: AbsoluteHttpTransferCacheOptions = {}
) => {
	const {
		filter: userFilter,
		skipHeader = ABSOLUTE_HTTP_TRANSFER_CACHE_SKIP_HEADER,
		...angularOptions
	} = options;

	return {
		includePostRequests: false,
		includeRequestsWithAuthHeaders: false,
		...angularOptions,
		filter: (request) =>
			!request.headers.has(skipHeader) && (userFilter?.(request) ?? true)
	} satisfies HttpTransferCacheOptions;
};
