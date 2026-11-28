import type { CompressionConfig } from '../../types/compression';

/* The config's `compression` key, kept where a page handler can read it
 * without importing the config (prepare.ts sets it). */

const COMPRESSION = Symbol.for('absolutejs.compression');

const isConfig = (value: unknown): value is CompressionConfig =>
	typeof value === 'object' && value !== null;

/** Whether pages are compressed as they are served. They are unless
 *  the config says `compression: { pages: false }`. */
export const compressesPages = () => {
	const config: unknown = Reflect.get(globalThis, COMPRESSION);

	return !isConfig(config) || config.pages !== false;
};

/** Whether a page rendered as a stream is compressed as it streams.
 *  Only when the config asks: `compression: { streaming: true }`. */
export const compressesStreamedPages = () => {
	const config: unknown = Reflect.get(globalThis, COMPRESSION);

	return isConfig(config) && config.streaming === true && compressesPages();
};

export const setCompression = (config: CompressionConfig | undefined) => {
	Reflect.set(globalThis, COMPRESSION, config);
};
