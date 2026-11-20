import {
	DestroyRef,
	Directive,
	ElementRef,
	type OnInit,
	inject,
	input
} from '@angular/core';

/** What this directive needs of a `useFormAction`, declared here rather
 *  than imported from `../composables`. The published Angular partial
 *  compile copies THIS directory alone into a flat workspace
 *  (`compileAngularComponentsPartial` in scripts/build.ts), so an import
 *  that climbs out of it cannot resolve there — and when it cannot, the
 *  step emits nothing at all. A `FormAction` satisfies this structurally. */
export type FormActionTarget = {
	abort: () => void;
	path: string;
	resetOnSuccess: boolean;
	submit: (
		body: FormData
	) => Promise<{ redirect?: string; status: 'error' | 'success' }>;
};

type SubmitResult = Awaited<ReturnType<FormActionTarget['submit']>>;

/* The button that submitted the form, so its own name and value reach the
 * server and a form with two buttons can say which was pressed. Only when
 * the form actually owns it: a detached control and `requestSubmit()` can
 * both leave `submitter` pointing elsewhere, and `FormData` throws on a
 * submitter the form does not own. */
const submitterOf = (event: SubmitEvent, form: HTMLFormElement) => {
	const { submitter } = event;
	if (!(submitter instanceof HTMLElement)) return null;
	const owner = Reflect.get(submitter, 'form');

	return owner === form ? submitter : null;
};

/**
 * Binds a `useFormAction` to the `<form>` it sits on:
 *
 *   <form [absoluteAction]="signup">
 *
 * It writes the real `action`, `method="post"` and `enctype` attributes,
 * so the form posts without JavaScript and before hydration, and it
 * intercepts the submission once the directive is alive. The in-flight
 * request is aborted when the form is destroyed.
 */
@Directive({
	selector: 'form[absoluteAction]',
	standalone: true
})
export class AbsoluteActionDirective implements OnInit {
	readonly absoluteAction = input.required<FormActionTarget>();

	private readonly form =
		inject<ElementRef<HTMLFormElement>>(ElementRef).nativeElement;

	private readonly destroyRef = inject(DestroyRef);

	// ngOnInit, not the constructor: a required input has no value yet at
	// construction. It runs during server rendering too, so the attributes
	// below reach the HTML a visitor without JavaScript receives.
	ngOnInit() {
		const action = this.absoluteAction();
		// Written here rather than left to the template so a page cannot
		// forget them: without a real action and method the form does
		// nothing at all when JavaScript has not run.
		this.form.setAttribute('action', action.path);
		this.form.setAttribute('method', 'post');
		this.form.setAttribute('enctype', 'multipart/form-data');
		this.form.addEventListener('submit', this.listener);
		this.destroyRef.onDestroy(() => {
			action.abort();
			this.form.removeEventListener('submit', this.listener);
		});
	}

	private readonly clearOnSuccess = (result: SubmitResult) => {
		const action = this.absoluteAction();
		if (
			result.status !== 'success' ||
			result.redirect ||
			!action.resetOnSuccess
		) {
			return;
		}
		this.form.reset();
	};

	private readonly listener = (event: SubmitEvent) => {
		event.preventDefault();
		const body = new FormData(this.form, submitterOf(event, this.form));
		this.absoluteAction()
			.submit(body)
			.then(this.clearOnSuccess)
			// An aborted submission is not an error: a newer one replaced it.
			.catch(() => undefined);
	};
}
