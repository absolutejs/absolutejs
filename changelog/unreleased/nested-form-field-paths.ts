import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "A form sends one flat list of names, so a nested body has to be spelled into them. Until now `address.city=Paris` arrived as a key of that name and the submission failed with `address` Required, which made any schema with an object or an array of objects unusable from a plain form. Such names are now expanded into the shape the schema declares: both `items[0].sku` and `items.0.sku` are read, and a failure is reported under the name the input has, so `/items/0/sku` becomes `items[0].sku` and the message lands on that field. Normalisation recurses, so a checkbox two levels down still arrives as false when it was not ticked and each entry of an array of objects is normalised; a sparse index is compacted rather than left as a hole. A property's own `error` message resolves along the path, so `address.city` reads the message on `city` rather than the one on `address`. Expansion is driven by the schema, so a name it does not declare is left as it arrived and fails validation as an unknown field rather than creating anything, and a name reaching through `__proto__`, `constructor` or `prototype` is refused outright. The echoed values stay keyed by the names the inputs had, which is what the no-JavaScript re-render matches against.",
	kind: 'added',
	summary: 'Nested and array field names in form bodies',
	symbols: ['formActions']
};
