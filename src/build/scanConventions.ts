import { basename } from 'node:path';
import { Glob } from 'bun';
import { existsSync } from 'node:fs';
import type {
	FrameworkConventionEntry,
	PageConventions,
	FrameworkConventions
} from '../../types/conventions';

const CONVENTION_RE = /^(?:(.+)\.)?(error|loading|not-found)\.[^.]+$/;

const classifyFile = (
	file: string,
	pageFiles: string[],
	defaults: FrameworkConventions,
	pages: Record<string, PageConventions>
) => {
	const fileName = basename(file);
	const match = CONVENTION_RE.exec(fileName);

	if (!match) {
		pageFiles.push(file);

		return;
	}

	const [, pageName, kind] = match;

	if (!pageName) {
		if (kind === 'error') defaults.error = file;
		else if (kind === 'loading') defaults.loading = file;
		else if (kind === 'not-found') defaults.notFound = file;

		return;
	}

	if (!pages[pageName]) pages[pageName] = {};

	if (kind === 'error') pages[pageName].error = file;
	else if (kind === 'loading') pages[pageName].loading = file;
};

export const scanConventions = async (
	pagesDir: string,
	pattern: string
) => {
	if (!existsSync(pagesDir)) {
		const pageFiles: string[] = [];

		return { conventions: undefined, pageFiles };
	}

	const pageFiles: string[] = [];
	const defaults: FrameworkConventions = {};
	const pages: Record<string, PageConventions> = {};

	const glob = new Glob(pattern);
	for await (const file of glob.scan({ absolute: true, cwd: pagesDir })) {
		classifyFile(file, pageFiles, defaults, pages);
	}

	const hasConventions =
		defaults.error !== undefined ||
		defaults.loading !== undefined ||
		defaults.notFound !== undefined ||
		Object.keys(pages).length > 0;

	const conventions: FrameworkConventionEntry | undefined = hasConventions
		? {
				...(defaults.error || defaults.loading || defaults.notFound
					? { defaults }
					: {}),
				...(Object.keys(pages).length > 0 ? { pages } : {})
			}
		: undefined;

	return { conventions, pageFiles };
};
