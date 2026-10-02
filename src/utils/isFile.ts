import { statSync } from 'node:fs';

/** True only for a regular file. Vue's type resolver probes an import path as
 *  written before trying `<path>.ts` and `<path>/index.ts`, so answering true
 *  for a directory makes it read the directory and fail with EISDIR. */
export const isFile = (path: string) =>
	statSync(path, { throwIfNoEntry: false })?.isFile() ?? false;
