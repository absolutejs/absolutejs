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

	let {
		component,
		framework,
		hydrate = 'load',
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
		const attributes = [
			['data-component', runtimeProps.component],
			['data-framework', runtimeProps.framework],
			['data-hydrate', runtimeProps.hydrate ?? 'load'],
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
