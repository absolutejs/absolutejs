import type { EnvironmentProviders, Provider } from '@angular/core';
import { resolveAngularPackage } from './resolveAngularPackage';

let noopAnimationProvidersPromise: Promise<
	(Provider | EnvironmentProviders)[]
> | null = null;

const loadNoopAnimationProviders = async () => {
	const animations = await import(
		resolveAngularPackage('@angular/platform-browser/animations')
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
