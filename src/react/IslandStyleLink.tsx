import type { ComponentProps } from 'react';
import type { RuntimeIslandRenderProps } from '../../types/island';
import {
	findIslandStylesheet,
	ISLAND_STYLE_PRECEDENCE,
	readIslandStyleNonce
} from '../core/islandStylesheet';

type IslandStyleLinkProps = Pick<
	RuntimeIslandRenderProps,
	'component' | 'framework'
>;

/* An island's stylesheet, rendered next to the island. As a React 19
 * stylesheet resource (`precedence`), React hoists it into the head (in the
 * shell, or ahead of the Suspense boundary that holds the island) and
 * renders each href once, however many islands share it. A resource takes
 * no place in the hydrated tree, and the browser render adopts the
 * server's link by its href (it reads the manifest the server injected),
 * so hydration sees the same thing on both sides. */
export const IslandStyleLink = ({
	component,
	framework
}: IslandStyleLinkProps) => {
	const stylesheet = findIslandStylesheet(framework, component);
	if (!stylesheet) return null;
	const nonce = readIslandStyleNonce();

	return (
		<link
			data-island-style={stylesheet.key}
			href={stylesheet.href}
			nonce={nonce || undefined}
			precedence={ISLAND_STYLE_PRECEDENCE}
			rel="stylesheet"
		/>
	);
};

type IslandWithStylesheetProps = IslandStyleLinkProps & {
	/** Props of the island's marker element. */
	marker: ComponentProps<'div'>;
};

/** An island's marker element, preceded by its stylesheet. */
export const IslandWithStylesheet = ({
	component,
	framework,
	marker
}: IslandWithStylesheetProps) => (
	<>
		<IslandStyleLink component={component} framework={framework} />
		<div {...marker} />
	</>
);
