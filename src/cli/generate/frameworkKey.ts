export type FrameworkKey =
	| 'angular'
	| 'html'
	| 'htmx'
	| 'react'
	| 'svelte'
	| 'vue';

export const FRAMEWORK_KEYS: FrameworkKey[] = [
	'angular',
	'html',
	'htmx',
	'react',
	'svelte',
	'vue'
];

export const isFrameworkKey = (value: string): value is FrameworkKey =>
	FRAMEWORK_KEYS.some((key) => key === value);
