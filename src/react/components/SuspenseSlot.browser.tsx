import type { ReactNode } from 'react';

type LegacySuspenseSlotProps = {
	className?: string;
	errorHtml?: string;
	fallbackHtml?: string;
	id: string;
	resolve: () => Promise<string> | string;
	timeoutMs?: number;
};

type FrameworkSuspenseSlotProps<T = unknown> = {
	children?: ReactNode | ((value: T) => ReactNode);
	className?: string;
	errorFallback?: ReactNode | ((error: unknown) => ReactNode);
	id: string;
	promise?: Promise<T>;
	resolve?: () => Promise<T | ReactNode> | T | ReactNode;
	fallback?: ReactNode;
	timeoutMs?: number;
};

type SuspenseSlotProps<T = unknown> =
	| LegacySuspenseSlotProps
	| FrameworkSuspenseSlotProps<T>;

const isLegacyProps = <T,>(
	props: SuspenseSlotProps<T>
): props is LegacySuspenseSlotProps =>
	'fallbackHtml' in props || 'errorHtml' in props;

export const SuspenseSlot = <T,>(props: SuspenseSlotProps<T>) => {
	if (isLegacyProps(props)) {
		return (
			<div
				className={props.className}
				dangerouslySetInnerHTML={{ __html: props.fallbackHtml ?? '' }}
				data-absolute-slot="true"
				id={props.id}
				suppressHydrationWarning
			/>
		);
	}

	return (
		<div
			className={props.className}
			data-absolute-slot="true"
			id={props.id}
			suppressHydrationWarning
		>
			{props.fallback ?? null}
		</div>
	);
};
