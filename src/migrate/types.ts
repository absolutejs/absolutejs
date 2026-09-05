/* Shared vocabulary for the migration engine.
 *
 * Everything here is data. The engine never prints and never writes: it
 * returns findings, and a caller decides what to do with them. That is what
 * lets one implementation serve both `absolute migrate` (which renders these
 * for a human) and the Studio AI tools (which hand the same values to a model
 * as JSON). A core that logged would force the AI to scrape text. */

/** Frameworks the detector can recognise in a project it did not create. */
export type StackKind =
	| 'absolutejs'
	| 'astro'
	| 'create-react-app'
	| 'nextjs'
	| 'nuxt'
	| 'remix'
	| 'sveltekit'
	| 'unknown'
	| 'vite';

/** Why the detector reached its conclusion, so a human (or a model) can
 *  disagree with it on evidence rather than on trust. */
export type StackEvidence = {
	/** Repo-relative path the signal came from. */
	source: string;
	/** What was found there, in one line. */
	detail: string;
};

export type StackDetection = {
	kind: StackKind;
	/** 0-1. Below `CONFIDENT` the caller should ask rather than assume. */
	confidence: number;
	evidence: StackEvidence[];
	/** Every stack that matched at all, strongest first — a Next.js app that
	 *  also uses Vite should not silently lose the second fact. */
	alternates: StackKind[];
};

/** A dependency that has a first-party equivalent. Suggestion only: the
 *  engine never rewrites imports on its own, because silently swapping
 *  somebody's auth library is not a refactor, it is a surprise. */
export type PackageSubstitution = {
	/** The dependency currently in package.json. */
	from: string;
	/** The `@absolutejs/*` package that covers it. */
	to: string;
	/** Where `from` is required, repo-relative. Empty when it is declared but
	 *  never imported — still worth reporting, for a different reason. */
	usedIn: string[];
	/** One line a human can judge without opening docs. */
	rationale: string;
};

/** How a caller wants edits applied. Mirrors the shape people already know
 *  from an editor agent: propose and wait, or apply and let them review. */
export type ApplyMode = 'apply' | 'propose';

export type MigrationPlan = {
	detection: StackDetection;
	substitutions: PackageSubstitution[];
};
