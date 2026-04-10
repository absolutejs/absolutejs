import { describe, expect, test } from 'bun:test';
import { lowerSvelteAwaitSlotSyntax } from '../../../src/svelte/lowerAwaitSlotSyntax';

describe('lowerSvelteAwaitSlotSyntax', () => {
	test('rewrites raw await blocks to AwaitSlot component usage', () => {
		const source = `
{#await loadData()}
  <p>Loading...</p>
{:then value}
  <article>{value}</article>
{/await}
`;
		const lowered = lowerSvelteAwaitSlotSyntax(source);

		expect(lowered.transformed).toBe(true);
		expect(lowered.code).toContain('AbsoluteAwaitSlot');
		expect(lowered.code).toContain('id="absolute-svelte-await-0"');
		expect(lowered.code).toContain('fallbackHtml=');
		expect(lowered.code).toContain('resolve={async () =>');
	});

	test('returns unchanged source when no await block is present', () => {
		const source = `<main><p>No await</p></main>`;
		const lowered = lowerSvelteAwaitSlotSyntax(source);

		expect(lowered.transformed).toBe(false);
		expect(lowered.code).toBe(source);
	});

	test('trims outer whitespace from lowered fallback and resolved markup', () => {
		const source = `
{#await loadData()}
	<div> loading </div>
{:then value}
	<section>{value}</section>
{/await}
`;
		const lowered = lowerSvelteAwaitSlotSyntax(source);

		expect(lowered.transformed).toBe(true);
		expect(lowered.code).toContain('fallbackHtml={`<div> loading </div>`}');
		expect(lowered.code).toContain('return `<section>${value}</section>`;');
	});
});
