import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

/** Reject blank/off-display evidence for the fixture's launcher and launched shell. */
export const brandingHasVisibleContent = async (input: Buffer) => {
	const { channels } = await sharp(input).stats();

	return channels.slice(0, 3).some(({ min, max }) => max - min > 8);
};

/** Compare visible pixels; AAPT discards RGB beneath fully transparent alpha. */
export const brandingPixelDigest = async (input: Buffer) => {
	const { data, info } = await sharp(input)
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	for (let offset = 0; offset < data.length; offset += 4) {
		if (data[offset + 3] === 0) data.fill(0, offset, offset + 3);
	}

	return createHash('sha256')
		.update(`${info.width}x${info.height}:`)
		.update(data)
		.digest('hex');
};
/** Synthetic artwork independent of generated native projects or product assets. */
export const brandingPng = async (revision = 1, size = 1024) => {
	const pixels = Buffer.alloc(size * size * 4);
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const offset = (y * size + x) * 4;
			const inside =
				x > size / 3 &&
				x < (size * 2) / 3 &&
				y > size / 3 &&
				y < (size * 2) / 3;
			pixels[offset] = revision === 1 ? 220 : 30;
			pixels[offset + 1] = inside ? 230 : 70;
			pixels[offset + 2] = revision === 1 ? 40 : 220;
			pixels[offset + 3] = inside ? 255 : 0;
		}
	}

	return sharp(pixels, { raw: { channels: 4, height: size, width: size } })
		.png()
		.toBuffer();
};
export const writeBrandingFixture = async (root: string, revision: number) => {
	const directory = join(root, '.absolutejs/branding-source');
	await mkdir(directory, { recursive: true });
	await writeFile(join(directory, 'icon.png'), await brandingPng(revision));
};
