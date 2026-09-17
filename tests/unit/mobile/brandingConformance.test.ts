import { describe, expect, test } from 'bun:test';
import sharp from 'sharp';
import {
	brandingHasVisibleContent,
	brandingPixelDigest,
	brandingPng
} from '../../helpers/mobileBranding';

describe('branding conformance artwork', () => {
	test('rejects blank screenshots without claiming semantic visual correctness', async () => {
		const blank = await sharp({
			create: {
				background: '#000000',
				channels: 4,
				height: 32,
				width: 32
			}
		})
			.png()
			.toBuffer();
		expect(await brandingHasVisibleContent(blank)).toBe(false);
		expect(await brandingHasVisibleContent(await brandingPng(1, 64))).toBe(
			true
		);
	});
	test('is deterministic and changes pixels between revisions', async () => {
		const first = await brandingPng(1);
		expect(first.equals(await brandingPng(1))).toBe(true);
		expect(await brandingPixelDigest(first)).not.toBe(
			await brandingPixelDigest(await brandingPng(2))
		);
		const info = await sharp(first).metadata();
		expect(info).toMatchObject({
			hasAlpha: true,
			height: 1024,
			width: 1024
		});
	});
	test('ignores lossless encoding changes but includes dimensions', async () => {
		const first = await brandingPng(1, 64);
		const reencoded = await sharp(first)
			.png({ compressionLevel: 0 })
			.toBuffer();
		expect(first.equals(reencoded)).toBe(false);
		expect(await brandingPixelDigest(first)).toBe(
			await brandingPixelDigest(reencoded)
		);
		expect(await brandingPixelDigest(first)).not.toBe(
			await brandingPixelDigest(await brandingPng(1, 128))
		);
	});
	test('rejects invalid packaged image data', async () => {
		await expect(
			brandingPixelDigest(Buffer.from('not an image'))
		).rejects.toThrow();
	});
	test('ignores only invisible RGB, not alpha or visible color changes', async () => {
		const encode = (rgba: number[]) =>
			sharp(Buffer.from(rgba), {
				raw: { channels: 4, height: 1, width: 1 }
			})
				.png()
				.toBuffer();
		const clear = await brandingPixelDigest(await encode([0, 0, 0, 0]));
		expect(await brandingPixelDigest(await encode([220, 70, 40, 0]))).toBe(
			clear
		);
		expect(
			await brandingPixelDigest(await encode([220, 70, 40, 1]))
		).not.toBe(clear);
	});
});
