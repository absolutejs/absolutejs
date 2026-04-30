import type { Type } from '@angular/core';
import type { AngularPageDefinition } from '../../types/angular';

export const defineAngularPage = <
	Props extends Record<string, unknown> = Record<never, never>
>(definition: {
	component: Type<unknown>;
}) => definition as AngularPageDefinition<Props>;
