import { Elysia } from '__ELYSIA_ENTRY__';
import { networking } from '__ABSOLUTE_DIST_INDEX__';
import { packageStyleMarker, readPackageAsset } from 'compile-asset-package';
import { subpathValue } from 'compile-asset-package/subpath';

export const server = new Elysia()
	.get(
		'/',
		() =>
			new Response(
				`<!DOCTYPE html>
<html>
	<head>
		<title>Dependency Assets</title>
		<link rel="stylesheet" href="/dependency-assets.css" />
	</head>
	<body>
		<h1>DEPENDENCY_ASSETS_HOME</h1>
	</body>
</html>`,
				{ headers: { 'content-type': 'text/html; charset=utf-8' } }
			)
	)
	.get('/api/dependency-assets', async () => {
		const packageDynamicModule = await import(
			'compile-asset-package/dynamic'
		);

		return {
			asset: (await readPackageAsset()).trim(),
			dynamic: packageDynamicModule.dynamicPackageValue,
			style: packageStyleMarker,
			subpath: subpathValue
		};
	})
	.use(networking);
