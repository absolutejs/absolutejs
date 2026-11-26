/** What `prepare()` registers so `revalidatePath` can reach the server
 *  that serves the pre-rendered files. */
export type Revalidator = {
	/** Re-render one pre-rendered route; `false` when it failed. */
	revalidate: (route: string) => Promise<boolean>;
	/** The routes that are pre-rendered. */
	routes: () => string[];
};

export type RevalidateAllResult = {
	/** Routes whose render failed; they keep their previous page. */
	failed: string[];
	/** Routes whose page was replaced. */
	revalidated: string[];
};
