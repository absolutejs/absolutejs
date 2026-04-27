type AbsoluteSlotWindow = Window & {
	__ABS_SLOT_ENQUEUE__?: (id: string, payload: unknown) => void;
	__ABS_SLOT_FLUSH__?: () => void;
	__ABS_SLOT_CONSUMERS__?: Record<
		string,
		((payload: unknown) => boolean | void) | undefined
	>;
	__ABS_SLOT_HYDRATION_PENDING__?: boolean;
	__ABS_SLOT_PENDING__?: Record<string, unknown>;
	__ABS_SLOT_RUNTIME__?: boolean;
};

const streamSwapRuntime = () => {
	const absoluteWindow: AbsoluteSlotWindow = window;
	const SLOT_PATCH_EVENT = 'absolutejs:slot-patch';
	if (absoluteWindow.__ABS_SLOT_RUNTIME__ === true) return;
	absoluteWindow.__ABS_SLOT_RUNTIME__ = true;
	absoluteWindow.__ABS_SLOT_CONSUMERS__ =
		absoluteWindow.__ABS_SLOT_CONSUMERS__ ?? {};
	absoluteWindow.__ABS_SLOT_PENDING__ =
		absoluteWindow.__ABS_SLOT_PENDING__ ?? {};
	const consumers = absoluteWindow.__ABS_SLOT_CONSUMERS__;
	const pending = absoluteWindow.__ABS_SLOT_PENDING__;
	const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
		Boolean(value) && typeof value === 'object';
	const isPatchedPendingEntry = (
		value: unknown
	): value is {
		domPatched: true;
		payload: unknown;
	} => {
		if (!isObjectRecord(value)) return false;

		return value.domPatched === true && 'payload' in value;
	};
	const unwrapPendingPayload = (value: unknown) =>
		isPatchedPendingEntry(value) ? value.payload : value;
	const canApplyImmediately = () =>
		absoluteWindow.__ABS_SLOT_HYDRATION_PENDING__ !== true;
	const isAngularDeferPayload = (payload: unknown) => {
		if (!isObjectRecord(payload)) return false;

		return payload.kind === 'angular-defer';
	};
	const isVueSuspensePayload = (payload: unknown) => {
		if (!isObjectRecord(payload)) return false;

		return payload.kind === 'vue-suspense';
	};
	const resolveHtml = (payload: unknown) => {
		if (!isObjectRecord(payload)) {
			return typeof payload === 'string' ? payload : '';
		}
		if (typeof payload.html === 'string') {
			return payload.html;
		}

		return '';
	};

	const apply = (id: string, pendingEntry: unknown) => {
		const payload = unwrapPendingPayload(pendingEntry);
		if (!canApplyImmediately()) {
			pending[id] = payload;

			return;
		}
		const consumer = consumers[id];
		if (typeof consumer !== 'function') {
			applyToDom(id, payload, pendingEntry);

			return;
		}

		const handled = consumer(payload);
		if (handled !== false) {
			delete pending[id];

			return;
		}

		applyToDom(id, payload, pendingEntry);
	};
	const applyToDom = (
		id: string,
		payload: unknown,
		pendingEntry: unknown
	) => {
		if (isAngularDeferPayload(payload)) {
			pending[id] = payload;

			return;
		}
		const node = document.getElementById(id);
		if (!node) {
			pending[id] = payload;

			return;
		}
		const html = resolveHtml(payload);
		if (
			isVueSuspensePayload(payload) &&
			isPatchedPendingEntry(pendingEntry)
		) {
			return;
		}
		node.innerHTML = html;
		node.setAttribute('data-absolute-slot-state', 'resolved');
		window.dispatchEvent(
			new CustomEvent(SLOT_PATCH_EVENT, {
				detail: { html, id, payload }
			})
		);
		if (isVueSuspensePayload(payload)) {
			pending[id] = { domPatched: true, payload };

			return;
		}
		delete pending[id];
	};

	const flush = () => {
		for (const id in pending) {
			if (!Object.prototype.hasOwnProperty.call(pending, id)) continue;
			apply(id, pending[id] ?? '');
		}
	};

	absoluteWindow.__ABS_SLOT_FLUSH__ = flush;
	absoluteWindow.__ABS_SLOT_ENQUEUE__ = (id: string, payload: unknown) => {
		apply(id, payload);
	};

	if (typeof MutationObserver === 'function') {
		const observer = new MutationObserver(flush);
		const root = document.documentElement ?? document.body ?? document;
		observer.observe(root, { childList: true, subtree: true });
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', flush, { once: true });
	}
	flush();
};

const stripFunctionWrapper = (value: string) => {
	const start = value.indexOf('{');
	const end = value.lastIndexOf('}');
	if (start < 0 || end <= start) return '';

	return value.slice(start + 1, end);
};

export const getStreamSwapRuntimeScript = () =>
	`(function(){${stripFunctionWrapper(streamSwapRuntime.toString())}})();`;
