import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "The client `generateSrcSet` from `@absolutejs/absolute/image` now takes the same arguments as the server's: `(src, width, sizes, config, loader)`. Its fourth and fifth arguments were the `deviceSizes` and `imageSizes` arrays; they move into `config`, beside `path` and `quality`, and the fifth is the image's loader. Angular's browser build already called it this way, which is how its loader came to be read as `imageSizes`.",
	kind: 'breaking',
	migration: {
		instruction:
			'Call generateSrcSet(src, width, sizes, { deviceSizes, imageSizes }) instead of generateSrcSet(src, width, sizes, deviceSizes, imageSizes); pass a loader as the fifth argument.',
		manual: true
	},
	summary: '`generateSrcSet` takes a config object and a loader, like the server’s',
	symbols: ['generateSrcSet']
};
