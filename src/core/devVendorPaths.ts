/** Module-level dev vendor paths state.
 *  Set by devBuild() before the initial build so that build() can
 *  externalize React and rewrite imports to stable vendor files.
 *  Production builds never call setDevVendorPaths, so the getter
 *  returns null and build() bundles React normally. */

let devVendorPaths: Record<string, string> | null = null;

export const setDevVendorPaths = (paths: Record<string, string>): void => {
	devVendorPaths = paths;
};

export const getDevVendorPaths = (): Record<string, string> | null =>
	devVendorPaths;
