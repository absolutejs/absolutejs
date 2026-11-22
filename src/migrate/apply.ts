/* The writing edge of the migration engine, and the only one.
 *
 * `scan.ts` reads and `codemods.ts` decides; this writes, and it writes
 * only what `planCodemods` put in `mechanical`. Nothing here chooses what
 * to change: hand it a plan and it puts those exact file texts on disk, so
 * the thing a caller previewed is the thing that lands.
 *
 * Deliberately not write-by-default anywhere upstream. `upgrade` applies
 * our own migrations to our own API and asks for `--dry-run` to stop it;
 * this rewrites somebody's Next.js app, so the CLI previews unless it is
 * told `--apply`. */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CodemodPlan } from './codemods';

export type AppliedFile = {
	/** Local bindings that moved, for the report. */
	bindings: string[];
	path: string;
};

export type ApplyResult = {
	applied: AppliedFile[];
	/** Files that could not be written, with the reason. */
	failed: { path: string; reason: string }[];
};

/** Write the mechanical half of a plan. Returns what landed and what did
 *  not; an unwritable file is reported, never thrown, so one read-only
 *  path cannot abandon a half-applied migration. */
export const applyCodemodPlan = (root: string, plan: CodemodPlan) =>
	plan.mechanical.reduce<ApplyResult>(
		(carry, edit) => {
			try {
				writeFileSync(join(root, edit.path), edit.rewritten);
				carry.applied.push({
					bindings: edit.hits.map((hit) => hit.local),
					path: edit.path
				});
			} catch (error) {
				carry.failed.push({
					path: edit.path,
					reason:
						error instanceof Error ? error.message : String(error)
				});
			}

			return carry;
		},
		{ applied: [], failed: [] }
	);
