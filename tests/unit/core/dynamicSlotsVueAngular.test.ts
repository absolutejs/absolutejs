import { afterEach, describe, expect, test } from 'bun:test';
import {
	ChangeDetectorRef,
	Injector,
	PLATFORM_ID,
	runInInjectionContext
} from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import type { StreamingSlot } from '../../../src/utils/streamingSlots';
import { StreamSlotComponent } from '../../../src/angular/components/stream-slot.component';
import {
	setStreamingSlotCollectionController,
	setStreamingSlotRegistrar
} from '../../../src/core/streamingSlotRegistrar';
import { SuspenseSlot } from '../../../src/vue/components/SuspenseSlot';
import { StreamSlot } from '../../../src/vue/components/StreamSlot';
import { DeferSlotComponent } from '../../../src/angular/components/defer-slot.component';

/* Partial prerendering keeps a page's shell in the cache and renders only
 * the slots marked `dynamic` per request. React's and Svelte's slots have
 * taken that flag since Phase 1; Vue's and Angular's dropped it on the
 * floor, so every slot on those pages was baked into the shell — a
 * per-request greeting would have been served from the cache to everyone.
 *
 * These assert the flag reaches the registrar, which is what the shell
 * collector reads. */

const collected: StreamingSlot[] = [];

/* The controller is an object with `isCollecting()`, and the registrar a
 * function; both live on globalThis, which is how a component reaches
 * them without importing the server.
 *
 * They are also process-wide, and the page handlers install their own at
 * module load — so these are saved and put back rather than cleared.
 * Clearing them made every later streaming test in this process warn
 * "without streaming slot collection enabled" and stream nothing. */
const REGISTRAR_KEY = Symbol.for('absolutejs.streamingSlotRegistrar');
const CONTROLLER_KEY = Symbol.for(
	'absolutejs.streamingSlotCollectionController'
);

const previous: { controller: unknown; registrar: unknown } = {
	controller: undefined,
	registrar: undefined
};

const collect = () => {
	collected.length = 0;
	previous.controller = Reflect.get(globalThis, CONTROLLER_KEY);
	previous.registrar = Reflect.get(globalThis, REGISTRAR_KEY);
	setStreamingSlotCollectionController({ isCollecting: () => true });
	setStreamingSlotRegistrar((slot) => {
		collected.push(slot);
	});
};

afterEach(() => {
	Reflect.set(globalThis, CONTROLLER_KEY, previous.controller);
	Reflect.set(globalThis, REGISTRAR_KEY, previous.registrar);
});

const resolve = () => '<section>resolved</section>';

/* DeferSlot resolves to Angular's own payload shape, not HTML. */
const resolveDefer = () =>
	Promise.resolve({
		data: { value: 'resolved' },
		html: '<section>resolved</section>',
		kind: 'angular-defer' as const
	});

describe('Vue StreamSlot', () => {
	test('passes dynamic through to the registrar', async () => {
		collect();
		await renderToString(
			createSSRApp(() =>
				h('div', [
					h(StreamSlot, {
						dynamic: true,
						fallbackHtml: '<p>loading</p>',
						id: 'vue-greeting',
						resolve
					}),
					h(StreamSlot, {
						fallbackHtml: '<p>loading</p>',
						id: 'vue-static',
						resolve
					})
				])
			)
		);

		expect(
			collected.map((slot) => [slot.id, slot.dynamic === true])
		).toEqual([
			['vue-greeting', true],
			['vue-static', false]
		]);
	});
});

describe('Angular StreamSlotComponent', () => {
	const mount = (dynamic: boolean | undefined, id: string) => {
		const injector = Injector.create({
			providers: [
				{
					provide: ChangeDetectorRef,
					useValue: { markForCheck: () => undefined }
				},
				{
					provide: DomSanitizer,
					useValue: {
						bypassSecurityTrustHtml: (html: string) => html
					}
				}
			]
		});
		const component = runInInjectionContext(
			injector,
			() => new StreamSlotComponent()
		);
		component.id = id;
		component.resolve = resolve;
		component.fallbackHtml = '<p>loading</p>';
		component.dynamic = dynamic;
		component.ngOnInit();
	};

	test('passes dynamic through to the registrar', () => {
		collect();
		mount(true, 'angular-greeting');
		mount(undefined, 'angular-static');

		expect(
			collected.map((slot) => [slot.id, slot.dynamic === true])
		).toEqual([
			['angular-greeting', true],
			['angular-static', false]
		]);
	});
});

describe("the other frameworks' hole primitives", () => {
	test("Vue's SuspenseSlot passes dynamic through", async () => {
		collect();
		await renderToString(
			createSSRApp(() =>
				h(SuspenseSlot, {
					dynamic: true,
					fallbackHtml: '<p>loading</p>',
					id: 'vue-suspense',
					resolve: () => 'resolved'
				})
			)
		);

		expect(
			collected.map((slot) => [slot.id, slot.dynamic === true])
		).toEqual([['vue-suspense', true]]);
	});

	test("Angular's DeferSlot passes dynamic through", () => {
		collect();
		// DeferSlot registers a slot only in the server render, so it
		// reads PLATFORM_ID — without 'server' here it would take the
		// browser path and register nothing.
		const injector = Injector.create({
			providers: [
				{
					provide: ChangeDetectorRef,
					useValue: { markForCheck: () => undefined }
				},
				{
					provide: DomSanitizer,
					useValue: {
						bypassSecurityTrustHtml: (html: string) => html
					}
				},
				{ provide: PLATFORM_ID, useValue: 'server' }
			]
		});
		const component = runInInjectionContext(
			injector,
			() => new DeferSlotComponent()
		);
		component.id = 'angular-defer';
		component.resolve = resolveDefer;
		component.dynamic = true;
		component.ngOnInit();

		expect(
			collected.map((slot) => [slot.id, slot.dynamic === true])
		).toEqual([['angular-defer', true]]);
	});
});
