/**
 * Props supplied automatically to an application-owned Expo native route.
 * Import the existing AbsoluteJS page-props type as `PageProps` so server and
 * native rendering stay on the same compile-time contract.
 */
export type AbsoluteNativeRouteProps<
	PageProps extends object,
	Params extends object = Record<string, string | string[] | undefined>
> = {
	/** Live props produced by the ordinary server route for the current URL. */
	pageProps: Readonly<PageProps>;
	/** Expo Router path and query parameters for the current native route. */
	params: Readonly<Params>;
	/** Re-run the trusted server route without remounting the native screen. */
	reload: () => void;
};
