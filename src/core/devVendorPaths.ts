/** Module-level dev vendor paths state.
 *  Set by devBuild() before the initial build so that build() can
 *  externalize React and rewrite imports to stable vendor files.
 *  Production builds never call setDevVendorPaths, so the getter
 *  returns null and build() bundles React normally. */

let devVendorPaths: Record<string, string> | null = null;

export const getDevVendorPaths = () => devVendorPaths;
export const setDevVendorPaths = (paths: Record<string, string>) => {
	devVendorPaths = paths;
};

/** Angular vendor paths — same pattern as React. */
let angularVendorPaths: Record<string, string> | null = null;

export const getAngularVendorPaths = () => angularVendorPaths;
export const setAngularVendorPaths = (paths: Record<string, string>) => {
	angularVendorPaths = paths;
};

/** Svelte vendor paths — same pattern as React. */
let svelteVendorPaths: Record<string, string> | null = null;

export const getSvelteVendorPaths = () => svelteVendorPaths;
export const setSvelteVendorPaths = (paths: Record<string, string>) => {
	svelteVendorPaths = paths;
};

/** Vue vendor paths — same pattern as React. */
let vueVendorPaths: Record<string, string> | null = null;

export const getVueVendorPaths = () => vueVendorPaths;
export const setVueVendorPaths = (paths: Record<string, string>) => {
	vueVendorPaths = paths;
};
