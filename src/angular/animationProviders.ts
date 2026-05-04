import type { EnvironmentProviders, Provider } from '@angular/core';
import { resolveAngularRuntimePath } from './resolveAngularPackage';
import { isProductionRuntime } from '../utils/runtimeMode';

let noopAnimationProvidersPromise: Promise<
	(Provider | EnvironmentProviders)[]
> | null = null;

const loadNoopAnimationProviders = async () => {
	// §1.1 — bare specifier in dev. resolveAngularRuntimePath stays in
	// production because that's where the linked vendor lives.
	const spec = isProductionRuntime()
		? resolveAngularRuntimePath('@angular/platform-browser/animations')
		: '@angular/platform-browser/animations';
	const animations = await import(spec);

	return animations.provideNoopAnimations();
};

export const buildServerAnimationProviders = (
	usesLegacyAnimations: boolean
) => {
	if (!usesLegacyAnimations) return Promise.resolve([]);

	noopAnimationProvidersPromise ??= loadNoopAnimationProviders();

	return noopAnimationProvidersPromise;
};
