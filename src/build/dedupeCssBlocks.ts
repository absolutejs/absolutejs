/** Keep the last identical block so intervening rules retain their cascade order.
 * Layer registration and imports have first-occurrence semantics. Preserve those
 * blocks (and escaped at-rules) rather than guessing at their ordering effects.
 */
export const dedupeCssBlocks = (blocks: readonly string[]): string[] => {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const block of blocks.toReversed()) {
		// Ignore mentions in comments and string values when classifying at-rules.
		const syntax = block.replace(
			/"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|\/\*[\s\S]*?\*\//g,
			''
		);
		if (/@(?:import|namespace)\b|@[\w-]*\\/i.test(syntax)) {
			// Imports/namespaces and escaped at-rules are ordering barriers.
			seen.clear();
			result.push(block);
			continue;
		}
		if (/@layer\b/i.test(syntax)) {
			// Keep every layer registration in its original position.
			result.push(block);
			continue;
		}
		if (seen.has(block)) continue;
		seen.add(block);
		result.push(block);
	}
	return result.reverse();
};
