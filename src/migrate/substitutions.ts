/* First-party substitutions for third-party dependencies.
 *
 * Two rules govern this file. Every suggestion is checked against a catalog
 * the caller supplies, so the engine can never recommend a package that does
 * not exist — a wrong import is worse than no advice. And nothing here
 * rewrites anything: it reports, and the caller decides whether to propose a
 * diff or apply it. Silently swapping somebody's auth library on import is
 * not a refactor.
 *
 * The rules are curated rather than derived because a catalog entry knows
 * what it *is*, not what it *replaces*. The long-term home for this mapping
 * is a `replaces` field on each package manifest; until that exists across
 * 127 packages, a reviewable table beats an unreliable inference. */

export type SubstitutionRule = {
	/** The third-party dependency, as it appears in package.json. */
	from: string;
	/** The first-party package that covers it. */
	to: string;
	/** One line a reader can judge without opening documentation. */
	rationale: string;
};

/** Minimum a caller must tell us about the catalog. Deliberately structural
 *  rather than an import of Studio's generated type: the CLI ships a
 *  snapshot, Studio passes its live catalog, and neither should have to
 *  match the other's exact shape. */
export type CatalogEntryLike = { name: string };

export const DEFAULT_SUBSTITUTION_RULES: readonly SubstitutionRule[] = [
	{
		from: 'next-auth',
		rationale:
			'Sessions, OAuth providers, MFA and passkeys, wired to the same request context.',
		to: '@absolutejs/auth'
	},
	{
		from: 'bullmq',
		rationale:
			'Durable job queue with a Postgres or Redis adapter instead of a required Redis.',
		to: '@absolutejs/queue'
	},
	{
		from: 'bull',
		rationale: 'Durable job queue with first-party adapters.',
		to: '@absolutejs/queue'
	},
	{
		from: '@sentry/node',
		rationale:
			'Error capture, session replay and symbolication without a third-party account.',
		to: '@absolutejs/errors'
	},
	{
		from: '@sentry/browser',
		rationale: 'Browser error capture reported through the same pipeline.',
		to: '@absolutejs/beacon'
	},
	{
		from: 'web-vitals',
		rationale:
			'Real-user vitals already collected by the framework client.',
		to: '@absolutejs/beacon'
	},
	{
		from: 'nodemailer',
		rationale:
			'Transactional send with swappable Resend, Postmark or SMTP adapters.',
		to: '@absolutejs/dispatch'
	},
	{
		from: 'resend',
		rationale:
			'Same provider, behind an adapter you can change without touching call sites.',
		to: '@absolutejs/dispatch-resend'
	},
	{
		from: 'stripe',
		rationale:
			'Checkout, subscriptions and webhooks with the ledger already modelled.',
		to: '@absolutejs/commerce-stripe'
	},
	{
		from: '@aws-sdk/client-s3',
		rationale:
			'Object storage with presigning and lifecycle handled for you.',
		to: '@absolutejs/blob'
	},
	{
		from: 'yjs',
		rationale:
			'Collaborative state with presence, comments and history packs included.',
		to: '@absolutejs/sync'
	},
	{
		from: 'zustand',
		rationale: 'Scoped client state that survives island boundaries.',
		to: '@absolutejs/scoped-state'
	},
	{
		from: 'express-rate-limit',
		rationale: 'Rate limiting applied at the route contract.',
		to: '@absolutejs/rate-limit'
	},
	{
		from: 'pino',
		rationale: 'Structured logging that joins the observability pipeline.',
		to: '@absolutejs/logs'
	},
	{
		from: 'winston',
		rationale: 'Structured logging that joins the observability pipeline.',
		to: '@absolutejs/logs'
	}
];

export type SubstitutionInput = {
	/** Dependency names declared by the project, any section. */
	dependencies: readonly string[];
	/** Repo-relative files importing each dependency. A dependency absent
	 *  from this map is reported with an empty `usedIn` — declared but never
	 *  imported is still worth knowing, for a different reason. */
	importsByPackage?: Readonly<Record<string, readonly string[]>>;
	/** The packages that actually exist. Suggestions are filtered to these. */
	catalog: readonly CatalogEntryLike[];
	rules?: readonly SubstitutionRule[];
};

/** Find dependencies that have a first-party equivalent.
 *
 *  Ordered by how much evidence there is that the dependency is really in
 *  use, so a caller rendering the top few shows the ones that matter. */
export const planSubstitutions = ({
	dependencies,
	importsByPackage = {},
	catalog,
	rules = DEFAULT_SUBSTITUTION_RULES
}: SubstitutionInput) => {
	const declared = new Set(dependencies);
	const available = new Set(catalog.map((entry) => entry.name));

	return rules
		.filter((rule) => declared.has(rule.from) && available.has(rule.to))
		.map((rule) => ({
			from: rule.from,
			rationale: rule.rationale,
			to: rule.to,
			usedIn: [...(importsByPackage[rule.from] ?? [])]
		}))
		.sort(
			(left, right) =>
				right.usedIn.length - left.usedIn.length ||
				left.from.localeCompare(right.from)
		);
};
