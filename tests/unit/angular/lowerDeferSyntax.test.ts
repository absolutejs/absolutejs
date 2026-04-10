import { describe, expect, test } from 'bun:test';
import { lowerAngularDeferSyntax } from '../../../src/angular/lowerDeferSyntax';

describe('lowerAngularDeferSyntax', () => {
	test('rewrites @defer blocks to abs-defer-slot placeholders', () => {
		const template = `
<section>
  @defer (on timer(120ms)) {
    <article>done</article>
  } @placeholder {
    <p>loading</p>
  } @error {
    <p>error</p>
  }
</section>
`;
		const lowered = lowerAngularDeferSyntax(template);

		expect(lowered.transformed).toBe(true);
		expect(lowered.slots.length).toBe(1);
		expect(lowered.template).toContain('<abs-defer-slot');
		expect(lowered.template).toContain(
			'[resolve]="__absoluteDeferResolvePayload0"'
		);
		expect(lowered.template).toContain('<ng-template absDeferFallback>');
		expect(lowered.template).toContain('<ng-template absDeferError>');
		expect(lowered.template).toContain(
			'<ng-template absDeferResolved let-slotData><article>done</article></ng-template>'
		);
		expect(lowered.slots[0]?.delayMs).toBe(120);
	});

	test('returns unchanged template when no defer block is present', () => {
		const template = '<main><p>plain</p></main>';
		const lowered = lowerAngularDeferSyntax(template);

		expect(lowered.transformed).toBe(false);
		expect(lowered.template).toBe(template);
		expect(lowered.slots.length).toBe(0);
	});

	test('handles interpolation braces inside deferred markup', () => {
		const template = `
<section>
  @defer (on timer(120ms)) {
    <article>resolved {{ timestamp() }}</article>
  } @placeholder {
    <p>loading…</p>
  }
</section>
`;
		const lowered = lowerAngularDeferSyntax(template);

		expect(lowered.transformed).toBe(true);
		expect(lowered.template).not.toContain('}</p>');
		expect(lowered.template).toContain('<abs-defer-slot');
		expect(lowered.slots[0]?.resolvedHtml).toBe(
			'<article>resolved {{ timestamp() }}</article>'
		);
		expect(lowered.slots[0]?.resolvedTemplate).toBe(
			'<article>resolved {{ slotData["e0"] }}</article>'
		);
		expect(lowered.slots[0]?.resolvedBindings).toEqual([
			{
				expression: 'timestamp()',
				key: 'e0'
			}
		]);
	});

	test('escapes literal @defer text outside of defer blocks', () => {
		const template = '<p>Use <code>@defer</code> for deferred loading.</p>';
		const lowered = lowerAngularDeferSyntax(template);

		expect(lowered.template).toContain('&#64;defer');
		expect(lowered.transformed).toBe(false);
		expect(lowered.slots.length).toBe(0);
	});

	test('escapes multiple literal @defer occurrences without duplication', () => {
		const template =
			'<p>@defer is not a block here.</p> <p>Say <code>@defer</code>.</p>';
		const lowered = lowerAngularDeferSyntax(template);

		expect(lowered.transformed).toBe(false);
		expect(lowered.slots.length).toBe(0);
		expect(lowered.template).toBe(
			'<p>&#64;defer is not a block here.</p> <p>Say <code>&#64;defer</code>.</p>'
		);
	});
});
