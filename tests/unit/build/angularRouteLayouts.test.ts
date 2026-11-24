import { describe, expect, test } from 'bun:test';
import {
	readAngularLayoutMeta,
	wrapAngularRouteLayouts,
	type AngularLayoutImport
} from '../../../src/build/angularRouteLayouts';

/* Wrapping an Angular file route in its layouts, in the SOURCE — the same
 * place as Svelte and Vue, because an Angular page also renders from one
 * compiled module that both the server render and the client bootstrap
 * load.
 *
 * What Angular adds: a template names a component by its SELECTOR, so the
 * wrap needs each layout's own `@Component` read for the selector AND the
 * class, and the class has to reach the page's `imports`. Three edits in
 * one file, applied back-to-front, which is what these tests check — an
 * import that lands inside the template, or an `imports` entry written at
 * a stale offset, is the failure the Svelte transform shipped once. */

const layout = (
	overrides: Partial<AngularLayoutImport> = {}
): AngularLayoutImport => ({
	className: 'ShellLayout',
	selector: 'app-shell',
	specifier: './layout',
	...overrides
});

const PAGE = `import { Component } from '@angular/core';

@Component({
	imports: [NgIf],
	selector: 'topic-page',
	standalone: true,
	template: \`<h1>topic</h1>\`
})
export class TopicPage {}
`;

describe('readAngularLayoutMeta', () => {
	test('reads the class and the selector', () => {
		expect(
			readAngularLayoutMeta(`import { Component } from '@angular/core';

@Component({
	selector: 'app-shell',
	standalone: true,
	template: \`<ng-content />\`
})
export class ShellLayout {}
`)
		).toEqual({ className: 'ShellLayout', selector: 'app-shell' });
	});

	/* An empty selector rather than a throw: a component without one
	 * cannot appear in a template, and saying so with the file's name is
	 * the caller's job. */
	test('reports a missing selector as an empty one', () => {
		expect(
			readAngularLayoutMeta(`import { Component } from '@angular/core';

@Component({ template: '<ng-content />' })
export class ShellLayout {}
`)
		).toEqual({ className: 'ShellLayout', selector: '' });
	});

	test('is null for a file that exports no component', () => {
		expect(readAngularLayoutMeta('export const x = 1;')).toBeNull();
	});
});

describe('wrapAngularRouteLayouts', () => {
	test('wraps the template outermost first and imports the layouts', () => {
		const result = wrapAngularRouteLayouts(PAGE, {
			layouts: [
				layout(),
				layout({
					className: 'PlansLayout',
					selector: 'app-plans',
					specifier: './plans/layout'
				})
			]
		});
		if (result.kind !== 'wrapped') throw new Error(result.kind);

		expect(result.source).toContain(
			"import { ShellLayout } from './layout';"
		);
		expect(result.source).toContain(
			"import { PlansLayout } from './plans/layout';"
		);
		/* Ordered: asserting that both selectors merely appear would pass
		 * with the nesting inverted. */
		expect(result.source).toContain(
			'<app-shell><app-plans><h1>topic</h1></app-plans></app-shell>'
		);
		// Added to the existing array, not replacing what was there.
		expect(result.source).toContain(
			'imports: [NgIf, ShellLayout, PlansLayout]'
		);
		// The generated import stayed out of the template.
		expect(result.source).not.toMatch(/template:[\s\S]*import \{ Shell/);
	});

	test('adds an imports array to a component that has none', () => {
		const result = wrapAngularRouteLayouts(
			`import { Component } from '@angular/core';

@Component({
	selector: 'topic-page',
	standalone: true,
	template: '<h1>topic</h1>'
})
export class TopicPage {}
`,
			{ layouts: [layout()] }
		);
		if (result.kind !== 'wrapped') throw new Error(result.kind);

		expect(result.source).toContain('imports: [ShellLayout]');
		expect(result.source).toContain(
			'<app-shell><h1>topic</h1></app-shell>'
		);
	});

	/* A template expression keeps its substitutions: the wrap is written
	 * INSIDE the existing literal rather than replacing it. */
	test('keeps an interpolating template intact', () => {
		const result = wrapAngularRouteLayouts(
			`import { Component } from '@angular/core';
const TITLE = 'x';

@Component({
	selector: 'topic-page',
	standalone: true,
	template: \`<h1>\${TITLE}</h1>\`
})
export class TopicPage {}
`,
			{ layouts: [layout()] }
		);
		if (result.kind !== 'wrapped') throw new Error(result.kind);

		expect(result.source).toContain(
			'<app-shell><h1>${TITLE}</h1></app-shell>'
		);
	});

	test('skips a route with no layouts', () => {
		expect(wrapAngularRouteLayouts(PAGE, { layouts: [] })).toEqual({
			kind: 'skipped'
		});
	});

	/* Reported rather than guessed. A file route with several components
	 * is a router host with co-located children, and picking one of them
	 * would wrap the wrong template as readily as the right one. */
	test('reports a page that exports more than one component', () => {
		const result = wrapAngularRouteLayouts(
			`import { Component } from '@angular/core';

@Component({ selector: 'a-page', template: '<i></i>' })
export class APage {}

@Component({ selector: 'b-page', template: '<i></i>' })
export class BPage {}
`,
			{ layouts: [layout()] }
		);

		expect(result.kind).toBe('problem');
		expect(result.kind === 'problem' && result.message).toContain(
			'APage, BPage'
		);
	});

	test('reports a page whose component has no inline template', () => {
		const result = wrapAngularRouteLayouts(
			`import { Component } from '@angular/core';

@Component({ selector: 'topic-page', templateUrl: './topic.html' })
export class TopicPage {}
`,
			{ layouts: [layout()] }
		);

		expect(result.kind).toBe('problem');
		expect(result.kind === 'problem' && result.message).toContain(
			'no inline `template`'
		);
	});
});
