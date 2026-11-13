import { describe, expect, test } from 'bun:test';
import { compile } from 'svelte/compiler';
import { lowerSvelteAwaitSlotSyntax } from '../../../src/svelte/lowerAwaitSlotSyntax';

describe('lowerSvelteAwaitSlotSyntax', () => {
	test('leaves a plain {#await} block to Svelte', () => {
		const source = `<script lang="ts">
	import Child from './Child.svelte';
	const data = Promise.resolve(1);
</script>

{#await data}
	<p>Loading...</p>
{:then value}
	{#if value > 0}<Child {value} />{/if}
{:catch error}
	<p>{error.message}</p>
{/await}
`;
		const lowered = lowerSvelteAwaitSlotSyntax(source);

		expect(lowered.transformed).toBe(false);
		expect(lowered.code).toBe(source);
	});

	test('leaves the shorthand form next to a normal block untouched, and both compile', () => {
		// beta.168's lazy regex matched from the shorthand block's `{#await`
		// to the second block's `{/await}`, and Svelte then failed with
		// "Unterminated regular expression".
		const source = `<script lang="ts">
	const first = Promise.resolve('a');
	const second = Promise.resolve('b');
</script>

{#await first then value}
	<p>{value}</p>
{/await}

{#await second}
	<p>loading</p>
{:then value}
	<p>{value}</p>
{/await}
`;
		const lowered = lowerSvelteAwaitSlotSyntax(source);

		expect(lowered.transformed).toBe(false);
		expect(() =>
			compile(lowered.code, { generate: 'client' })
		).not.toThrow();
	});

	test('streams a block marked with the directive', () => {
		const source = `
<!-- absolute:stream -->
{#await loadData()}
  <p>Loading...</p>
{:then value}
  <article class={value.kind}>{value.title}</article>
{/await}
`;
		const lowered = lowerSvelteAwaitSlotSyntax(source);

		expect(lowered.transformed).toBe(true);
		expect(lowered.code).toContain('AbsoluteAwaitSlot');
		expect(lowered.code).toContain('id="absolute-svelte-await-0"');
		expect(lowered.code).toContain('fallbackHtml={`<p>Loading...</p>`}');
		expect(lowered.code).toContain(
			'return `<article class=${value.kind}>${value.title}</article>`;'
		);
		expect(lowered.code).not.toContain('absolute:stream');
		expect(lowered.code).not.toContain('{#await');
	});

	test('streams only the marked block when a shorthand block precedes it', () => {
		const source = `<script lang="ts">
	const first = Promise.resolve('a');
	const second = () => Promise.resolve({ label: 'b' });
</script>

{#await first then value}
	<p>{value}</p>
{/await}

<!-- absolute:stream -->
{#await second({ retry: true })}
	<p>loading</p>
{:then value}
	<p>{value.label}</p>
{:catch error}
	<p>{error.message}</p>
{/await}
`;
		const lowered = lowerSvelteAwaitSlotSyntax(source);

		expect(lowered.transformed).toBe(true);
		expect(lowered.code).toContain('{#await first then value}');
		expect(lowered.code).toContain('await (second({ retry: true }))');
		expect(lowered.code).toContain(
			'catch (error) { return `<p>${error.message}</p>`; }'
		);
		expect(() =>
			compile(lowered.code, { generate: 'server' })
		).not.toThrow();
	});

	test('rejects a streamed branch that needs Svelte to render it', () => {
		const withComponent = `<!-- absolute:stream -->
{#await load()}
	<p>loading</p>
{:then value}
	<Child {value} />
{/await}`;
		const withIf = `<!-- absolute:stream -->
{#await load()}
	<p>loading</p>
{:then value}
	{#if value}<p>yes</p>{/if}
{/await}`;

		expect(() =>
			lowerSvelteAwaitSlotSyntax(withComponent, 'Page.svelte')
		).toThrow(/Page\.svelte: the then branch .*<C/);
		expect(() => lowerSvelteAwaitSlotSyntax(withIf)).toThrow(
			/the then branch .*\{#if value\}/
		);
	});

	test('rejects a streamed shorthand block and a stray directive', () => {
		expect(() =>
			lowerSvelteAwaitSlotSyntax(
				'<!-- absolute:stream -->\n{#await load() then value}<p>{value}</p>{/await}'
			)
		).toThrow(/needs a pending branch/);
		expect(() =>
			lowerSvelteAwaitSlotSyntax('<!-- absolute:stream -->\n<p>hello</p>')
		).toThrow(/directly before an \{#await\}/);
	});

	test('returns unchanged source when no block is marked', () => {
		const source = `<main><p>No await</p></main>`;
		const lowered = lowerSvelteAwaitSlotSyntax(source);

		expect(lowered.transformed).toBe(false);
		expect(lowered.code).toBe(source);
	});
	test('marks a block dynamic with the `dynamic` directive', () => {
		const source = `<script lang="ts">
	const greeting = Promise.resolve('hi');
	const prices = Promise.resolve([1]);
</script>

<!-- absolute:stream dynamic -->
{#await greeting}
	<p>loading</p>
{:then value}
	<p>{value}</p>
{/await}

<!-- absolute:stream -->
{#await prices}
	<p>loading</p>
{:then value}
	<p>{value.length}</p>
{/await}
`;
		const lowered = lowerSvelteAwaitSlotSyntax(source);

		expect(lowered.transformed).toBe(true);
		expect(lowered.code).toContain(
			'<AbsoluteAwaitSlot id="absolute-svelte-await-0" dynamic fallbackHtml'
		);
		expect(lowered.code).toContain(
			'<AbsoluteAwaitSlot id="absolute-svelte-await-1" fallbackHtml'
		);
		expect(lowered.code).not.toContain('absolute:stream');
	});
});
