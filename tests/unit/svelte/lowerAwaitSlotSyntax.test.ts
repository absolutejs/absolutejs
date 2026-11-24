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
		/* The id ends in the block's index; what precedes it identifies the
		 * FILE, so two components cannot produce the same id. */
		expect(lowered.code).toMatch(/id="absolute-svelte-await-[a-z\d]+-0"/u);
		expect(lowered.code).toContain(
			'fallbackHtml={`<p${__absoluteAwaitHtml.scope()}>Loading...</p>`}'
		);
		expect(lowered.code).toContain(
			'return `<article${__absoluteAwaitHtml.class((value.kind))}>${__absoluteAwaitHtml.text((value.title))}</article>`;'
		);
		// The branches' shadow, never rendered, so Svelte keeps their CSS.
		expect(lowered.code).toContain(
			`{#if __absoluteAwaitHtml.shadow}<svelte:element this={'div'} data-absolute-slot="true"><p></p></svelte:element><svelte:element this={'div'} data-absolute-slot="true"><article class={__absoluteAwaitHtml.shadow}></article></svelte:element>{/if}`
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
			'catch (error) { return `<p${__absoluteAwaitHtml.scope()}>${__absoluteAwaitHtml.text((error.message))}</p>`; }'
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
		expect(lowered.code).toMatch(
			/<AbsoluteAwaitSlot id="absolute-svelte-await-[a-z\d]+-0" dynamic fallbackHtml/u
		);
		expect(lowered.code).toMatch(
			/<AbsoluteAwaitSlot id="absolute-svelte-await-[a-z\d]+-1" fallbackHtml/u
		);
		expect(lowered.code).not.toContain('absolute:stream');
	});
});

describe('slot ids across components', () => {
	const streamed = `<!-- absolute:stream -->
{#await load()}
	<p>loading</p>
{:then value}
	<p>{value}</p>
{/await}
`;
	const idsIn = (code: string) =>
		[...code.matchAll(/absolute-svelte-await-[a-z\d-]+/gu)].map(
			(match) => match[0]
		);

	/* The index restarts at zero in every file, so before this two
	 * components that each streamed one `{#await}` both produced
	 * `absolute-svelte-await-0` — measured by lowering two files and
	 * reading the ids back. A slot id is how a streamed chunk finds its
	 * placeholder, so on a page rendering both, the second chunk's
	 * content could land in the first component's hole. */
	test('two components do not share an id', () => {
		const first = lowerSvelteAwaitSlotSyntax(streamed, '/app/Alpha.svelte');
		const second = lowerSvelteAwaitSlotSyntax(streamed, '/app/Beta.svelte');

		expect(idsIn(first.code)[0]).not.toBe(idsIn(second.code)[0]);
	});

	/* Deterministic, because the server writes the id into markup and the
	 * client matches it: a random id would differ between the two and
	 * match nothing. */
	test('the same file lowers to the same id twice', () => {
		expect(
			idsIn(
				lowerSvelteAwaitSlotSyntax(streamed, '/app/Alpha.svelte').code
			)
		).toEqual(
			idsIn(
				lowerSvelteAwaitSlotSyntax(streamed, '/app/Alpha.svelte').code
			)
		);
	});

	/* The id has to survive a build from a different checkout and from
	 * Windows, where the same component arrives with backslashes. */
	test('a windows path gives the same id as a posix one', () => {
		expect(
			idsIn(
				lowerSvelteAwaitSlotSyntax(streamed, 'app/pages/Alpha.svelte')
					.code
			)
		).toEqual(
			idsIn(
				lowerSvelteAwaitSlotSyntax(streamed, 'app\\pages\\Alpha.svelte')
					.code
			)
		);
	});

	test('blocks within one file still differ', () => {
		const lowered = lowerSvelteAwaitSlotSyntax(
			`${streamed}${streamed}`,
			'/app/Alpha.svelte'
		);
		const [first, second] = idsIn(lowered.code);

		expect(first).not.toBe(second);
	});

	/* A component lowered without a path still needs an id, and still
	 * must not collide with a file that has one. */
	test('a component with no path gets a stable id of its own', () => {
		const [anonymous] = idsIn(lowerSvelteAwaitSlotSyntax(streamed).code);

		expect(anonymous).toBe('absolute-svelte-await-anon-0');
		expect(anonymous).not.toBe(
			idsIn(
				lowerSvelteAwaitSlotSyntax(streamed, '/app/Alpha.svelte').code
			)[0]
		);
	});
});
