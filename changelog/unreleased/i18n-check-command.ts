import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "`absolute i18n check <default-catalog> [locale-catalog…]` reports what no other gate catches: a key a locale never translated, an ICU argument renamed against the default (`{count}` translated as `{n}`), and unbalanced ICU braces in any catalog. All three reach the visitor as template source today — a message one brace short renders as its own ICU, and a renamed argument renders the literal `{n}` — with nothing logged anywhere. `--json` prints the report for a workflow; the exit code is non-zero for all three, while a key the default does not have is reported and does not fail, being dead weight rather than a broken page. `absolute typecheck` already covers a catalog the type system can see, since a loader typed Translation<typeof en> must carry every key with the right parameters; what it cannot see is a catalog read at runtime, where Bun.file('fr.json').json() is any, and it does not parse ICU syntax at all. Catalogs are named on the command line rather than discovered, because absolute.config.ts has no i18n field: defineI18n is called in app code, and discovering them would mean duplicating that declaration or importing the server. Unused-key scanning and `absolute i18n extract` remain open.",
	kind: 'added',
	summary:
		'absolute i18n check reports untranslated, mismatched and malformed messages'
};
