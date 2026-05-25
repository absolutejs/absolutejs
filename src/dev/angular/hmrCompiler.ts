/* `/@ng/component?c=<id>` endpoint dispatch + the encode helper that
 * keeps server-side WS broadcasts and client-side `__ng_hmr_load`
 * listeners in agreement on the component id format.
 *
 * The endpoint is invoked from the browser's injected
 * `__ng_hmr_load` block (and the Tier 1a `__ng_hmr_remount` peer)
 * via `await import('/@ng/component?c=' +
 * encodeURIComponent(__ng_hmr_id) + '&t=' + t)`. We resolve the id
 * to a class node, compile the surgical-update module via
 * `tryFastHmr`, and serve it. There used to be an `emitHmrUpdateModule`
 * slow-path fallback here for components that bailed `tryFastHmr`
 * with `uses-advanced-feature` (host bindings, queries, animations,
 * etc.), but `extractAdvancedMetadata` in `fastHmrCompiler.ts` now
 * extracts all of those metadata kinds itself — the slow path is
 * dead code, and so is the ngc shadow program that fed it. Anything
 * `tryFastHmr` still rejects (parse errors, inheritance from a
 * decorated parent, etc.) escalates to Tier 1b rebootstrap via the
 * dispatcher in `rebuildTrigger.ts`, never via this endpoint. */

import { dirname, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { logInfo } from '../../utils/logger';
import { tryFastHmr } from './fastHmrCompiler';

/* Top-level helper for the `/@ng/component?c=<id>` endpoint. */
export const encodeHmrComponentId = (
	absoluteFilePath: string,
	className: string
): string => {
	const projectRel = relative(process.cwd(), absoluteFilePath).replace(
		/\\/g,
		'/'
	);

	return `${projectRel}@${className}`;
};
export const getApplyMetadataModule = async (
	encodedId: string
): Promise<string | null> => {
	const decoded = decodeURIComponent(encodedId);
	const at = decoded.lastIndexOf('@');
	if (at === -1) return null;
	const filePathRel = decoded.slice(0, at);
	const className = decoded.slice(at + 1);
	const componentFilePath = resolve(process.cwd(), filePathRel);

	// Cache hit path: the dispatcher already compiled this exact
	// edit's surgical module (in `decideAngularTier`'s `tryFastHmr`
	// call) and stashed the text under the same key fastHmr uses
	// internally. Serving from cache makes the typical edit's
	// endpoint response near-instant (~0.1ms) instead of re-running
	// the full ~50ms compile pipeline a second time.
	//
	// The cache key mirrors fastHmr's `fingerprintId`:
	// `encodeURIComponent('<project-relative-path>@<className>')`.
	const projectRelPath = relative(process.cwd(), componentFilePath).replace(
		/\\/g,
		'/'
	);
	const cacheKey = encodeURIComponent(`${projectRelPath}@${className}`);
	const { takePendingModule } = await import('./fastHmrCompiler');
	const cached = takePendingModule(cacheKey);
	if (cached !== undefined) {
		return cached;
	}

	// Detect entity kind from the file content so the surgical path
	// branches correctly (component → IR + prototype patch; pipe /
	// directive / service → prototype patch only). The dispatcher in
	// `rebuildTrigger.ts` also passes kind, but the `/@ng/component`
	// endpoint is hit directly by the browser too (via the injected
	// `__ng_hmr_load` listener) and that path has only the encoded
	// id — so we re-detect here.
	const { resolveOwningComponents } = await import(
		'./resolveOwningComponents'
	);
	const owners = resolveOwningComponents({
		changedFilePath: componentFilePath,
		userAngularRoot: dirname(componentFilePath)
	});
	const owner = owners.find((o) => o.className === className);
	const kind = owner?.kind ?? 'component';

	const fastStart = performance.now();
	const fast = await tryFastHmr({ className, componentFilePath, kind });
	if (fast.ok) {
		logInfo(
			`[ng-hmr fast/${kind}] ${className} ${(performance.now() - fastStart).toFixed(1)}ms`
		);

		return fast.moduleText;
	}

	// Fast-path failures that aren't fingerprint mismatches (parse
	// errors, missing template/style files, inheritance from a
	// decorated parent, etc.) are structural — the dispatcher
	// escalates to Tier 1b rebootstrap. The endpoint just signals
	// "no surgical update available" and lets the rebootstrap broadcast
	// take over.
	return null;
};
