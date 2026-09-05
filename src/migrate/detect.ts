/* Stack detection for a codebase the framework did not create.
 *
 * Pure and filesystem-free: the caller supplies the few files that matter,
 * so this is testable without fixtures on disk and reusable over a Studio
 * workspace, a clone in a temp directory, or a tarball. It reads manifests
 * and config filenames only — never source — because that is enough to
 * choose a migration path and cheap on a repository of any size.
 *
 * Detection is deliberately evidence-first. A project can look like two
 * things at once (a Next.js app is also a React app; Remix and SvelteKit
 * both sit on Vite), so every match is kept and ranked instead of the first
 * hit winning. */

import type { StackDetection, StackEvidence, StackKind } from './types';

/** Below this, a caller should ask rather than assume. A single weak signal
 *  — say a `vite` devDependency in an otherwise unrecognisable repo — is a
 *  hint, not a verdict. */
export const CONFIDENT = 0.7;

type Manifest = {
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
	scripts?: Record<string, string>;
};

export type DetectionInput = {
	/** Parsed package.json, or null when the repo has none. */
	manifest: Manifest | null;
	/** Repo-relative paths of files at or near the root. Directory entries
	 *  may be included; only names are ever compared. */
	files: readonly string[];
};

/* A dependency is the strongest single signal: a framework you depend on is
 * a framework you use. Config files corroborate but do not lead — plenty of
 * repos carry a stray `vite.config.ts` from a tool that generated it. */
const DEPENDENCY_SIGNALS: ReadonlyArray<readonly [string, StackKind]> = [
	['@absolutejs/absolute', 'absolutejs'],
	['next', 'nextjs'],
	['nuxt', 'nuxt'],
	['@remix-run/react', 'remix'],
	['@remix-run/node', 'remix'],
	['@sveltejs/kit', 'sveltekit'],
	['astro', 'astro'],
	['react-scripts', 'create-react-app'],
	['vite', 'vite']
];

const FILE_SIGNALS: ReadonlyArray<readonly [string, StackKind]> = [
	['absolute.config.ts', 'absolutejs'],
	['absolute.config.js', 'absolutejs'],
	['next.config.js', 'nextjs'],
	['next.config.mjs', 'nextjs'],
	['next.config.ts', 'nextjs'],
	['nuxt.config.ts', 'nuxt'],
	['remix.config.js', 'remix'],
	['svelte.config.js', 'sveltekit'],
	['astro.config.mjs', 'astro'],
	['vite.config.ts', 'vite'],
	['vite.config.js', 'vite']
];

/* Weights are ordered, not tuned, and only matter relative to CONFIDENT.
 * A declared framework dependency clears the bar on its own — you do not
 * depend on `next` by accident — while a config file corroborates without
 * being enough to act on alone. */
const DEPENDENCY_WEIGHT = 0.75;
const FILE_WEIGHT = 0.3;
const CERTAIN = 1;

/* Deterministic tie-break. Two frameworks scoring equally is genuinely
 * ambiguous, so the order here is only to stop the answer depending on
 * object key order — the real signal in that case is the confidence
 * penalty below, which pushes the result under CONFIDENT so the caller
 * asks instead of assuming. */
const STACK_PRECEDENCE: readonly StackKind[] = [
	'absolutejs',
	'nextjs',
	'nuxt',
	'remix',
	'sveltekit',
	'astro',
	'create-react-app',
	'vite',
	'unknown'
];

/** Applied when the two strongest stacks score identically. */
const AMBIGUITY_PENALTY = 0.3;

const dependencyNames = (manifest: Manifest | null) => {
	if (!manifest) return new Set<string>();

	return new Set([
		...Object.keys(manifest.dependencies ?? {}),
		...Object.keys(manifest.devDependencies ?? {}),
		...Object.keys(manifest.peerDependencies ?? {})
	]);
};

/** `vite` is a build tool before it is a stack: Remix, SvelteKit and Astro
 *  all depend on it. Crediting it independently would let it outrank the
 *  framework actually in use, so it only counts when nothing else matched. */
const SUBSUMED_BY_OTHERS: ReadonlySet<StackKind> = new Set<StackKind>(['vite']);

const scoreSignals = (
	present: (name: string) => boolean,
	signals: ReadonlyArray<readonly [string, StackKind]>,
	weight: number,
	label: (name: string) => StackEvidence
) => {
	const scores = new Map<StackKind, number>();
	const evidence: StackEvidence[] = [];
	for (const [name, kind] of signals) {
		if (!present(name)) continue;
		scores.set(kind, (scores.get(kind) ?? 0) + weight);
		evidence.push(label(name));
	}

	return { evidence, scores };
};

const merge = (into: Map<StackKind, number>, from: Map<StackKind, number>) => {
	for (const [kind, score] of from) {
		into.set(kind, (into.get(kind) ?? 0) + score);
	}

	return into;
};

/** Identify the framework a project is built on.
 *
 *  Returns `unknown` with zero confidence rather than guessing when nothing
 *  matches — a wrong stack sends a migration down a path that cannot work,
 *  which is worse than admitting ignorance and asking. */
export const detectStack = ({
	manifest,
	files
}: DetectionInput): StackDetection => {
	const dependencies = dependencyNames(manifest);
	const names = new Set(files.map((file) => file.split('/').pop() ?? file));

	const fromDependencies = scoreSignals(
		(name) => dependencies.has(name),
		DEPENDENCY_SIGNALS,
		DEPENDENCY_WEIGHT,
		(name) => ({
			detail: `depends on ${name}`,
			source: 'package.json'
		})
	);
	const fromFiles = scoreSignals(
		(name) => names.has(name),
		FILE_SIGNALS,
		FILE_WEIGHT,
		(name) => ({ detail: 'config file present', source: name })
	);

	const scores = merge(new Map(fromDependencies.scores), fromFiles.scores);
	const decisive = [...scores.keys()].some(
		(kind) => !SUBSUMED_BY_OTHERS.has(kind)
	);
	if (decisive) {
		for (const kind of SUBSUMED_BY_OTHERS) scores.delete(kind);
	}

	const rank = (kind: StackKind) => {
		const index = STACK_PRECEDENCE.indexOf(kind);

		return index === -1 ? STACK_PRECEDENCE.length : index;
	};
	const ranked = [...scores.entries()].sort(
		([leftKind, left], [rightKind, right]) =>
			right - left || rank(leftKind) - rank(rightKind)
	);
	const [top] = ranked;
	if (!top) {
		return {
			alternates: [],
			confidence: 0,
			evidence: [],
			kind: 'unknown'
		};
	}
	const [kind, score] = top;
	const [, runnerUpScore] = ranked[1] ?? [];
	// Two stacks that score the same is not a 90%-confident answer, whatever
	// the raw weights add up to. Say so, so the caller asks.
	const ambiguous = runnerUpScore === score;

	return {
		alternates: ranked.slice(1).map(([alternate]) => alternate),
		confidence: Math.max(
			0,
			Math.min(score, CERTAIN) - (ambiguous ? AMBIGUITY_PENALTY : 0)
		),
		evidence: [...fromDependencies.evidence, ...fromFiles.evidence],
		kind
	};
};
