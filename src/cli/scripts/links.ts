import { loadConfig } from '../../utils/loadConfig';
import {
	auditLinks,
	deadLinkWarning,
	unservedPathnames
} from '../../build/auditLinks';

/* `absolute links [--config <path>]`
 *
 * Every literal `<a href="/…">` in the project's source whose target no
 * route serves. This is the half of typed links a type cannot do:
 * `route()` checks the path a caller hands it, but a template attribute
 * is not a typed position in Svelte, Vue or Angular, and an HTML or HTMX
 * route is not a typed language at all.
 *
 * A command as well as a build warning, for two reasons. A production
 * build already runs the route-registration scan for the sitemap, so the
 * warning rides along there for nothing — but a dev rebuild does not, and
 * paying a second per rebuild to find what this reports is not a trade
 * worth making. And a warning in a build log is not a gate: this exits
 * non-zero, so CI can decide that a dead link fails the branch.
 *
 * What it cannot see is in the exit message rather than hidden: a route
 * an installed plugin mounts is not in the project's source, so
 * `@absolutejs/auth`'s own paths look dead until `links.ignore` names
 * them. */

const USAGE = 'Usage: absolute links [--config <path>]';

export const links = async (configPath?: string) => {
	let config;
	try {
		config = await loadConfig(configPath);
	} catch (error) {
		console.error(
			error instanceof Error ? error.message : 'Could not read the config'
		);
		console.error(USAGE);
		process.exit(1);
	}

	const dead = auditLinks(config);
	const warning = deadLinkWarning(dead);
	// A route renamed, and its translations left behind. Said, and not
	// a failure: nothing links to an address nobody wrote.
	const unserved = unservedPathnames(config);
	if (unserved.length > 0)
		console.error(
			`i18n.pathnames translates ${unserved.length === 1 ? 'a path' : 'paths'} no route is registered at: ${unserved.join(', ')}`
		);
	if (!warning) {
		console.log('No dead links.');

		return;
	}
	console.error(warning);
	process.exit(1);
};
