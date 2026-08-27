import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { MobileConfig } from '../../types/build';
import { resolveAbsoluteDeviceCapabilityPlan } from './deviceCapabilities';

export const absoluteNativeDevAdapterSource = (
	projectRoot: string,
	mobile: MobileConfig,
	resolveModule: (specifier: string) => string = (specifier) => specifier
) => {
	const plan = resolveAbsoluteDeviceCapabilityPlan(projectRoot);
	const imports = plan.capabilities.map((name, index) => {
		const provider = plan.providers[name];
		if (!provider)
			throw new TypeError(`Missing device capability provider ${name}.`);

		return `import { ${provider.factory} as absoluteDeviceCapability${index} } from ${JSON.stringify(resolveModule(provider.module))};`;
	});
	const capabilities = plan.capabilities
		.map(
			(name, index) =>
				`${JSON.stringify(name)}: absoluteDeviceCapability${index}()`
		)
		.join(', ');

	return [
		`import { installCapacitorDeviceAdapterIfNative } from ${JSON.stringify(resolveModule('@absolutejs/devices-capacitor'))};`,
		...imports,
		`installCapacitorDeviceAdapterIfNative({ storagePrefix: ${JSON.stringify(`absolutejs.${mobile.appId}.`)}${capabilities ? `, ${capabilities}` : ''} });`
	].join('\n');
};

export const buildAbsoluteNativeDevAdapter = async (
	projectRoot: string,
	mobile: MobileConfig
) => {
	const temporaryDirectory = await mkdtemp(
		join(tmpdir(), 'absolutejs-native-dev-adapter-')
	);
	const entry = join(temporaryDirectory, 'entry.ts');
	try {
		await writeFile(
			entry,
			absoluteNativeDevAdapterSource(projectRoot, mobile, (specifier) =>
				Bun.resolveSync(specifier, projectRoot)
			)
		);
		const result = await Bun.build({
			entrypoints: [entry],
			format: 'esm',
			minify: true,
			target: 'browser'
		});
		if (!result.success || result.outputs.length !== 1) {
			throw new AggregateError(
				result.logs,
				'Failed to build the AbsoluteJS native development device adapter.'
			);
		}

		return result.outputs[0]?.text() ?? '';
	} finally {
		await rm(temporaryDirectory, { force: true, recursive: true });
	}
};
