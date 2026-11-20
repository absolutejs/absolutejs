import { inject, Pipe } from '@angular/core';
import { ABSOLUTE_I18N } from './i18n.token';

/** Translates a message key in a template:
 *
 *    <h1>{{ 'home.title' | t: { name: user.name } }}</h1>
 *
 *  Pure, so Angular calls it again only when the key or the parameters
 *  change — the translator itself is fixed for the request. */
@Pipe({ name: 't', pure: true, standalone: true })
export class TPipe {
	private readonly i18n = inject(ABSOLUTE_I18N);

	transform(key: string, params?: Record<string, unknown>) {
		return this.i18n.t(key, params);
	}
}
