import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "Vue and Ember wrote a page's initial props into an inline script with a plain `JSON.stringify`, so a prop value containing `</script>` ended the script and the rest of the value was parsed as HTML: an XSS hole for any page that passes user-provided data as props. The same applied to Angular's `requestContext`, the island state and manifest scripts, and JSON-LD (`generateHeadElement`, the React and Svelte `JsonLd` components). All of these now escape `<`, U+2028 and U+2029, as React and Svelte page props already did. The data is unchanged once parsed.",
	kind: 'security',
	summary:
		'Initial props, request context, island state and JSON-LD can no longer break out of their inline <script>'
};
