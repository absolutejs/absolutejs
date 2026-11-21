import { readFileSync } from 'node:fs';
import { splitRoutePages } from '../build/splitRoutePages';

const REACT_SOURCE = /\.[jt]sx$/;

/** A module's source as the dev server runs it: a React file's router
 *  pages split the way every build splits them (build/splitRoutePages.ts),
 *  so the server renders the boundaries the browser hydrates. Every place
 *  the dev server reads a module it runs goes through this, so the source
 *  the backend HMR analyses is the source that runs. */
export const readServerSource = (path: string) => {
	const source = readFileSync(path, 'utf-8');
	if (!REACT_SOURCE.test(path) || path.includes('node_modules'))
		return source;

	return splitRoutePages(source, path) ?? source;
};
