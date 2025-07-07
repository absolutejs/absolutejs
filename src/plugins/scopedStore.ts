import { Elysia } from 'elysia';
import type { Prettify } from '../types';

type ScopedStateConfig<T> = { value: T; preserve?: boolean };

type ValueOnly<Setup extends Record<string, ScopedStateConfig<unknown>>> = {
	[K in keyof Setup]: Setup[K]['value'];
};

type ScopedRecord<Data extends Record<string, unknown>> = Record<string, Data>;

export const scopedState = <
	Setup extends Record<string, ScopedStateConfig<unknown>>
>(
	setup: Setup
) => {
	const initialState = Object.fromEntries(
		Object.entries(setup).map(([key, entry]) => [key, entry.value])
	);

	const initialRecord: ScopedRecord<Prettify<ValueOnly<Setup>>> = {};

	return new Elysia({ name: 'scopedState' })
		.state({ scoped: initialRecord })
		.derive(
			({ store: { scoped }, cookie: { user_session_id }, status }) => {
				if (user_session_id === undefined) {
					return status('Bad Request', 'Cookies not set properly');
				}

				// The user session doesnt exist yet, so we create it
				if (user_session_id.value === undefined) {
					user_session_id.value = crypto.randomUUID();
					// @ts-expect-error - Object.entries loses type inference because of the `unknown` type
					scoped[user_session_id.value] = initialState;
				}

				// The server got reset but the user session cookie still exists, so we reset the scoped state
				if (scoped[user_session_id.value] === undefined) {
					// @ts-expect-error - Object.entries loses type inference because of the `unknown` type
					scoped[user_session_id.value] = initialState;
				}

				const scopedStore = scoped[user_session_id.value];

				if (scopedStore === undefined)
					return status(
						'Internal Server Error',
						'Scoped store not found'
					);

				return {
					scopedStore,
					resetScopedStore: () => {
						for (const key in setup) {
							const entry = setup[key];
							if (entry === undefined) {
								throw new Error(
									`Scoped setup is missing for key "${key}".`
								);
							}
							if (entry.preserve) continue;
							scopedStore[key] = entry.value;
						}
					}
				};
			}
		)
		.as('global');
};
