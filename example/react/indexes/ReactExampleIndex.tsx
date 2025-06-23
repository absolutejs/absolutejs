import { hydrateRoot } from 'react-dom/client';
import type { ComponentType } from 'react'
import { ReactExample } from '../pages/ReactExample';

type PropsOf<C> = C extends ComponentType<infer P> ? P : never;

declare global {
	interface Window {
		__INITIAL_PROPS__: PropsOf<typeof ReactExample>
	}
}

hydrateRoot(document, <ReactExample {...window.__INITIAL_PROPS__} />);