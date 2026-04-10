import {
	cloneVNode,
	defineComponent,
	h,
	isVNode,
	onMounted,
	onBeforeUnmount,
	ref,
	useSSRContext,
	type Slot,
	type VNodeChild
} from 'vue';
import {
	isStreamingSlotCollectionActive,
	registerStreamingSlot,
	warnMissingStreamingSlotCollector
} from '../../core/streamingSlotRegistrar';

const renderVueNodesToHtml = async (nodes: VNodeChild) => {
	const { createSSRApp, h: createVNode } = await import('vue');
	const { renderToString } = await import('vue/server-renderer');

	const app = createSSRApp({
		render: () => createVNode('div', undefined, nodes ?? undefined)
	});
	const html = await renderToString(app);

	return html.replace(/^<div>|<\/div>$/g, '');
};

const hasFrameworkSlots = (
	defaultSlot: Slot | undefined,
	fallbackSlot: Slot | undefined,
	errorSlot: Slot | undefined,
	promise: Promise<unknown> | undefined
) =>
	defaultSlot !== undefined ||
	fallbackSlot !== undefined ||
	errorSlot !== undefined ||
	promise !== undefined;

const allowMismatchOnSlotNodes: (nodes: VNodeChild) => VNodeChild = (nodes) => {
	if (Array.isArray(nodes)) {
		return nodes.map((node) => allowMismatchOnSlotNodes(node));
	}
	if (isVNode(nodes)) {
		return cloneVNode(nodes, {
			'data-allow-mismatch': ''
		});
	}

	return nodes;
};

const resolveSuspenseValue = async (
	resolve: (() => Promise<unknown> | unknown) | undefined,
	promise: Promise<unknown> | undefined
) => {
	if (resolve !== undefined) {
		return resolve();
	}

	if (promise !== undefined) {
		return promise;
	}

	return undefined;
};

type LegacySuspenseSlotRegistration = {
	errorHtml?: string;
	fallbackHtml: string;
	id: string;
	resolve: () => Promise<string> | string;
	timeoutMs?: number;
};

type SuspenseSlotProps = {
	className?: string;
	errorHtml?: string;
	fallbackHtml: string;
	id: string;
	promise?: Promise<unknown>;
	resolve?: () => Promise<unknown> | unknown;
	timeoutMs?: number;
};

type VueSuspensePayload = {
	kind: 'vue-suspense';
	state?: unknown;
	value?: unknown;
};

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === 'object';

const isVueSuspensePayload = (
	payload: unknown
): payload is VueSuspensePayload => {
	if (!isObjectRecord(payload)) {
		return false;
	}

	return payload.kind === 'vue-suspense';
};

const hasEventDetailId = (event: Event, id: string) => {
	if (!(event instanceof CustomEvent)) {
		return false;
	}

	const { detail } = event;
	if (!detail || typeof detail !== 'object') {
		return false;
	}

	return detail.id === id;
};

const toLegacySuspenseSlotRegistration = (
	props: SuspenseSlotProps
): LegacySuspenseSlotRegistration | null => {
	if (!props.resolve) {
		return null;
	}

	return {
		errorHtml: props.errorHtml,
		fallbackHtml: props.fallbackHtml,
		id: props.id,
		timeoutMs: props.timeoutMs,
		resolve: async () => {
			const resolved = await props.resolve?.();

			return typeof resolved === 'string' ? resolved : '';
		}
	};
};

const registerLegacySuspenseSlot = (props: LegacySuspenseSlotRegistration) => {
	registerStreamingSlot({
		errorHtml: props.errorHtml,
		fallbackHtml: props.fallbackHtml,
		id: props.id,
		resolve: props.resolve,
		timeoutMs: props.timeoutMs
	});
};

export const SuspenseSlot = defineComponent({
	name: 'AbsoluteSuspenseSlot',
	props: {
		className: { default: undefined, type: String },
		errorHtml: { default: undefined, type: String },
		fallbackHtml: { default: '', type: String },
		id: { required: true, type: String },
		promise: {
			default: undefined,
			type: Object
		},
		resolve: {
			default: undefined,
			type: Function
		},
		timeoutMs: { default: undefined, type: Number }
	},
	setup(props: SuspenseSlotProps, { slots }) {
		const readPatchedDomState = () => {
			if (typeof document === 'undefined') return false;
			const slotNode = document.getElementById(props.id);
			if (!slotNode) return false;

			return (
				slotNode.getAttribute('data-absolute-slot-state') === 'resolved'
			);
		};
		const isResolved = ref(false);
		const resolvedValue = ref<unknown>(undefined);
		const hasError = ref(false);
		const hasPatchedDom = ref(readPatchedDomState());
		const usesFrameworkSlots = hasFrameworkSlots(
			slots.default,
			slots.fallback,
			slots.error,
			props.promise
		);
		const isSsrRender = useSSRContext() !== undefined;

		if (isSsrRender) {
			if (!isStreamingSlotCollectionActive()) {
				warnMissingStreamingSlotCollector('SuspenseSlot');
			}
			const legacyRegistration = toLegacySuspenseSlotRegistration(props);
			if (!usesFrameworkSlots && legacyRegistration) {
				return registerLegacySuspenseSlot(legacyRegistration);
			}

			registerStreamingSlot({
				id: props.id,
				timeoutMs: props.timeoutMs,
				resolve: async () => {
					try {
						const value = await resolveSuspenseValue(
							props.resolve,
							props.promise
						);

						const nodes = allowMismatchOnSlotNodes(
							slots.default?.({ value }) ?? []
						);
						const html = await renderVueNodesToHtml(nodes);

						return {
							html,
							kind: 'vue-suspense',
							value
						};
					} catch (error) {
						const errorNodes = slots.error?.({ error });
						if (errorNodes !== undefined)
							return renderVueNodesToHtml(
								allowMismatchOnSlotNodes(errorNodes)
							);
						if (typeof props.errorHtml === 'string')
							return props.errorHtml;

						throw error;
					}
				}
			});
		}

		if (typeof window !== 'undefined' && usesFrameworkSlots) {
			const consumers = (window.__ABS_SLOT_CONSUMERS__ =
				window.__ABS_SLOT_CONSUMERS__ ?? {});
			let runtimeReady = false;
			consumers[props.id] = (payload) => {
				if (!runtimeReady) return false;
				if (!isVueSuspensePayload(payload)) {
					return false;
				}
				hasError.value = payload.state === 'error';
				resolvedValue.value = payload.value;
				isResolved.value = payload.state !== 'error';

				return true;
			};
			const handlePatchedDom = (event: Event) => {
				if (hasEventDetailId(event, props.id)) {
					hasPatchedDom.value = true;
				}
			};
			onMounted(() => {
				hasPatchedDom.value = readPatchedDomState();
				window.addEventListener(
					'absolutejs:slot-patch',
					handlePatchedDom
				);
				runtimeReady = true;
				window.__ABS_SLOT_FLUSH__?.();
			});
			onBeforeUnmount(() => {
				window.removeEventListener(
					'absolutejs:slot-patch',
					handlePatchedDom
				);
				delete window.__ABS_SLOT_CONSUMERS__?.[props.id];
			});
		}

		const resolveSlotChildren = () => {
			if (hasPatchedDom.value) {
				return undefined;
			}

			if (hasError.value) {
				return (
					allowMismatchOnSlotNodes(
						slots.error?.({ error: undefined }) ??
							slots.fallback?.() ??
							undefined
					) ?? undefined
				);
			}

			if (isResolved.value) {
				return (
					allowMismatchOnSlotNodes(
						slots.default?.({ value: resolvedValue.value }) ??
							undefined
					) ?? undefined
				);
			}

			return allowMismatchOnSlotNodes(slots.fallback?.() ?? undefined);
		};

		return () => {
			if (!usesFrameworkSlots) {
				return h('div', {
					class: props.className,
					'data-absolute-slot': 'true',
					id: props.id,
					innerHTML: props.fallbackHtml
				});
			}

			return h(
				'div',
				{
					class: props.className,
					'data-absolute-slot': 'true',
					'data-allow-mismatch': '',
					id: props.id
				},
				resolveSlotChildren() ?? undefined
			);
		};
	}
});
