<script context="module" lang="ts">
	let islandSlotIndex = 0;

	const createSlotId = () => {
		const current = islandSlotIndex;
		islandSlotIndex += 1;

		return `absolute-svelte-island-${current.toString(36)}`;
	};
</script>

<script lang="ts">
	import type { RuntimeIslandRenderProps } from '../../../types/island';
	// Relative, and copied into dist/ by the build: this component ships
	// as source and compiles in the user's project, so it cannot import
	// core/islandMarkupAttributes.ts — and writing the media split twice is
	// how a Svelte island would quietly hydrate where a React one waits.
	import {
		hydrateMediaOf,
		hydrateModeOf
	} from '../../core/islandHydrateMode';

	let {
		component,
		framework,
		hydrate = 'load',
		persist,
		props
	}: RuntimeIslandRenderProps = $props();

	const slotId = createSlotId();

	const escapeHtmlAttribute = (value: string) =>
		value
			.replaceAll('&', '&amp;')
			.replaceAll('"', '&quot;')
			.replaceAll('<', '&lt;')
			.replaceAll('>', '&gt;');

	const buildFallbackMarkup = (runtimeProps: RuntimeIslandRenderProps) => {
		const attributes: [string, string][] = [
			...(runtimeProps.persist === undefined
				? []
				: ([['data-absolute-persist', runtimeProps.persist]] as [
						string,
						string
					][])),
			['data-component', runtimeProps.component],
			['data-framework', runtimeProps.framework],
			['data-hydrate', hydrateModeOf(runtimeProps.hydrate)],
			...(hydrateMediaOf(runtimeProps.hydrate) === undefined
				? []
				: ([
						[
							'data-hydrate-media',
							hydrateMediaOf(runtimeProps.hydrate) ?? ''
						]
					] as [string, string][])),
			['data-island', 'true'],
			['data-props', JSON.stringify(runtimeProps.props ?? {})]
		];

		const serialized = attributes
			.map(([name, value]) => `${name}="${escapeHtmlAttribute(value)}"`)
			.join(' ');

		return `<div ${serialized}></div>`;
	};

	const html = $derived(
		(() => {
			const runtimeProps = {
				component,
				framework,
				hydrate,
				props
			};

			if (typeof document === 'undefined') {
				return buildFallbackMarkup(runtimeProps);
			}

			const slot = document.querySelector<HTMLElement>(
				`[data-absolute-island-slot="${slotId}"]`
			);

			return slot?.innerHTML ?? buildFallbackMarkup(runtimeProps);
		})()
	);
</script>

<div data-absolute-island-slot={slotId} style="display: contents">
	{@html html}
</div>
