import ts from 'typescript';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { toKebabCase } from './naming';

// Decides how a generated page gets its stylesheet. If the routing file shows an
// existing page CSS asset reused across routes, the new page joins it; otherwise
// it gets its own indexes/<name>.css. The asset key drives manifest-based
// frameworks; the file path drives static <link> hrefs.

const CSS_SUFFIX = 'CSS';
const SHARED_MIN_USES = 2;

const DEFAULT_CSS = `main {
	margin: 0 auto;
	max-width: 64rem;
	padding: 2rem;
}
`;

const cssAssetArg = (node: ts.Node) => {
	if (
		!ts.isCallExpression(node) ||
		!ts.isIdentifier(node.expression) ||
		node.expression.text !== 'asset'
	) {
		return null;
	}
	const [, arg] = node.arguments;
	if (arg && ts.isStringLiteralLike(arg) && arg.text.endsWith(CSS_SUFFIX)) {
		return arg.text;
	}

	return null;
};

// Returns the app's shared CSS asset key, recognizing two patterns: a key
// hoisted into a `const x = asset(manifest, 'XCSS')` (deliberate sharing, even
// if referenced once), or the same inline key used by 2+ routes. Returns null
// when each page carries its own CSS / there are none yet.
const detectSharedKey = (routingText: string) => {
	const sourceFile = ts.createSourceFile(
		'routing.ts',
		routingText,
		ts.ScriptTarget.Latest,
		true
	);
	let hoisted: string | null = null;
	const inlineCounts = new Map<string, number>();
	const visit = (node: ts.Node) => {
		const key = cssAssetArg(node);
		if (key) {
			if (ts.isVariableDeclaration(node.parent)) hoisted ??= key;
			else inlineCounts.set(key, (inlineCounts.get(key) ?? 0) + 1);
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
	if (hoisted) return hoisted;
	for (const [key, count] of inlineCounts) {
		if (count >= SHARED_MIN_USES) return key;
	}

	return null;
};

const fileForKey = (stylesDir: string, assetKey: string) => {
	const base = assetKey.endsWith(CSS_SUFFIX)
		? assetKey.slice(0, -CSS_SUFFIX.length)
		: assetKey;

	return join(stylesDir, `${toKebabCase(base)}.css`);
};

export type CssPlan = {
	assetKey: string;
	cssFileAbs: string;
	contents: string;
	create: boolean;
	shared: boolean;
};

export const planCss = (
	routingText: string,
	stylesDir: string,
	pascal: string,
	kebab: string
) => {
	const sharedKey = detectSharedKey(routingText);
	if (sharedKey) {
		const cssFileAbs = fileForKey(stylesDir, sharedKey);

		return {
			assetKey: sharedKey,
			contents: DEFAULT_CSS,
			create: !existsSync(cssFileAbs),
			cssFileAbs,
			shared: true
		} satisfies CssPlan;
	}
	const cssFileAbs = join(stylesDir, `${kebab}.css`);

	return {
		assetKey: `${pascal}${CSS_SUFFIX}`,
		contents: DEFAULT_CSS,
		create: !existsSync(cssFileAbs),
		cssFileAbs,
		shared: false
	} satisfies CssPlan;
};
