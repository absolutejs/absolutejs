import {
	type ReactNode,
	useEffect,
	useLayoutEffect,
	useRef,
	useState
} from 'react';
import {
	NativeSlotBoundary,
	parseSlotOutcome,
	SLOT_VALUE_ATTRIBUTE,
	type SlotOutcome,
	settledThenable,
	settleSlot
} from './suspenseSlotContent';
import {
	isReactSuspensePayload,
	type ReactSuspensePayload
} from './suspenseSlotPayload';

type LegacySuspenseSlotProps = {
	className?: string;
	dynamic?: boolean;
	errorHtml?: string;
	fallbackHtml?: string;
	id: string;
	resolve: () => Promise<string> | string;
	timeoutMs?: number;
};

type FrameworkSuspenseSlotProps<T = unknown> = {
	children?: ReactNode | ((value: T) => ReactNode);
	className?: string;
	dynamic?: boolean;
	errorFallback?: ReactNode | ((error: unknown) => ReactNode);
	id: string;
	/** Called in the browser with the slot's value, whether it streamed in
	 *  with the page or was resolved here: the place to hand it to a cache
	 *  (React Query's setQueryData) so nothing fetches it again. */
	onResolved?: (value: T) => void;
	promise?: Promise<T>;
	resolve?: () => Promise<T | ReactNode> | T | ReactNode;
	fallback?: ReactNode;
	timeoutMs?: number;
};

type SuspenseSlotProps<T = unknown> =
	| LegacySuspenseSlotProps
	| FrameworkSuspenseSlotProps<T>;

type SlotWindow = Window & {
	__ABS_SLOT_CONSUMERS__?: Record<
		string,
		((payload: unknown) => boolean | void) | undefined
	>;
	__ABS_SLOT_PENDING__?: Record<string, unknown>;
};

type Outcome =
	| { error: unknown; state: 'error' }
	| { state: 'resolved'; value: unknown };

const isLegacyProps = <T,>(
	props: SuspenseSlotProps<T>
): props is LegacySuspenseSlotProps =>
	'fallbackHtml' in props || 'errorHtml' in props;

/* Values that streamed in for slots, by id, and the slots waiting on them.
 * A payload can arrive before its slot has rendered (it streams with the
 * page), so it is kept here until the slot reads it. */
const streamed = new Map<string, Outcome>();
const waiting = new Map<string, Set<(outcome: Outcome) => void>>();

const outcomeOf = (payload: ReactSuspensePayload) => {
	const outcome: Outcome =
		payload.state === 'error'
			? {
					error: new Error('The slot failed while streaming'),
					state: 'error'
				}
			: { state: 'resolved', value: payload.value };

	return outcome;
};

/* The slot's value as the type its children expect. It came from the
 * slot's own resolve (here or on the server), so it is that type; the
 * overload says so without an assertion. */
function valueOf<T>(outcome: { value: unknown }): T;
function valueOf(outcome: { value: unknown }) {
	return outcome.value;
}

const unwrapPending = (entry: unknown) =>
	typeof entry === 'object' &&
	entry !== null &&
	'domPatched' in entry &&
	'payload' in entry
		? entry.payload
		: entry;

const deliver = (id: string, outcome: Outcome) => {
	streamed.set(id, outcome);
	for (const listener of waiting.get(id) ?? []) listener(outcome);
};

/* Claims the slot's streamed payload from the page's slot runtime: one
 * already in the page (patched in before this script ran) is read now,
 * and later ones come to the slot instead of being written into the DOM
 * underneath React. */
const claimSlot = (id: string) => {
	if (typeof window === 'undefined') return;
	const slotWindow: SlotWindow = window;
	const consumers = (slotWindow.__ABS_SLOT_CONSUMERS__ =
		slotWindow.__ABS_SLOT_CONSUMERS__ ?? {});
	if (consumers[id] === undefined)
		consumers[id] = (payload) => {
			if (!isReactSuspensePayload(payload)) return false;
			deliver(id, outcomeOf(payload));

			return true;
		};
	const queued = unwrapPending(slotWindow.__ABS_SLOT_PENDING__?.[id]);
	if (isReactSuspensePayload(queued) && !streamed.has(id))
		streamed.set(id, outcomeOf(queued));
};

/* The server marks a slot whose content is coming in the response; a slot
 * rendered by a client-side navigation has no such element yet. */
const streamIsComing = (id: string) =>
	typeof document !== 'undefined' &&
	document.getElementById(id)?.getAttribute('data-absolute-slot-stream') ===
		'true';

const resolveInBrowser = async <T,>(props: FrameworkSuspenseSlotProps<T>) => {
	if (props.resolve !== undefined) return props.resolve();
	if (props.promise !== undefined) return props.promise;

	return undefined;
};

const renderOutcome = <T,>(
	props: FrameworkSuspenseSlotProps<T>,
	outcome: Outcome | undefined
) => {
	let content: ReactNode = props.fallback ?? null;
	if (outcome?.state === 'resolved')
		content =
			typeof props.children === 'function'
				? props.children(valueOf<T>(outcome))
				: (props.children ?? valueOf<ReactNode>(outcome) ?? null);
	else if (outcome?.state === 'error')
		content =
			typeof props.errorFallback === 'function'
				? props.errorFallback(outcome.error)
				: (props.errorFallback ?? props.fallback ?? null);

	return content;
};

/**
 * A slot whose content streams in with the page and stays interactive.
 *
 * - First load: the server streams the slot's HTML and its value. The HTML
 *   shows as soon as it arrives; React renders `children(value)` from the
 *   streamed value, matching that HTML, so it hydrates cleanly and nothing
 *   is fetched twice.
 * - Client-side navigation: no stream is coming, so the slot resolves here
 *   (`resolve` or `promise`), showing `fallback` until it does.
 */
const FrameworkSuspenseSlot = <T,>(props: FrameworkSuspenseSlotProps<T>) => {
	claimSlot(props.id);
	const [outcome, setOutcome] = useState<Outcome | undefined>(() =>
		streamed.get(props.id)
	);
	const [streaming] = useState(() => streamIsComing(props.id));
	/* The latest props, read when the slot resolves: a slot resolves once
	 * per id, not again on every render with a new resolve function. */
	const latest = useRef(props);
	useLayoutEffect(() => {
		latest.current = props;
	});

	useEffect(() => {
		const listeners = waiting.get(props.id) ?? new Set();
		waiting.set(props.id, listeners);
		listeners.add(setOutcome);
		const known = streamed.get(props.id);
		let cancelled = false;
		const resolveHere = async () => {
			try {
				const value = await resolveInBrowser(latest.current);
				if (!cancelled) setOutcome({ state: 'resolved', value });
			} catch (error) {
				if (!cancelled) setOutcome({ error, state: 'error' });
			}
		};
		if (known !== undefined) setOutcome(known);
		else if (!streaming) void resolveHere();

		return () => {
			cancelled = true;
			listeners.delete(setOutcome);
		};
	}, [props.id, streaming]);

	useEffect(() => {
		if (outcome?.state === 'resolved')
			latest.current.onResolved?.(valueOf<T>(outcome));
	}, [outcome]);

	return (
		<div
			className={props.className}
			data-absolute-slot="true"
			id={props.id}
			suppressHydrationWarning
		>
			{renderOutcome(props, outcome)}
		</div>
	);
};

/* Each slot's outcome, by id, for as long as the slot is mounted: read
 * from the server's boundary when the page hydrates, or resolved here. One
 * promise per slot, so React's use() reads the same one on every render. */
const outcomes = new Map<string, Promise<SlotOutcome>>();

const streamedOutcome = (id: string) => {
	if (typeof document === 'undefined') return undefined;
	for (const script of document.querySelectorAll(
		`script[${SLOT_VALUE_ATTRIBUTE}]`
	))
		if (script.getAttribute(SLOT_VALUE_ATTRIBUTE) === id)
			return settledThenable(parseSlotOutcome(script.textContent ?? ''));

	return undefined;
};

const outcomeFor = <T,>(props: FrameworkSuspenseSlotProps<T>) => {
	const known = outcomes.get(props.id);
	if (known) return known;
	const outcome =
		streamedOutcome(props.id) ??
		settleSlot(() => resolveInBrowser(props), props.timeoutMs);
	outcomes.set(props.id, outcome);

	return outcome;
};

const renderValue = <T,>(
	props: FrameworkSuspenseSlotProps<T>,
	value: unknown
) => renderOutcome(props, { state: 'resolved', value });

/**
 * children(value) under a native Suspense boundary, as the server renders
 * it. On the first load the boundary's content and value stream in the
 * response; React hydrates it from that value, nothing resolves twice, and
 * every context above the slot reaches its content. Mounted later (a
 * client-side navigation), it resolves here and shows `fallback` until it
 * does.
 */
const NativeSuspenseSlot = <T,>(props: FrameworkSuspenseSlotProps<T>) => {
	const latest = useRef(props);
	useLayoutEffect(() => {
		latest.current = props;
	});
	/* A slot that leaves lets its outcome go: mounted again, it resolves
	 * again rather than showing what it held before. */
	useEffect(
		() => () => {
			outcomes.delete(props.id);
		},
		[props.id]
	);

	return (
		<NativeSlotBoundary
			className={props.className}
			errorFallback={props.errorFallback}
			fallback={props.fallback}
			id={props.id}
			onResolved={(value) =>
				latest.current.onResolved?.(valueOf<T>({ value }))
			}
			outcome={outcomeFor(props)}
			render={(value) => renderValue(props, value)}
		/>
	);
};

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

	/* A slot the server streams through the slot collector (partial
	 * prerendering, React Server Components) is taken over from that
	 * stream; any other slot rendering children(value) is a native one. */
	if (typeof props.children === 'function' && !streamIsComing(props.id))
		return <NativeSuspenseSlot {...props} />;

	return <FrameworkSuspenseSlot {...props} />;
};
