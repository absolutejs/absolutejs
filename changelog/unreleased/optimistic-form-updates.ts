import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "The four form bindings take an `optimistic` mapper: `optimistic: (body) => Data` is called once per submission, before the request starts, and what it returns becomes `data` until the real result replaces it, so a form can show what was just submitted without waiting for the server. A failure clears it, so the form shows its errors rather than a success that never happened, and `pending` is what says the value is provisional — treat `data` as confirmed only when `pending` is false. A mapper that throws is reported to the console and the submission continues without a provisional value: it cannot fail the submission, because it only decorates the wait, and it cannot be silent, because each binding's submit handler swallows rejections to ignore aborted submissions. Available on React's useFormAction, Svelte's formAction, Vue's useFormAction and Angular's useFormAction, with the behaviour shared so the bindings cannot drift.",
	kind: 'added',
	summary: 'Optimistic data while a form submission is in flight',
	symbols: [
		'formAction',
		'FormActionBindingOptions',
		'useFormAction',
		'UseFormActionOptions'
	]
};
