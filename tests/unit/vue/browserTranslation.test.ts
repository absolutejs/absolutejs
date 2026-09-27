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

const required = <T>(value: T | null | undefined) => {
	if (value === null || value === undefined)
		throw new Error('fixture missing');

	return value;
};

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
	test('preserves translated human-readable attributes without changing URLs or field values', () => {
		document.body.innerHTML =
			'<main id="root"><img alt="Award" title="Winner" src="/original.png"><input placeholder="Name" aria-label="Your name" value="Original"></main>';
		const root = required(document.querySelector<HTMLElement>('#root'));
		const img = required(root.querySelector('img'));
		const input = required(root.querySelector('input'));
		captureSsrTextBaselines(root);
		img.alt = '受賞';
		img.title = '受賞者';
		img.setAttribute('src', '/changed.png');
		input.placeholder = '名前';
		input.setAttribute('aria-label', 'あなたの名前');
		input.value = 'Typed value';
		const restore = prepareBrowserTranslationHydration(root);
		expect(img.alt).toBe('Award');
		expect(img.title).toBe('Winner');
		expect(input.placeholder).toBe('Name');
		expect(input.getAttribute('aria-label')).toBe('Your name');
		expect(img.getAttribute('src')).toBe('/changed.png');
		expect(input.value).toBe('Typed value');
		restore();
		expect(img.alt).toBe('受賞');
		expect(img.title).toBe('受賞者');
		expect(input.placeholder).toBe('名前');
		expect(input.getAttribute('aria-label')).toBe('あなたの名前');
	});

	test('unwraps only inserted text-only font trees before hydration and preserves their translation', () => {
		document.body.innerHTML =
			'<main id="root"><p>Founder <a href="/profile">Profile</a></p></main>';
		const root = required(document.querySelector<HTMLElement>('#root'));
		const paragraph = required(root.querySelector('p'));
		const link = required(root.querySelector('a'));
		let clicks = 0;
		link.addEventListener('click', (event) => {
			event.preventDefault();
			clicks++;
		});
		captureSsrTextBaselines(root);
		const wrapper = document.createElement('font');
		wrapper.innerHTML = '<font>創設者 </font>';
		required(paragraph.firstChild).replaceWith(wrapper);
		const restore = prepareBrowserTranslationHydration(root);
		expect(paragraph.firstChild?.textContent).toBe('Founder ');
		expect(paragraph.querySelector('font')).toBeNull();
		expect(paragraph.querySelector('a')).toBe(link);
		restore();
		expect(paragraph.firstChild?.textContent).toBe('創設者 ');
		link.click();
		expect(clicks).toBe(1);
	});

	test('does not flatten authored font elements or new interactive markup', () => {
		document.body.innerHTML =
			'<main id="root"><p><font>Authored</font></p><h3>Matching</h3></main>';
		const root = required(document.querySelector<HTMLElement>('#root'));
		const authored = required(root.querySelector('font'));
		captureSsrTextBaselines(root);
		required(root.querySelector('h3')).innerHTML =
			'<font><button>Inserted</button></font>';
		const restore = prepareBrowserTranslationHydration(root);
		expect(root.querySelector('font')).toBe(authored);
		expect(root.querySelector('button')).not.toBeNull();
		restore();
		expect(root.querySelectorAll('font')).toHaveLength(2);
	});

	test('does not overwrite attribute changes made by the client while hydrating', () => {
		document.body.innerHTML = '<main id="root"><img alt="Award"></main>';
		const root = required(document.querySelector<HTMLElement>('#root'));
		const img = required(root.querySelector('img'));
		captureSsrTextBaselines(root);
		img.alt = '受賞';
		const restore = prepareBrowserTranslationHydration(root);
		img.alt = 'New client description';
		restore();
		expect(img.alt).toBe('New client description');
	});
});
