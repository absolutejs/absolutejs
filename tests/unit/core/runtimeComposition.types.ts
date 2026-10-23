import { Elysia } from 'elysia';
import type { PrepareResult } from '../../../src/core/prepare';

// Previously each mount doubled the development/production alternatives.
// Keep enough mounts to cross TypeScript's former 131,072-combination failure.
export const composeRuntime = (runtime: PrepareResult) =>
	new Elysia()
		.use(runtime.absolutejs)
		.use(
			new Elysia().get('/runtime-contract/0', () => ({ value: 'ready' }))
		)
		.use(
			new Elysia().get('/runtime-contract/1', () => ({ value: 'ready' }))
		)
		.use(
			new Elysia().get('/runtime-contract/2', () => ({ value: 'ready' }))
		)
		.use(
			new Elysia().get('/runtime-contract/3', () => ({ value: 'ready' }))
		)
		.use(
			new Elysia().get('/runtime-contract/4', () => ({ value: 'ready' }))
		)
		.use(
			new Elysia().get('/runtime-contract/5', () => ({ value: 'ready' }))
		)
		.use(
			new Elysia().get('/runtime-contract/6', () => ({ value: 'ready' }))
		)
		.use(
			new Elysia().get('/runtime-contract/7', () => ({ value: 'ready' }))
		)
		.use(
			new Elysia().get('/runtime-contract/8', () => ({ value: 'ready' }))
		)
		.use(
			new Elysia().get('/runtime-contract/9', () => ({ value: 'ready' }))
		)
		.use(
			new Elysia().get('/runtime-contract/10', () => ({ value: 'ready' }))
		)
		.use(
			new Elysia().get('/runtime-contract/11', () => ({ value: 'ready' }))
		)
		.use(
			new Elysia().get('/runtime-contract/12', () => ({ value: 'ready' }))
		)
		.use(
			new Elysia().get('/runtime-contract/13', () => ({ value: 'ready' }))
		)
		.use(
			new Elysia().get('/runtime-contract/14', () => ({ value: 'ready' }))
		)
		.use(
			new Elysia().get('/runtime-contract/15', () => ({ value: 'ready' }))
		)
		.use(
			new Elysia().get('/runtime-contract/16', () => ({ value: 'ready' }))
		)
		.use(
			new Elysia().get('/runtime-contract/17', () => ({ value: 'ready' }))
		)
		.use(
			new Elysia().get('/runtime-contract/18', () => ({ value: 'ready' }))
		)
		.use(
			new Elysia().get('/runtime-contract/19', () => ({ value: 'ready' }))
		)
		.use(
			new Elysia().get('/runtime-contract/20', () => ({ value: 'ready' }))
		)
		.use(
			new Elysia().get('/runtime-contract/21', () => ({ value: 'ready' }))
		)
		.use(
			new Elysia().get('/runtime-contract/22', () => ({ value: 'ready' }))
		)
		.use(
			new Elysia().get('/runtime-contract/23', () => ({ value: 'ready' }))
		);

type ResponseBody = ReturnType<
	typeof composeRuntime
>['~Routes']['runtime-contract']['23']['get']['response'][200];
type Assert<T extends true> = T;
export type PreservesApplicationResponse = Assert<
	ResponseBody extends { value: string } ? true : false
>;
export type DoesNotWidenApplicationResponse = Assert<
	0 extends 1 & ResponseBody ? false : true
>;
