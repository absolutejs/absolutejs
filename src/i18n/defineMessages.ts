import type { MessageCatalog } from '../../types/i18n';

/** Declare the default locale's catalog. Returns it unchanged, typed with
 *  its literal strings so `t()` checks keys and ICU parameters (the same
 *  as writing `as const`). */
export const defineMessages = <const Catalog extends MessageCatalog>(
	catalog: Catalog
) => catalog;
