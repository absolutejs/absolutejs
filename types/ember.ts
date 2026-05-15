/**
 * Type surface for the AbsoluteJS Ember adapter.
 *
 * Mirrors `types/angular.ts` in shape because both frameworks compile
 * components separately from props and surface them through a "page
 * definition" object rather than a callable component.
 *
 * Glimmer carries component args through the `Args` type parameter on
 * `Component<{ Args: ... }>`. We extract from there.
 */

/**
 * Structural shape of a Glimmer component class. We avoid importing
 * `@glimmer/component` here because the AbsoluteJS package shouldn't
 * pull Glimmer types into every consumer's type-check just to describe
 * page modules. Users get the real type via Glint or by importing
 * `@glimmer/component` directly in their own code.
 */
export type EmberComponentLike<Args = unknown> = abstract new (
	owner: unknown,
	args: Args
) => object;

/**
 * Page definition expected from `*.gjs` / `*.gts` page modules. The
 * default export is the Glimmer component; the page handler infers
 * `Args` from its declared signature.
 */
export type EmberPageDefinition<
	Args extends Record<string, unknown> = Record<never, never>
> = {
	component: EmberComponentLike<Args>;
	__absoluteEmberPageProps?: Args;
};

/**
 * Pull the props type out of a page module's default export.
 */
export type EmberPagePropsOf<Page> = Page extends {
	default: EmberComponentLike<infer Args>;
}
	? Args extends Record<string, unknown>
		? Args
		: Record<never, never>
	: Page extends EmberComponentLike<infer Args>
		? Args extends Record<string, unknown>
			? Args
			: Record<never, never>
		: Record<never, never>;

/**
 * `true` if `Props` has no required keys — the page handler uses this
 * to decide whether `props` is required or optional in
 * `EmberPageRequestInput`.
 */
export type EmberPageHasOptionalProps<Props> = [Props] extends [never]
	? true
	: keyof Props extends never
		? true
		: false;
