import {
	type ReactNode,
	Suspense,
	use,
	useEffect,
	useLayoutEffect,
	useRef
} from 'react';

/* A React SuspenseSlot rendered through children(value) renders inside the
 * page's own tree, under a native Suspense boundary: React streams the
 * content in the same response, and the content keeps every context above
 * it (router, data cache, theme). The value goes with the content, in a
 * JSON script inside the boundary, so the browser hydrates from it without
 * resolving again. */

export type SlotOutcome =
	{ error: unknown; state: 'error' } | { state: 'resolved'; value: unknown };

/* A promise React's use() reads at once: one already settled, marked the
 * way React marks the promises it has seen fulfil. */
export type SettledThenable = Promise<SlotOutcome> & {
	status?: 'fulfilled';
	value?: SlotOutcome;
};

export const SLOT_VALUE_ATTRIBUTE = 'data-absolute-slot-value';
const DATE_TAG = '__absoluteDate';

export const serializeSlotOutcome = (outcome: SlotOutcome) =>
	JSON.stringify(
		outcome.state === 'resolved'
			? { state: 'resolved', value: outcome.value }
			: { state: 'error' },
		function replace(this: Record<string, unknown>, key, value: unknown) {
			const raw = this[key];

			return raw instanceof Date
				? { [DATE_TAG]: raw.toISOString() }
				: value;
		}
	)
		.replace(/</g, '\\u003c')
		.replace(/\u2028/g, '\\u2028')
		.replace(/\u2029/g, '\\u2029');
export const settledThenable = (outcome: SlotOutcome) => {
	const thenable: SettledThenable = Promise.resolve(outcome);
	thenable.status = 'fulfilled';
	thenable.value = outcome;

	return thenable;
};
export const settleSlot = async (
	resolve: () => unknown,
	timeoutMs: number | undefined
) => {
	let outcome: SlotOutcome;
	try {
		const pending = Promise.resolve(resolve());
		const value =
			timeoutMs === undefined
				? await pending
				: await Promise.race([
						pending,
						new Promise((_resolve, reject) =>
							setTimeout(
								() =>
									reject(
										new Error(
											`The slot did not resolve within ${timeoutMs} ms`
										)
									),
								timeoutMs
							)
						)
					]);
		outcome = { state: 'resolved', value };
	} catch (error) {
		outcome = { error, state: 'error' };
	}

	return outcome;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

export const parseSlotOutcome = (text: string) => {
	const parsed: unknown = JSON.parse(text, (_key, value: unknown) =>
		isRecord(value) && typeof value[DATE_TAG] === 'string'
			? new Date(value[DATE_TAG])
			: value
	);
	const outcome: SlotOutcome =
		isRecord(parsed) && parsed.state === 'resolved'
			? { state: 'resolved', value: parsed.value }
			: {
					error: new Error('The slot failed on the server'),
					state: 'error'
				};

	return outcome;
};

type SlotContentProps = {
	errorFallback?: ReactNode | ((error: unknown) => ReactNode);
	fallback?: ReactNode;
	id: string;
	/** Browser only: called once with the value the slot settled on. */
	onResolved?: (value: unknown) => void;
	outcome: Promise<SlotOutcome>;
	render: (value: unknown) => ReactNode;
};

const SlotContent = ({
	errorFallback,
	fallback,
	id,
	onResolved,
	outcome,
	render
}: SlotContentProps) => {
	const settled = use(outcome);
	const latest = useRef(onResolved);
	useLayoutEffect(() => {
		latest.current = onResolved;
	});
	useEffect(() => {
		if (settled.state === 'resolved') latest.current?.(settled.value);
	}, [settled]);
	let content: ReactNode;
	if (settled.state === 'resolved') content = render(settled.value);
	else if (typeof errorFallback === 'function')
		content = errorFallback(settled.error);
	else content = errorFallback ?? fallback ?? null;

	return (
		<>
			{content}
			<script
				dangerouslySetInnerHTML={{
					__html: serializeSlotOutcome(settled)
				}}
				{...{ [SLOT_VALUE_ATTRIBUTE]: id }}
				suppressHydrationWarning
				type="application/json"
			/>
		</>
	);
};

type SlotFrameProps = { children: ReactNode; className?: string; id: string };

/* The element a slot occupies: its id, class and marker, the same on the
 * server and in the browser. */
export const SlotFrame = ({ children, className, id }: SlotFrameProps) => (
	<div
		className={className}
		data-absolute-slot="true"
		id={id}
		suppressHydrationWarning
	>
		{children}
	</div>
);

type NativeSlotBoundaryProps = SlotContentProps & { className?: string };

/* The slot's frame around a native Suspense boundary that shows `fallback`
 * until the outcome settles, then the content and its value. */
export const NativeSlotBoundary = ({
	className,
	fallback,
	...content
}: NativeSlotBoundaryProps) => (
	<SlotFrame className={className} id={content.id}>
		<Suspense fallback={fallback ?? null}>
			<SlotContent fallback={fallback} {...content} />
		</Suspense>
	</SlotFrame>
);
