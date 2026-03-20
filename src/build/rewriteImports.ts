/** Post-process bundled output files to rewrite bare specifiers
 *  (e.g. `from "@angular/core"`) to stable vendor paths
 *  (e.g. `from "/angular/vendor/angular_core.js"`).
 *
 *  This runs after Bun.build() when packages are marked as external
 *  in dev mode. Bun preserves bare specifiers for external packages,
 *  but browsers can't resolve them. Rewriting to absolute URL paths
 *  lets the browser load the pre-built vendor files directly. */

const escapeRegex = (str: string) =>
	str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

type CompiledRewriter = {
	fromRegex: RegExp;
	sideEffectRegex: RegExp;
	dynamicRegex: RegExp;
	lookup: Map<string, string>;
	replacements: [string, string][];
};

const rewriterCache = new Map<string, CompiledRewriter>();

const cacheKey = (vendorPaths: Record<string, string>) => {
	const entries = Object.entries(vendorPaths).sort(([a], [b]) =>
		a.localeCompare(b)
	);
	let key = '';
	for (const [k, v] of entries) {
		key += `${k}\0${v}\0`;
	}
	return key;
};

const getOrCompileRewriter = (vendorPaths: Record<string, string>) => {
	const key = cacheKey(vendorPaths);
	const cached = rewriterCache.get(key);
	if (cached) return cached;

	const replacements = Object.entries(vendorPaths).sort(
		([keyA], [keyB]) => keyB.length - keyA.length
	);

	const lookup = new Map<string, string>(replacements);
	const alt = replacements.map(([spec]) => escapeRegex(spec)).join('|');

	const fromRegex = new RegExp(`(from\\s*["'])(${alt})(["'])`, 'g');
	const sideEffectRegex = new RegExp(
		`(import\\s*["'])(${alt})(["'])`,
		'g'
	);
	const dynamicRegex = new RegExp(
		`(import\\s*\\(\\s*["'])(${alt})(["']\\s*\\))`,
		'g'
	);

	const rewriter: CompiledRewriter = {
		fromRegex,
		sideEffectRegex,
		dynamicRegex,
		lookup,
		replacements,
	};
	rewriterCache.set(key, rewriter);
	return rewriter;
};

const applyAllReplacements = (
	content: string,
	rewriter: CompiledRewriter
) => {
	const replacer = (
		_match: string,
		prefix: string,
		specifier: string,
		suffix: string
	) => {
		const webPath = rewriter.lookup.get(specifier);
		if (!webPath) return _match;
		return `${prefix}${webPath}${suffix}`;
	};

	rewriter.fromRegex.lastIndex = 0;
	rewriter.sideEffectRegex.lastIndex = 0;
	rewriter.dynamicRegex.lastIndex = 0;

	let result = content;
	result = result.replace(rewriter.fromRegex, replacer);
	result = result.replace(rewriter.sideEffectRegex, replacer);
	result = result.replace(rewriter.dynamicRegex, replacer);
	return result;
};

export const rewriteImports = async (
	outputPaths: string[],
	vendorPaths: Record<string, string>
) => {
	const jsFiles = outputPaths.filter((path) => path.endsWith('.js'));
	if (jsFiles.length === 0) return;

	const rewriter = getOrCompileRewriter(vendorPaths);

	await Promise.all(
		jsFiles.map(async (filePath) => {
			const original = await Bun.file(filePath).text();
			const content = applyAllReplacements(original, rewriter);
			if (content !== original) {
				await Bun.write(filePath, content);
			}
		})
	);
};
