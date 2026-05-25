import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	writeFileSync
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import {
	sharedDirFor,
	toModuleSpecifier,
	type ProjectContext
} from './context';
import { planCss } from './cssStrategy';
import type { FrameworkKey } from './frameworkKey';
import { frameworks } from './frameworks';
import { upsertNavItem, type NavItem } from './navData';
import { toKebabCase, toPascalCase, toTitleCase } from './naming';
import { emptyOutcome, type GenerateOutcome } from './outcome';
import { pageTemplates } from './pageTemplates';
import { findRoutingFile, wireRoute } from './routeWiring';
import { syncStaticNav } from './staticNav';

const writeNew = (path: string, contents: string) => {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, contents, 'utf-8');
};

const toHref = (fromDir: string, toFile: string) => {
	const rel = relative(fromDir, toFile).split('\\').join('/');

	return rel.startsWith('.') ? rel : `./${rel}`;
};

const staticPageFiles = (project: ProjectContext) =>
	(['html', 'htmx'] as const)
		.map((key) => project.frameworkDirs[key])
		.map((dir) => (dir ? join(dir, 'pages') : null))
		.filter(
			(pagesDir): pagesDir is string =>
				pagesDir !== null && existsSync(pagesDir)
		)
		.flatMap((pagesDir) =>
			readdirSync(pagesDir)
				.filter((name) => name.endsWith('.html'))
				.map((name) => join(pagesDir, name))
		);

const resyncPage = (file: string, items: NavItem[]) => {
	const html = readFileSync(file, 'utf-8');
	const synced = syncStaticNav(html, items);
	if (synced === null || synced === html) return false;
	writeFileSync(file, synced, 'utf-8');

	return true;
};

// Re-bake the nav snapshot in every other static page so they stay in sync with
// the shared navData. Pages without the markers are left untouched.
const resyncStaticPages = (
	project: ProjectContext,
	items: NavItem[],
	skipFile: string
) => {
	const updated: string[] = [];
	for (const file of staticPageFiles(project)) {
		if (file === skipFile) continue;
		if (resyncPage(file, items)) updated.push(file);
	}

	return updated;
};

export const generatePage = (
	project: ProjectContext,
	framework: FrameworkKey,
	rawName: string
) => {
	const def = frameworks[framework];
	const pascal = toPascalCase(rawName);
	const kebab = toKebabCase(rawName);
	const title = toTitleCase(rawName);
	const route = `/${kebab}`;
	const frameworkDir = project.frameworkDirs[framework];
	const outcome: GenerateOutcome = { ...emptyOutcome(), route };
	if (!frameworkDir) {
		outcome.manual = { reason: 'framework directory missing', snippet: '' };

		return outcome;
	}

	const pageFileAbs = join(
		frameworkDir,
		'pages',
		def.pageFile({ kebab, pascal })
	);
	if (existsSync(pageFileAbs)) {
		outcome.notes.push(
			`${pascal} already exists at ${pageFileAbs} — skipped.`
		);

		return outcome;
	}

	const routingFile = findRoutingFile(project.serverEntry);
	const routingText = routingFile ? readFileSync(routingFile, 'utf-8') : '';
	const css = planCss(routingText, project.stylesDir, pascal, kebab);

	const navDataPath = join(sharedDirFor(project, framework), 'navData.ts');
	const nav = upsertNavItem(navDataPath, { href: route, label: title });
	const navImportPath = toModuleSpecifier(
		dirname(pageFileAbs),
		navDataPath.replace(/\.ts$/, '')
	);

	writeNew(
		pageFileAbs,
		pageTemplates[framework]({
			cssHref: toHref(dirname(pageFileAbs), css.cssFileAbs),
			kebab,
			navImportPath,
			navItems: nav.items,
			pascal,
			title
		})
	);
	outcome.created.push(pageFileAbs);

	if (css.create) {
		writeNew(css.cssFileAbs, css.contents);
		outcome.created.push(css.cssFileAbs);
	} else if (css.shared) {
		outcome.notes.push(`Reusing shared stylesheet ${css.assetKey}.`);
	}

	if (nav.created) outcome.created.push(navDataPath);
	else if (nav.changed) outcome.updated.push(navDataPath);
	outcome.updated.push(...resyncStaticPages(project, nav.items, pageFileAbs));

	const wired = wireRoute({
		cssAssetKey: css.assetKey,
		def,
		indexKey: `${pascal}Index`,
		manifestKey: pascal,
		pageFileAbs,
		pascal,
		route,
		serverEntry: project.serverEntry,
		title
	});
	if (wired.kind === 'edited') outcome.updated.push(wired.routingFile);
	else outcome.manual = { reason: wired.reason, snippet: wired.snippet };

	return outcome;
};
