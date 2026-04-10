import type { ReactNode } from 'react';
import {
	isStreamingSlotCollectionActive,
	registerStreamingSlot,
	warnMissingStreamingSlotCollector
} from '../../core/streamingSlotRegistrar';

type LegacySuspenseSlotProps = {
	className?: string;
	errorHtml?: string;
	fallbackHtml?: string;
	id: string;
	resolve: () => Promise<string> | string;
	timeoutMs?: number;
};

type FrameworkSuspenseRenderProps<T = unknown> = {
	children: (value: Awaited<T>) => ReactNode;
	className?: string;
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
	errorFallback?: ReactNode | ((error: unknown) => ReactNode);
	id: string;
	promise?: Promise<ReactNode>;
	resolve?: () => Promise<ReactNode> | ReactNode;
	fallback?: ReactNode;
	timeoutMs?: number;
};

type FrameworkSuspenseSlotProps<T = unknown> =
	| FrameworkSuspenseRenderProps<T>
	| FrameworkSuspenseNodeProps;

type SuspenseSlotProps<T = unknown> =
	| LegacySuspenseSlotProps
	| FrameworkSuspenseSlotProps<T>;

const isLegacyProps = <T,>(
	props: SuspenseSlotProps<T>
): props is LegacySuspenseSlotProps =>
	'fallbackHtml' in props || 'errorHtml' in props;

const renderReactNodeToHtml = async (node: ReactNode) => {
	const { Fragment } = await import('react');
	const { renderToStaticMarkup } = await import('react-dom/server');

	return renderToStaticMarkup(<Fragment>{node}</Fragment>);
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
	error: unknown
) => {
	if (typeof props.errorFallback === 'function') {
		return renderReactNodeToHtml(props.errorFallback(error));
	}

	if (props.errorFallback !== undefined) {
		return renderReactNodeToHtml(props.errorFallback);
	}

	throw error;
};

const registerLegacySuspenseSlot = (props: LegacySuspenseSlotProps) => {
	registerStreamingSlot({
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
	registerStreamingSlot({
		id: props.id,
		timeoutMs: props.timeoutMs,
		resolve: async () => {
			try {
				const content = hasRenderChildren(props)
					? props.children(await resolveRenderSuspenseValue(props))
					: (props.children ??
						(await resolveNodeSuspenseValue(props)) ??
						null);

				return renderReactNodeToHtml(content);
			} catch (error) {
				return renderErrorFallback(props, error);
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
