declare module '*.svelte' {
	import type { Component } from 'svelte';

	const SvelteComponent: Component<Record<string, unknown>>;
	export default SvelteComponent;
}
