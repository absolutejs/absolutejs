import '@angular/compiler';
import { APP_BASE_HREF, DOCUMENT, NgComponentOutlet } from '@angular/common';
import * as core from '@angular/core';
import * as platformBrowser from '@angular/platform-browser';
import * as platformServer from '@angular/platform-server';
import { describe, expect, test } from 'bun:test';
import type { AngularDeps } from '../../../types/angular';
import { renderAngularApp } from '../../../src/angular/ssrRender';

/* `renderApplication` finishes the HTML and then awaits a `setTimeout(0)`
 * before returning it, to tear the platform down. A timer hop costs
 * 1.14ms here and the render itself 0.14ms, so nine tenths of every
 * Angular render was idle. Measured on the example app's production
 * build, one connection: 575 requests a second before, 2,589 after.
 *
 * These pin the BEHAVIOUR rather than the time, because a timing
 * assertion is the kind that passes on a laptop and fails in CI: the
 * HTML comes back before teardown has run, it is the same HTML, and
 * teardown still happens. */

const deps: AngularDeps = {
	APP_BASE_HREF,
	BEFORE_APP_SERIALIZED: platformServer.BEFORE_APP_SERIALIZED,
	bootstrapApplication: platformBrowser.bootstrapApplication,
	Component: core.Component,
	CSP_NONCE: core.CSP_NONCE,
	DomSanitizer: platformBrowser.DomSanitizer,
	ENVIRONMENT_INITIALIZER: core.ENVIRONMENT_INITIALIZER,
	inject: core.inject,
	InjectionToken: core.InjectionToken,
	NgComponentOutlet,
	PlatformState: platformServer.PlatformState,
	provideClientHydration: platformBrowser.provideClientHydration,
	provideServerRendering: platformServer.provideServerRendering,
	provideZoneChangeDetection: core.provideZoneChangeDetection,
	provideZonelessChangeDetection: core.provideZonelessChangeDetection,
	reflectComponentType: core.reflectComponentType,
	renderApplication: platformServer.renderApplication,
	REQUEST: core.REQUEST,
	REQUEST_CONTEXT: core.REQUEST_CONTEXT,
	RESPONSE_INIT: core.RESPONSE_INIT,
	Sanitizer: core.Sanitizer,
	SecurityContext: core.SecurityContext,
	withEventReplay: platformBrowser.withEventReplay,
	withHttpTransferCacheOptions: platformBrowser.withHttpTransferCacheOptions
};

/* What a build of Angular without the two tokens looks like — the
 * compiled-app stub, or a future release that moved them. */
const depsWithoutHandoff: AngularDeps = {
	...deps,
	BEFORE_APP_SERIALIZED: undefined,
	PlatformState: undefined
};

const DOCUMENT_HTML =
	'<!DOCTYPE html><html><head><title>t</title></head><body><handoff-page></handoff-page></body></html>';

const baseProviders = () => [
	platformServer.provideServerRendering(),
	platformBrowser.provideClientHydration(platformBrowser.withEventReplay()),
	core.provideZonelessChangeDetection()
];

const definePage = (hooks: { onDestroy?: () => void } = {}) => {
	class HandoffPage {
		count = 3;

		ngOnDestroy() {
			hooks.onDestroy?.();
		}
	}

	return core.Component({
		selector: 'handoff-page',
		standalone: true,
		template:
			'<main><h1>hand-off</h1><button (click)="count = count + 1">{{ count }}</button></main>'
	})(HandoffPage);
};

const nextTimerTick = () =>
	new Promise<void>((resolve) => {
		setTimeout(resolve, 10);
	});

describe('the HTML an Angular render hands back', () => {
	test('is the same document renderApplication returns', async () => {
		const Page = definePage();
		const plain = await platformServer.renderApplication(
			(context) =>
				platformBrowser.bootstrapApplication(
					Page,
					{ providers: baseProviders() },
					context
				),
			{ document: DOCUMENT_HTML, url: '/' }
		);
		const early = await renderAngularApp(
			deps,
			Page,
			baseProviders(),
			DOCUMENT_HTML,
			'/'
		);

		expect(early).toBe(plain);
		// hydration annotation and event replay both ran before it
		expect(early).toContain('ngh=');
		expect(early).toContain('jsaction');
	});

	/* The whole point, stated without a clock: when the HTML arrives the
	 * platform has NOT been destroyed yet. `renderApplication` only ever
	 * returns after it has. */
	test('arrives before teardown, and teardown still runs', async () => {
		let destroyed = false;
		const Page = definePage({
			onDestroy: () => {
				destroyed = true;
			}
		});

		const html = await renderAngularApp(
			deps,
			Page,
			baseProviders(),
			DOCUMENT_HTML,
			'/'
		);

		expect(html).toContain('hand-off');
		expect(destroyed).toBe(false);

		await nextTimerTick();
		expect(destroyed).toBe(true);
	});

	/* Other `BEFORE_APP_SERIALIZED` callbacks may be async and may change
	 * the document. Angular invokes every callback before awaiting any,
	 * and serializes only after all have settled — so wrapping the
	 * serializer, rather than serializing from inside our own callback,
	 * is what keeps a late change in the output. */
	test('includes what a slow serialization callback adds', async () => {
		const Page = definePage();
		const slowCallback: core.Provider = {
			multi: true,
			provide: platformServer.BEFORE_APP_SERIALIZED,
			useFactory: () => {
				const document = core.inject(DOCUMENT);

				return async () => {
					await nextTimerTick();
					document.body.setAttribute('data-late', 'yes');
				};
			}
		};

		const html = await renderAngularApp(
			deps,
			Page,
			[...baseProviders(), slowCallback],
			DOCUMENT_HTML,
			'/'
		);

		expect(html).toContain('data-late="yes"');
	});
});

describe('when the hand-off cannot happen', () => {
	/* Fails toward what it did before: with no tokens there is nothing to
	 * race, and the render is `renderApplication`, teardown first. */
	test('an Angular without the tokens still renders', async () => {
		let destroyed = false;
		const Page = definePage({
			onDestroy: () => {
				destroyed = true;
			}
		});

		const html = await renderAngularApp(
			depsWithoutHandoff,
			Page,
			baseProviders(),
			DOCUMENT_HTML,
			'/'
		);

		expect(html).toContain('hand-off');
		expect(destroyed).toBe(true);
	});

	/* A render that throws never reaches the serializer, so the race is
	 * won by `renderApplication` rejecting — the caller sees the error
	 * exactly as it did, and can still answer with an error page. */
	test('a render that fails still rejects', async () => {
		class Broken {
			constructor() {
				throw new Error('component exploded');
			}
		}
		const Page = core.Component({
			selector: 'handoff-page',
			standalone: true,
			template: '<p>never</p>'
		})(Broken);

		await expect(
			renderAngularApp(deps, Page, baseProviders(), DOCUMENT_HTML, '/')
		).rejects.toThrow('component exploded');
	});
});

/* Not asserted here, and worth knowing: an `ngOnDestroy` that throws on
 * the server leaves stock `renderApplication` pending forever, because
 * Angular destroys the platform inside a timer callback and resolves only
 * afterwards. Measured — still pending after two seconds. With the
 * hand-off the page has already been returned. It cannot be a test: the
 * throw surfaces as an uncaught exception in Angular's timer, and
 * `bun:test` fails any test during which one fires, handled or not. */
