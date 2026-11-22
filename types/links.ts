/** The dead-link check's settings (build/auditLinks.ts). */
export type LinksConfig = {
	/** Paths the check should not ask about.
	 *
	 *  It compares a link against the routes the project's own source
	 *  declares — its file routes and its Elysia registrations — so a
	 *  route an installed PLUGIN mounts is invisible to it:
	 *  `@absolutejs/auth` registers its own, and `/auth/sign-in` would
	 *  look dead. A trailing `*` matches by prefix (`'/auth/*'`).
	 *
	 *  A path with a file extension is already skipped, since the asset
	 *  plugin serves those rather than a route. */
	ignore?: string[];
};
