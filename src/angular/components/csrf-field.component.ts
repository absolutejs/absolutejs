import { ChangeDetectionStrategy, Component } from '@angular/core';
import { CSRF_FIELD_NAME, readCsrfToken } from '../../utils/csrfTokenRef';

/** The hidden field a `csrf: { token: true }` form route expects:
 *
 *    <form [absoluteAction]="signup">
 *    	<absolute-csrf-field />
 *    	…
 *
 *  Read once in the constructor, not as a signal: the token belongs to
 *  the request that rendered the page, and the server markup and the
 *  hydrated DOM have to agree on it. Renders nothing when there is no
 *  token — a route that did not opt in, or a page pre-rendered at build
 *  time, whose submissions carry the token in a header instead. */
@Component({
	changeDetection: ChangeDetectionStrategy.OnPush,
	selector: 'absolute-csrf-field',
	standalone: true,
	template: `
		@if (token) {
			<input type="hidden" [name]="fieldName" [value]="token" />
		}
	`
})
export class CsrfFieldComponent {
	readonly fieldName = CSRF_FIELD_NAME;

	readonly token = readCsrfToken();
}
