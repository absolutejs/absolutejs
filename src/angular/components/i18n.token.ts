import { InjectionToken } from '@angular/core';

/* The token the `t` pipe injects, and the only thing it knows about i18n.
 *
 * Declared here, beside the pipe, and deliberately self-contained: every
 * file in this directory is copied into a temp workspace for Angular's
 * partial compilation, where an import that leaves the directory cannot
 * resolve. `src/angular/i18n.ts` provides the token and owns the real
 * translator, which is where `types/i18n.ts` and the message formatter
 * live. */

/** What a component or pipe needs from the current locale. A superset
 *  arrives in practice — this is the part the pipe depends on. */
export type AngularI18n = {
	dir: 'ltr' | 'rtl';
	locale: string;
	t(key: string, params?: Record<string, unknown>): string;
};

export const ABSOLUTE_I18N = new InjectionToken<AngularI18n>('absolutejs.i18n');
