import { Elysia } from '__ELYSIA_ENTRY__';
import { asset, networking, prepare } from '__ABSOLUTE_DIST_INDEX__';
import { handleAngularPageRequest } from '__ABSOLUTE_DIST_ANGULAR__';
import { createStore } from 'zustand/vanilla';
import { packageImportValue } from '#runtime/package-import';
import cjsProbe from './runtime/cjs-probe.cjs';

const resolvedCjsProbe = cjsProbe as {
	readCjsProbe: () => string;
};
const store = createStore<{ count: number }>(() => ({ count: 7 }));
const { absolutejs, manifest } = await prepare();
const pageAssets = (key: string) => ({
	indexPath: asset(manifest, `${key}Index`),
	pagePath: asset(manifest, key)
});

export const server = new Elysia()
	.use(absolutejs)
	.get('/', ({ request }) =>
		handleAngularPageRequest({
			headTag:
				'<head><title>Dependency Stress</title><link rel="stylesheet" href="/dependency.css"></head>',
			request,
			...pageAssets('Home')
		})
	)
	.get('/boom', ({ request }) =>
		handleAngularPageRequest({
			headTag: '<head><title>Dependency Stress Boom</title></head>',
			request,
			...pageAssets('Boom')
		})
	)
	.get('/api/deps', async () => {
		const dynamicModule = await import('#runtime/dynamic');
		const vanillaModule = await import('zustand/vanilla');
		const dynamicStore = vanillaModule.createStore<{ ready: boolean }>(
			() => ({ ready: true })
		);

		return {
			cjs: resolvedCjsProbe.readCjsProbe(),
			dynamic: dynamicModule.dynamicValue,
			env: process.env.COMPILE_DEP_STRESS_SECRET ?? null,
			packageImport: packageImportValue,
			storeCount: store.getState().count,
			zustandDynamic: dynamicStore.getState().ready
		};
	})
	.use(networking);
