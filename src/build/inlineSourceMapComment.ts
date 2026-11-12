/* The `\n//# sourceMappingURL=data:…` comment appended to compiled output.
 *
 * Written as a joined array, not a template literal starting with `\n`, so
 * the comment never begins a line of the bundled AbsoluteJS source itself.
 * Bun's bundler turns an escaped `\n` in a template literal into a real
 * newline, which put `//# sourceMappingURL=data:application/json;base64,${…}`
 * at the start of a line in every server bundle that includes this code.
 * When Bun builds an error stack for that bundle it takes such a line for
 * the bundle's own source map, fails to decode `${…}`, and warns
 * "Could not decode sourcemap in dist/server.js". */
export const inlineSourceMapComment = (map: unknown) =>
	[
		'',
		`//# sourceMappingURL=data:application/json;base64,${Buffer.from(
			JSON.stringify(map)
		).toString('base64')}`
	].join('\n');
