import { expect, test } from 'bun:test';
import { serializeJsonLd } from '../../../src/utils/jsonLd';

/* JSON-LD is written inside <script type="application/ld+json">. A value
 * containing `</script>` used to end the tag, and the rest of the value
 * became markup. */
test('a value cannot close the JSON-LD script tag, and parses back unchanged', () => {
	const name = '</script><script>alert(1)</script> ';
	const serialized = serializeJsonLd({ '@type': 'Organization', name });

	expect(serialized).not.toContain('</script');
	expect(serialized).not.toContain(' ');
	expect(JSON.parse(serialized).name).toBe(name);
});
