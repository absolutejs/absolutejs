/* Framework-module codemods: the part of leaving another meta-framework
 * that a machine can do, and the part it must refuse to do.
 *
 * `migrate` previously spoke only about third-party *dependencies* — the
 * `next-auth`, `pino`, `stripe` table in `substitutions.ts`. Measured on a
 * four-file Next.js app it reported six dependency swaps and said nothing
 * at all about the eight `next/*` imports in the source, which is the
 * framework the project is actually leaving. That is the hole this closes.
 *
 * Two kinds of rule, kept apart on purpose:
 *
 *   MECHANICAL — the import is a rename and nothing else, because the
 *   component on this side was built to take the same props. `next/image`
 *   is the clearest case: `ImageProps` in `types/image.ts` carries `src`,
 *   `alt`, `width`, `height`, `fill`, `quality`, `sizes`, `loader`,
 *   `unoptimized`, `loading`, `priority`, `placeholder`, `blurDataURL`,
 *   `fetchPriority` and `overrideSrc` under Next's own names. These are
 *   rewritten.
 *
 *   MANUAL — there is a counterpart but it is a different shape, or there
 *   is no counterpart yet. `next/head` takes a `metadata` object where
 *   Next takes children; `next/script` has no equivalent at all. These are
 *   named, located and explained, and nothing is touched.
 *
 * The split is the product. A command that rewrote the mechanical half
 * while staying quiet about the manual half would leave a project that
 * compiles in some files and lies in the rest — the same reason `upgrade`
 * reports six manual migrations as loudly as it applies three.
 *
 * Pure: text in, text and findings out. `apply.ts` is the only part that
 * touches disk. */

/** An import this engine will rewrite. `exported` is the name in `to`;
 *  the local binding in the project's own file is preserved. */
export type MechanicalCodemod = {
	/** One line explaining why the swap is safe, for the report. */
	because: string;
	/** Export name in `to`. */
	exported: string;
	/** Module specifier the project imports today. */
	from: string;
	/** How `from` exposes it. Next.js ships these as default exports; the
	 *  AbsoluteJS side is always a named export, so every rule here turns a
	 *  default binding into a named one. */
	kind: 'default';
	/** Differences a person still has to check after the rewrite. */
	notes: readonly string[];
	/** The AbsoluteJS module that replaces it. */
	to: string;
};

/** An import this engine refuses to rewrite, and why. */
export type ManualCodemod = {
	/** Module specifier the project imports today. */
	from: string;
	/** What to do instead, naming the real counterpart or saying there is
	 *  none. */
	instruction: string;
	/** True when `from` is a family prefix (`next/font` covers
	 *  `next/font/google` and `next/font/local`). */
	prefix?: boolean;
	/** Why a machine cannot do this one. */
	reason: string;
};

const REACT_COMPONENTS = '@absolutejs/absolute/react/components';

export const MANUAL_CODEMODS: readonly ManualCodemod[] = [
	{
		from: 'next/head',
		instruction: `\`Head\` from ${REACT_COMPONENTS} takes a \`metadata\` object — title, description, openGraph, twitter, robots — instead of children. Move the tags you render inside \`<Head>\` into that object.`,
		reason: 'The counterpart exists but takes data, not children.'
	},
	{
		from: 'next/navigation',
		instruction:
			'Inside a `<UniversalRouter>`, read `RouterNavigationContext` from `@absolutejs/absolute/react/router` for `navigate`. Outside one, `navigateDocument` from `@absolutejs/absolute/client/navigation` soft-navigates the document. There is no `useSearchParams`; read `location.search`.',
		reason: 'Three hooks with no single equivalent, and the replacement depends on whether the page has an SPA shell.'
	},
	{
		from: 'next/router',
		instruction:
			'The Pages-router API. Same replacement as `next/navigation`; `router.query` becomes the route params your page handler already receives.',
		reason: 'No equivalent; its surface is spread across the page handler and the navigation client.'
	},
	{
		from: 'next/dynamic',
		instruction:
			'For a lazily loaded route, `lazyRoute` from `@absolutejs/absolute/react/router`. For `dynamic(..., { ssr: false })`, make it an island — `Island` from `@absolutejs/absolute/react` — which is the supported way to keep a component off the server render.',
		reason: 'Two different mechanisms depending on whether `ssr: false` was passed.'
	},
	{
		from: 'next/script',
		instruction:
			"No first-party equivalent yet. Render a `<script>` yourself, or pass it through the page's head metadata.",
		reason: 'Not implemented — a third-party script component is still an open roadmap item.'
	},
	{
		from: 'next/font',
		instruction:
			'Fonts are a build concern here, not an import: declare them under `fonts` in `absolute.config.ts` and they are self-hosted, preloaded and injected into the head for you.',
		prefix: true,
		reason: 'Configuration replaces the import entirely, so there is no call site to rewrite.'
	},
	{
		from: 'next/headers',
		instruction:
			'Cookies and headers come from the Elysia request context your page handler is already given, rather than from a module-level import.',
		reason: 'Request state is a parameter here, not an ambient import.'
	},
	{
		from: 'next/server',
		instruction:
			'Middleware and `NextResponse` become Elysia lifecycle hooks on the app you build in your server entry.',
		reason: 'The whole middleware model differs; this is a rewrite, not a rename.'
	},
	{
		from: 'next/cache',
		instruction:
			'`revalidatePath` and `revalidateTag` have no equivalent yet. Prerendered pages are rebuilt by a build, not invalidated at runtime.',
		reason: 'Not implemented — on-demand revalidation is still an open roadmap item.'
	}
];

export const MECHANICAL_CODEMODS: readonly MechanicalCodemod[] = [
	{
		because:
			"`<Link>` is the React counterpart of Next's, renders a plain `<a>`, and takes the same `href`.",
		exported: 'Link',
		from: 'next/link',
		kind: 'default',
		notes: [
			'`prefetch` is a mode here, not a boolean: `prefetch={false}` becomes `prefetch="none"` and `prefetch` / `prefetch={true}` becomes `prefetch="viewport"`.',
			'`legacyBehavior` and `passHref` do not exist — this `<Link>` always renders its own `<a>`, so unwrap any `<a>` child.'
		],
		to: REACT_COMPONENTS
	},
	{
		because:
			"`ImageProps` was written against Next's prop names, down to `overrideSrc` and `blurDataURL`.",
		exported: 'Image',
		from: 'next/image',
		kind: 'default',
		notes: [
			'Remote sources need `images.remotePatterns` in `absolute.config.ts`, the same allow-list Next requires.',
			'`style` takes a plain record of CSS values rather than React `CSSProperties`.'
		],
		to: REACT_COMPONENTS
	}
];

/** Where a module is imported, and under what local name. */
export type CodemodHit = {
	/** Local binding in the project's file, preserved by the rewrite. */
	local: string;
	/** Named imports that were on the same statement and could not be
	 *  carried over, e.g. `import Link, { LinkProps } from 'next/link'`. */
	orphanedNames: string[];
	rule: MechanicalCodemod;
};

export type RewriteResult = {
	changed: boolean;
	hits: CodemodHit[];
	/** Every note from every rule that fired, de-duplicated. */
	notes: string[];
	source: string;
};

/* A default import, optionally with named imports beside it. Anything
 * stranger — `import * as`, a side-effect import, a bare re-export — does
 * not match, and is reported rather than guessed at. */
const defaultImportPattern = (specifier: string) =>
	new RegExp(
		`^[ \\t]*import\\s+([A-Za-z_$][\\w$]*)\\s*(?:,\\s*\\{([^}]*)\\})?\\s*from\\s*(['"])${specifier.replace(/\//gu, '\\/')}\\3[ \\t]*;?[ \\t]*\\r?\\n?`,
		'mu'
	);

const namedList = (inner: string | undefined) =>
	(inner ?? '')
		.split(',')
		.map((part) => part.trim())
		.filter((part) => part.length > 0);

/** `{ Link, Image as Picture }` for one combined import statement. */
const specifierList = (hits: readonly CodemodHit[]) =>
	hits
		.map(({ local, rule }) =>
			local === rule.exported ? local : `${rule.exported} as ${local}`
		)
		.sort((left, right) => left.localeCompare(right))
		.join(', ');

type Found = {
	end: number;
	hit: CodemodHit;
	start: number;
};

const findOne = (source: string, rule: MechanicalCodemod): Found | null => {
	const match = defaultImportPattern(rule.from).exec(source);
	if (match === null || match.index === undefined) return null;
	const [statement, local, named] = match;
	if (local === undefined) return null;

	return {
		end: match.index + statement.length,
		hit: { local, orphanedNames: namedList(named), rule },
		start: match.index
	};
};

/** Rewrite one file's mechanical imports, merging them into a single
 *  statement so the result does not import the same module twice. */
export const rewriteSource = (
	source: string,
	rules: readonly MechanicalCodemod[] = MECHANICAL_CODEMODS
): RewriteResult => {
	const found = rules
		.map((rule) => findOne(source, rule))
		.filter((item): item is Found => item !== null)
		.sort((left, right) => left.start - right.start);

	const [first] = found;
	if (first === undefined)
		return { changed: false, hits: [], notes: [], source };

	const hits = found.map((item) => item.hit);
	const target = first.hit.rule.to;
	const replacement = `import { ${specifierList(hits)} } from '${target}';\n`;

	/* Back to front, so every recorded offset still refers to the text it
	 * was measured in. */
	const rewritten = [...found]
		.reverse()
		.reduce(
			(carry, item) =>
				carry.slice(0, item.start) +
				(item === first ? replacement : '') +
				carry.slice(item.end),
			source
		);

	const notes = hits.flatMap(({ orphanedNames, rule }) => [
		...rule.notes,
		...(orphanedNames.length > 0
			? [
					`\`${rule.from}\` also exported ${orphanedNames.join(', ')} on that import; those names were dropped and have no counterpart.`
				]
			: []),
		/* Only the first import of a module is rewritten, and a file that
		 * imports one twice is rare enough not to be worth a second pass —
		 * but it must not be reported as finished. */
		...(importsModule(rewritten, rule.from)
			? [
					`\`${rule.from}\` is still imported somewhere in this file — it appears more than once, and only the first import was rewritten.`
				]
			: [])
	]);

	return {
		changed: true,
		hits,
		notes: [...new Set(notes)],
		source: rewritten
	};
};

const importsModule = (text: string, specifier: string, prefix = false) => {
	if (prefix)
		return (
			text.includes(`'${specifier}/`) ||
			text.includes(`"${specifier}/`) ||
			text.includes(`'${specifier}'`) ||
			text.includes(`"${specifier}"`)
		);

	return text.includes(`'${specifier}'`) || text.includes(`"${specifier}"`);
};

/** One file as the planner needs it: a repo-relative path and its text. */
export type SourceFile = {
	path: string;
	text: string;
};

export type MechanicalEdit = {
	hits: CodemodHit[];
	notes: string[];
	path: string;
	/** The file's full text after the rewrite, for a caller that writes or
	 *  diffs it. */
	rewritten: string;
};

export type ManualFinding = {
	/** Repo-relative files importing it. */
	files: string[];
	rule: ManualCodemod;
};

export type CodemodPlan = {
	/** Rewrites that are ready to apply. */
	mechanical: MechanicalEdit[];
	/** Imports a person has to deal with, with their call sites. */
	manual: ManualFinding[];
};

export type PlanCodemodsInput = {
	files: readonly SourceFile[];
	manualRules?: readonly ManualCodemod[];
	rules?: readonly MechanicalCodemod[];
};

/** What a codemod run would do, without doing it. */
export const planCodemods = ({
	files,
	manualRules = MANUAL_CODEMODS,
	rules = MECHANICAL_CODEMODS
}: PlanCodemodsInput): CodemodPlan => {
	const mechanical = files.flatMap(({ path, text }) => {
		const result = rewriteSource(text, rules);
		if (!result.changed) return [];

		return [
			{
				hits: result.hits,
				notes: result.notes,
				path,
				rewritten: result.source
			}
		];
	});

	const manual = manualRules.flatMap((rule) => {
		const hitFiles = files
			.filter(({ text }) => importsModule(text, rule.from, rule.prefix))
			.map(({ path }) => path);
		if (hitFiles.length === 0) return [];

		return [{ files: hitFiles, rule }];
	});

	return { manual, mechanical };
};
