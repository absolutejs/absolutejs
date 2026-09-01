import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import {
	captureSsrTextBaselines,
	prepareBrowserTranslationHydration,
	preserveBrowserTranslation
} from '../../../src/vue/browserTranslation';
import type { HydrationStrategy } from 'vue';

beforeAll(() => GlobalRegistrator.register());
afterAll(() => GlobalRegistrator.unregister());

const translatedFixture = () => {
	document.body.innerHTML =
		'<main id="root"><section><h3>AI Matching</h3><button>Open</button></section></main>';
	const root = document.querySelector<HTMLElement>('#root');
	const heading = document.querySelector<HTMLElement>('h3');
	if (root === null || heading === null) throw new Error('fixture missing');
	captureSsrTextBaselines(root);
	heading.textContent = 'AIマッチング';

	return { heading, root };
};

describe('browser translation hydration', () => {
	test('restores translated text after root hydration without replacing elements', () => {
		const { heading, root } = translatedFixture();
		const restore = prepareBrowserTranslationHydration(root);
		expect(heading.textContent).toBe('AI Matching');
		let clicks = 0;
		heading.addEventListener('click', () => clicks++);
		restore();
		heading.click();
		expect(heading.textContent).toBe('AIマッチング');
		expect(clicks).toBe(1);
	});

	test('wraps lazy hydration and preserves the strategy teardown', () => {
		const { heading, root } = translatedFixture();
		let trigger: () => void = () => undefined;
		let tornDown = false;
		const strategy: HydrationStrategy = (hydrate) => {
			trigger = hydrate;

			return () => {
				tornDown = true;
			};
		};
		const teardown = preserveBrowserTranslation(strategy)(
			() => expect(heading.textContent).toBe('AI Matching'),
			(callback) => callback(root)
		);
		trigger();
		expect(heading.textContent).toBe('AIマッチング');
		teardown?.();
		expect(tornDown).toBe(true);
	});

	test('does not hide an ordinary client render change', () => {
		document.body.innerHTML = '<main id="root"><h3>Server text</h3></main>';
		const root = document.querySelector<HTMLElement>('#root');
		const heading = document.querySelector<HTMLElement>('h3');
		if (root === null || heading === null)
			throw new Error('fixture missing');
		captureSsrTextBaselines(root);
		const restore = prepareBrowserTranslationHydration(root);
		heading.textContent = 'Client text';
		restore();
		expect(heading.textContent).toBe('Client text');
	});

	test('restores translated text when a framework replaces the rendered nodes', () => {
		const { root } = translatedFixture();
		const restore = prepareBrowserTranslationHydration(root);
		root.innerHTML =
			'<section><h3>AI Matching</h3><button>Open</button></section>';
		restore();
		expect(root.querySelector('h3')?.textContent).toBe('AIマッチング');
	});
});
