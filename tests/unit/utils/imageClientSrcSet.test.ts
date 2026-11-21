import { describe, expect, test } from 'bun:test';
import { generateSrcSet } from '../../../src/utils/imageClient';

const loader = ({
	src,
	width,
	quality
}: {
	quality: number;
	src: string;
	width: number;
}) => `${src}?w=${width}&q=${quality}`;

describe('generateSrcSet', () => {
	test('a custom loader builds every candidate, not just the src', () => {
		const set = generateSrcSet(
			'/private/picture',
			320,
			undefined,
			undefined,
			loader
		);
		expect(set).toBe(
			'/private/picture?w=384&q=75 1x, /private/picture?w=640&q=75 2x'
		);
		expect(set).not.toContain('/_absolute/image');
	});

	test('the loader is used with sizes too', () => {
		const set = generateSrcSet(
			'/p',
			undefined,
			'50vw',
			{ deviceSizes: [640], imageSizes: [96] },
			loader
		);
		expect(set).toBe('/p?w=96&q=75 96w, /p?w=640&q=75 640w');
	});

	test("the image's quality reaches the set", () => {
		expect(
			generateSrcSet('/a.jpg', 100, undefined, { quality: 40 })
		).toContain('&q=40');
	});

	test('called as Angular calls it, the loader is not taken for sizes', () => {
		expect(
			generateSrcSet('/p', 100, undefined, { quality: 60 }, loader)
		).toBe('/p?w=128&q=60 1x, /p?w=256&q=60 2x');
	});

	test('without a loader it uses the optimization endpoint as before', () => {
		expect(generateSrcSet('/a.jpg', 100, undefined)).toBe(
			'/_absolute/image?url=%2Fa.jpg&w=128&q=75 1x, /_absolute/image?url=%2Fa.jpg&w=256&q=75 2x'
		);
	});
});
