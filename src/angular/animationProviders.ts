import type { EnvironmentProviders, Provider } from '@angular/core';
import { resolveAngularRuntimePath } from './resolveAngularPackage';

let noopAnimationProvidersPromise: Promise<
	(Provider | EnvironmentProviders)[]
> | null = null;

const loadNoopAnimationProviders = async () => {
	const animations = await import(
		resolveAngularRuntimePath('@angular/platform-browser/animations')
	);

	return animations.provideNoopAnimations();
};

export const buildServerAnimationProviders = (
	usesLegacyAnimations: boolean
) => {
	if (!usesLegacyAnimations) return Promise.resolve([]);

	noopAnimationProvidersPromise ??= loadNoopAnimationProviders();

	return noopAnimationProvidersPromise;
};
