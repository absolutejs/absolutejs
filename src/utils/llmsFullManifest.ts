import { join } from 'node:path';

/* What a build leaves for the server to make `llms-full.txt` from
 * (core/llmsFull.ts): the pages to read, and how. Kept apart from the
 * plugin so the build can write it without importing a server. */

export type LlmsFullManifest = {
	maxPages: number;
	pages: { path: string; url: string }[];
	revalidate: number;
	summary?: string;
	title: string;
};

/** Where it is written, under the build directory. */
export const LLMS_FULL_MANIFEST = join('.absolutejs', 'llms-full.json');
