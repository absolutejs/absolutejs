import { describe, expect, test } from 'bun:test';
import {
	hydrateMediaOf,
	hydrateModeOf
} from '../../../src/core/islandHydrateMode';
import { getIslandMarkerAttributes } from '../../../src/core/islandMarkupAttributes';

/* An island could hydrate on `load`, `idle`, `visible` or not at all.
 * Two strategies were missing and both exist to avoid paying for a
 * component that is not wanted yet: `interaction`, for something heavy
 * nobody has reached for, and `media`, for a widget that belongs to one
 * layout and not another — where `visible` still pays the moment it
 * scrolls past on the layout that hides it. */

describe('what the markup carries', () => {
	test('a plain strategy is the attribute', () => {
		expect(hydrateModeOf('idle')).toBe('idle');
		expect(hydrateModeOf('interaction')).toBe('interaction');
	});

	test('no strategy means load', () => {
		expect(hydrateModeOf(undefined)).toBe('load');
	});

	/* A media query has colons, parentheses and spaces in it. Packing it
	 * into `data-hydrate` would mean parsing it back out of an attribute
	 * that every other strategy fills with one plain word. */
	test('a media strategy splits into a mode and a query', () => {
		expect(hydrateModeOf({ media: '(min-width: 48rem)' })).toBe('media');
		expect(hydrateMediaOf({ media: '(min-width: 48rem)' })).toBe(
			'(min-width: 48rem)'
		);
	});

	test('every other strategy has no query', () => {
		expect(hydrateMediaOf('visible')).toBeUndefined();
		expect(hydrateMediaOf(undefined)).toBeUndefined();
	});
});

describe('the rendered island attributes', () => {
	test('a media island renders both attributes', () => {
		const attributes = getIslandMarkerAttributes({
			component: 'Sidebar',
			framework: 'svelte',
			hydrate: { media: '(min-width: 48rem)' },
			props: {}
		});

		expect(attributes['data-hydrate']).toBe('media');
		expect(attributes['data-hydrate-media']).toBe('(min-width: 48rem)');
	});

	test('an interaction island renders the word', () => {
		expect(
			getIslandMarkerAttributes({
				component: 'Editor',
				framework: 'react',
				hydrate: 'interaction',
				props: {}
			})['data-hydrate']
		).toBe('interaction');
	});

	/* Nothing gains an empty query attribute: it would show up in every
	 * island's markup on every page. */
	test('a non-media island carries no query attribute', () => {
		expect(
			getIslandMarkerAttributes({
				component: 'Counter',
				framework: 'vue',
				hydrate: 'idle',
				props: {}
			})
		).not.toHaveProperty('data-hydrate-media');
	});
});
