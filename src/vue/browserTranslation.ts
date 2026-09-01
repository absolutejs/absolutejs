import type { HydrationStrategy } from 'vue';
import { prepareBrowserTranslationHydration } from '../client/browserTranslation';

export {
	captureSsrTextBaselines,
	prepareBrowserTranslationHydration
} from '../client/browserTranslation';

/** Wrap a Vue lazy-hydration strategy so text changed by browser translation
 * after the SSR snapshot neither triggers a mismatch nor gets reset. */
export const preserveBrowserTranslation = (strategy: HydrationStrategy) => {
	const translatedStrategy: HydrationStrategy = (hydrate, forEachElement) =>
		strategy(() => {
			const restore: Array<() => void> = [];
			forEachElement((element) => {
				restore.push(prepareBrowserTranslationHydration(element));
			});
			try {
				hydrate();
			} finally {
				for (const apply of restore) apply();
			}
		}, forEachElement);

	return translatedStrategy;
};
