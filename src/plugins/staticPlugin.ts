import { staticPlugin as elysiaStaticPlugin } from '@elysiajs/static';

/**
 * A wrapper around @elysiajs/static that sanitizes paths.
 * The upstream plugin has a bug where leading './' in paths results in failed matching
 * for nested directory files (e.g. ./example/build vs example/build).
 */
export const staticPlugin = (
    options?: Parameters<typeof elysiaStaticPlugin>[0]
) => {
    const safeOptions = { ...options };

    if (safeOptions.assets?.startsWith('./')) {
        safeOptions.assets = safeOptions.assets.slice(2);
    }

    return elysiaStaticPlugin(safeOptions);
};
