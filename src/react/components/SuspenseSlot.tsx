import type { ReactNode } from 'react';
import {
	isStreamingSlotCollectionActive,
	registerStreamingSlot,
	warnMissingStreamingSlotCollector
} from '../../core/streamingSlotRegistrar';
import {
	getReactServerNodeRenderer,
	type ReactServerNodeRenderer
} from '../serverComponents/nodeRendererRef';

type LegacySuspenseSlotProps = {
	className?: string;
	/** Stream this slot on every request even when the page is
	 *  pre-rendered (partial prerendering): the cached shell keeps the
	 *  fallback. Set it on anything that reads the request or must be fresh. */
	dynamic?: boolean;
	errorHtml?: string;
	fallbackHtml?: string;
	id: string;
	resolve: () => Promise<string> | string;
	timeoutMs?: number;
};

type FrameworkSuspenseRenderProps<T = unknown> = {
	children: (value: Awaited<T>) => ReactNode;
	className?: string;
	/** Stream this slot on every request even when the page is
	 *  pre-rendered (partial prerendering): the cached shell keeps the
	 *  fallback. Set it on anything that reads the request or must be fresh. */
	dynamic?: boolean;
	errorFallback?: ReactNode | ((error: unknown) => ReactNode);
	id: string;
	fallback?: ReactNode;
	timeoutMs?: number;
} & (
	| {
			promise: Promise<T>;
			resolve?: undefined;
	  }
	| {
			promise?: undefined;
			resolve: () => Promise<T> | T;
	  }
);

type FrameworkSuspenseNodeProps = {
	children?: ReactNode;
	className?: string;
	/** Stream this slot on every request even when the page is
	 *  pre-rendered (partial prerendering): the cached shell keeps the
	 *  fallback. Set it on anything that reads the request or must be fresh. */
	dynamic?: boolean;
	errorFallback?: ReactNode | ((error: unknown) => ReactNode);
	id: string;
	promise?: Promise<ReactNode>;
	resolve?: () => Promise<ReactNode> | ReactNode;
	fallback?: ReactNode;
	timeoutMs?: number;
};

type FrameworkSuspenseSlotProps<T = unknown> =
	FrameworkSuspenseRenderProps<T> | FrameworkSuspenseNodeProps;

type SuspenseSlotProps<T = unknown> =
	LegacySuspenseSlotProps | FrameworkSuspenseSlotProps<T>;

const isLegacyProps = <T,>(
	props: SuspenseSlotProps<T>
): props is LegacySuspenseSlotProps =>
	'fallbackHtml' in props || 'errorHtml' in props;

/* Rendered with renderToReadableStream, not renderToStaticMarkup:
 * `absolute start` stubs out React's legacy string renderer in the
 * production server bundle (it is ~4,000 lines nothing else uses), so
 * renderToStaticMarkup is undefined there and every SuspenseSlot patch
 * failed in production. */
const renderReactNodeToHtml = async (
	node: ReactNode,
	serverNodeRenderer: ReactServerNodeRenderer | undefined
) => {
	// Inside a React Server Component react-dom/server is unavailable; the
	// RSC page handler renders the node through Flight instead.
	if (serverNodeRenderer) return serverNodeRenderer(node);
	const { Fragment } = await import('react');
	const { renderToReadableStream } = await import('react-dom/server');
	const stream = await renderToReadableStream(<Fragment>{node}</Fragment>);
	await stream.allReady;

	return new Response(stream).text();
};

const hasRenderChildren = <T,>(
	props: FrameworkSuspenseSlotProps<T>
): props is FrameworkSuspenseRenderProps<T> =>
	typeof props.children === 'function';

async function resolveRenderSuspenseValue<T>(
	props: FrameworkSuspenseRenderProps<T>
): Promise<Awaited<T>>;
async function resolveRenderSuspenseValue<T>(
	props: FrameworkSuspenseRenderProps<T>
) {
	if ('resolve' in props && props.resolve !== undefined) {
		return props.resolve();
	}

	if ('promise' in props && props.promise !== undefined) {
		return props.promise;
	}

	return undefined;
}

async function resolveNodeSuspenseValue(
	props: FrameworkSuspenseNodeProps
): Promise<ReactNode | undefined>;
async function resolveNodeSuspenseValue(props: FrameworkSuspenseNodeProps) {
	if (props.resolve !== undefined) {
		return props.resolve();
	}

	if (props.promise !== undefined) {
		return props.promise;
	}

	return undefined;
}

const renderErrorFallback = async <T,>(
	props: FrameworkSuspenseSlotProps<T>,
	error: unknown,
	serverNodeRenderer: ReactServerNodeRenderer | undefined
) => {
	if (typeof props.errorFallback === 'function') {
		return renderReactNodeToHtml(
			props.errorFallback(error),
			serverNodeRenderer
		);
	}

	if (props.errorFallback !== undefined) {
		return renderReactNodeToHtml(props.errorFallback, serverNodeRenderer);
	}

	throw error;
};

const registerLegacySuspenseSlot = (props: LegacySuspenseSlotProps) => {
	registerStreamingSlot({
		dynamic: props.dynamic,
		errorHtml: props.errorHtml,
		fallbackHtml: props.fallbackHtml,
		id: props.id,
		resolve: props.resolve,
		timeoutMs: props.timeoutMs
	});
};

const registerFrameworkSuspenseSlot = <T,>(
	props: FrameworkSuspenseSlotProps<T>
) => {
	// Read while the page renders: the slot resolves after the render,
	// outside the React Server Components render's async context.
	const serverNodeRenderer = getReactServerNodeRenderer();
	registerStreamingSlot({
		dynamic: props.dynamic,
		id: props.id,
		timeoutMs: props.timeoutMs,
		resolve: async () => {
			try {
				const content = hasRenderChildren(props)
					? props.children(await resolveRenderSuspenseValue(props))
					: (props.children ??
						(await resolveNodeSuspenseValue(props)) ??
						null);

				return renderReactNodeToHtml(content, serverNodeRenderer);
			} catch (error) {
				return renderErrorFallback(props, error, serverNodeRenderer);
			}
		}
	});
};

const renderLegacySuspenseSlot = (props: LegacySuspenseSlotProps) => (
	<div
		className={props.className}
		dangerouslySetInnerHTML={{ __html: props.fallbackHtml ?? '' }}
		data-absolute-slot="true"
		id={props.id}
		suppressHydrationWarning
	/>
);

const renderFrameworkSuspenseSlot = (
	props: Pick<FrameworkSuspenseNodeProps, 'className' | 'fallback' | 'id'>
) => (
	<div
		className={props.className}
		data-absolute-slot="true"
		id={props.id}
		suppressHydrationWarning
	>
		{props.fallback ?? null}
	</div>
);

const renderServerSuspenseSlot = <T,>(props: SuspenseSlotProps<T>) => {
	if (isLegacyProps(props)) {
		registerLegacySuspenseSlot(props);

		return renderLegacySuspenseSlot(props);
	}

	registerFrameworkSuspenseSlot(props);

	return renderFrameworkSuspenseSlot(props);
};

export const SuspenseSlot = <T,>(props: SuspenseSlotProps<T>) => {
	if (isStreamingSlotCollectionActive()) {
		return renderServerSuspenseSlot(props);
	}
	warnMissingStreamingSlotCollector('SuspenseSlot');

	if (isLegacyProps(props)) return renderLegacySuspenseSlot(props);

	return renderFrameworkSuspenseSlot(props);
};
