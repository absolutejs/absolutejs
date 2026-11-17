import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'getRouteParam and useRouteParam from @absolutejs/absolute/vue return string | undefined, including for required parameters while an outgoing page observes the next route. The reactive helper accepts the application router getter without importing another router instance. See docs/VUE_ROUTE_PARAMETERS.md for cancellation and compiler guidance.',
	kind: 'added',
	summary:
		'Vue route parameter helpers preserve missing values during navigation',
	symbols: ['getRouteParam', 'useRouteParam']
};
