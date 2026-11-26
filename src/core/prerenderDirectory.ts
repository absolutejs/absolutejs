import { createHash } from 'node:crypto';
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
	type Dirent
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { isPrerendering } from '../utils/isPrerendering';

/* Where the pre-rendered pages a server serves live, when that is not
 * inside the build.
 *
 * They used to live in the build's own `_prerendered/` and nowhere else,
 * which is right for a build nobody changes. Since `revalidatePath` the
 * server rewrites those pages while it runs, and that placement has two
 * costs:
 *
 * - a build directory that cannot be written — a read-only image, a
 *   locked-down container — made every re-render fail, and it failed
 *   quietly: the page simply never changed;
 * - several machines each held their own copy, so a revalidation on one
 *   left the others serving the page from before.
 *
 * `static.directory` puts the pages somewhere else: any writable path
 * for the first, a volume the machines share for the second. Workers
 * already agree with each other through the disk (prerenderLookup.ts),
 * so machines sharing a directory agree the same way.
 *
 * EACH BUILD GETS ITS OWN FOLDER there. A page names the hashed assets
 * of the build that rendered it, so a page left over from the previous
 * build would ask for files the new one does not have. The folder is
 * named after the build's own pre-rendered pages, which makes it the
 * same for every machine running that build and for every restart of
 * it — a restart keeps the pages revalidated since the build — and
 * different for the next build. */

const KEPT_BUILDS = 3;
const ID_LENGTH = 16;

const filesIn = (directory: string, prefix = ''): string[] => {
	let entries: Dirent[];
	try {
		entries = readdirSync(directory, { withFileTypes: true });
	} catch {
		return [];
	}

	return entries.flatMap((entry) => {
		const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

		return entry.isDirectory()
			? filesIn(join(directory, entry.name), relativePath)
			: [relativePath];
	});
};

const readOrEmpty = (path: string) => {
	try {
		return readFileSync(path, 'utf-8');
	} catch {
		return '';
	}
};

/** What makes one build's pages different from another's: its manifest
 *  — the hashed assets its pages point at — and when each of its pages
 *  was rendered. Two machines running one build compute the same value;
 *  a rebuild computes another. */
export const prerenderBuildId = (buildDir: string) => {
	const source = join(buildDir, '_prerendered');
	const rendered = filesIn(source)
		.filter((file) => file.endsWith('.meta'))
		.sort()
		.map((file) => `${file}:${readOrEmpty(join(source, file))}`);

	return createHash('sha256')
		.update(readOrEmpty(join(buildDir, 'manifest.json')))
		.update('\n')
		.update(rendered.join('\n'))
		.digest('hex')
		.slice(0, ID_LENGTH);
};

/* Copies the build's pages in, never over what is there. Whatever is in
 * the folder belongs to this same build and is as new or newer: a page
 * revalidated before a restart, or the copy another machine is making
 * right now. Written beside the target and renamed, so a machine
 * starting at the same moment never reads half a file. */
const seedFile = (source: string, target: string) => {
	if (existsSync(target)) return false;
	mkdirSync(dirname(target), { recursive: true });
	const partial = `${target}.${process.pid}.seeding`;
	copyFileSync(source, partial);
	renameSync(partial, target);

	return true;
};

const modifiedAt = (path: string) => {
	try {
		return statSync(path).mtimeMs;
	} catch {
		return 0;
	}
};

/* Older builds' folders go, but not all of them: during a rolling
 * deploy the previous build is still serving from its own. Dot-folders
 * are the re-renderer's staging area, not builds. */
const pruneOldBuilds = (root: string, current: string) => {
	const others = readdirSync(root, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.filter((name) => name !== current && !name.startsWith('.'))
		.sort(
			(one, other) =>
				modifiedAt(join(root, other)) - modifiedAt(join(root, one))
		);
	others.slice(KEPT_BUILDS - 1).forEach((name) => {
		rmSync(join(root, name), { force: true, recursive: true });
	});
};

/** Why pre-rendered pages cannot be updated in `directory`, or
 *  `undefined` when they can. Asked once at startup, so that an
 *  unwritable directory is a message in the log and not a page that
 *  silently never changes. */
export const prerenderDirectoryProblem = (directory: string) => {
	const probe = join(directory, `.writable-${process.pid}`);
	try {
		mkdirSync(directory, { recursive: true });
		writeFileSync(probe, '');
		rmSync(probe, { force: true });

		return undefined;
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
};

/** The directory to serve pre-rendered pages from and re-render them
 *  into: the build's own, or this build's folder under
 *  `static.directory`, created and filled from the build on first use. */
export const resolvePrerenderDirectory = (
	buildDir: string,
	configured: string | undefined
) => {
	const built = join(buildDir, '_prerendered');
	if (configured === undefined || configured === '') return built;
	// The build's own pre-render server is what WRITES the build's
	// pages; it has no finished build to name a folder after yet.
	if (isPrerendering()) return built;
	const root = resolve(configured);
	const id = prerenderBuildId(buildDir);
	const live = join(root, id);
	mkdirSync(live, { recursive: true });
	filesIn(built).forEach((file) =>
		seedFile(join(built, file), join(live, file))
	);
	pruneOldBuilds(root, id);

	return live;
};

/** `resolvePrerenderDirectory`, for a server that has to start either
 *  way. A `static.directory` that cannot be created or filled must not
 *  stop it: the build's own pages are still there to serve. It is said
 *  plainly, and the writability check that follows says the rest. */
export const usablePrerenderDirectory = (
	buildDir: string,
	configured: string | undefined,
	warn: (message: string) => void
) => {
	try {
		return resolvePrerenderDirectory(buildDir, configured);
	} catch (error) {
		warn(
			`static.directory (${configured}) cannot be used: ${error instanceof Error ? error.message : String(error)}. Serving pre-rendered pages from the build instead.`
		);

		return join(buildDir, '_prerendered');
	}
};
