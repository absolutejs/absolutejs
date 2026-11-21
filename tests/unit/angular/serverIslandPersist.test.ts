import { describe, expect, test } from 'bun:test';
import { setCurrentIslandRegistry } from '../../../src/core/currentIslandRegistry';
import { lowerAngularServerIslands } from '../../../src/angular/lowerServerIslands';

/* `persist` has to survive the Angular island lowering.
 *
 * An Angular page's islands are built from the attributes on
 * `<absolute-island>` by this lowering, so a key it does not read never
 * reaches the island's marker — and the navigation layer matches a live
 * island against the incoming page by exactly that marker. Vue had the
 * same gap through an undeclared prop, where it cost a day's wrong theory
 * about Vue's hydration; this is the cheap check that the plumbing is
 * there.
 *
 * What this does NOT prove is that an Angular page as the destination of a
 * persisted island works end to end: that needs the spawned-app harness,
 * and `docs/CROSS_FRAMEWORK_NAVIGATION_PLAN.md` says so. */

type FakeRegistry = { svelte: { Shell: () => undefined } };

const registry: FakeRegistry = {
	svelte: {
		Shell: () => undefined
	}
};

describe('the Angular server island lowering', () => {
	test('carries a persist key onto the island marker', async () => {
		setCurrentIslandRegistry(registry as never);
		try {
			const html = await lowerAngularServerIslands(
				'<absolute-island component="Shell" framework="svelte" persist="navbar" data-abs-props="{}"></absolute-island>'
			);

			expect(html).toContain('data-absolute-persist="navbar"');
			expect(html).toContain('data-island="true"');
		} finally {
			setCurrentIslandRegistry(undefined);
		}
	});

	test('omits the attribute when no key was given', async () => {
		setCurrentIslandRegistry(registry as never);
		try {
			const html = await lowerAngularServerIslands(
				'<absolute-island component="Shell" framework="svelte" data-abs-props="{}"></absolute-island>'
			);

			expect(html).not.toContain('data-absolute-persist');
			expect(html).toContain('data-island="true"');
		} finally {
			setCurrentIslandRegistry(undefined);
		}
	});
});
