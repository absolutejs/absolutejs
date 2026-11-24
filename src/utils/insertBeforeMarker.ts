/** Insert `snippet` immediately before the first `marker` in `html`, or
 *  return `null` when the marker is absent.
 *
 *  This exists because `html.replace(marker, snippet + marker)` is not
 *  literal. In a replacement STRING, `$&` means the match, `` $` `` the
 *  text before it, `$'` the text after it and `$$` a dollar sign — so a
 *  snippet carrying data is rewritten on the way in. Measured: request
 *  context `{ price: "$'" }` reached the browser as `"</html>"`, and an
 *  inlined stylesheet with the ordinary selector `a[href$='.pdf']`
 *  swallowed the rest of the document head at that point. */
export const insertBeforeMarker = (
	html: string,
	marker: string,
	snippet: string
) => {
	const index = html.indexOf(marker);
	if (index < 0) return null;

	return html.slice(0, index) + snippet + html.slice(index);
};
