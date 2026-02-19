import type { ComponentType as ReactComponent } from 'react';

export type ReactPropsOf<C> =
	C extends ReactComponent<infer P> ? P : Record<string, never>;
