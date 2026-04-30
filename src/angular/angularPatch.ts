import { resolveAngularPackage } from './resolveAngularPackage';

// Patches Angular SSR's DominoAdapter to guard against null doc.head

const ensureHead = (doc: Document) => {
	if (!doc || doc.head || !doc.documentElement) {
		return;
	}

	const head = doc.createElement('head');
	doc.documentElement.insertBefore(head, doc.documentElement.firstChild);
};

// Domino's Element does not implement layout APIs that browser components
// (e.g. ngx-datatable, swiper, drag-drop) call eagerly during change detection.
// Returning a zeroed DOMRect lets those components render in SSR without
// crashing — the real values get computed once the page hydrates client-side.
const SSR_LAYOUT_RECT = Object.freeze({
	bottom: 0,
	height: 0,
	left: 0,
	right: 0,
	top: 0,
	width: 0,
	x: 0,
	y: 0,
	toJSON() {
		return this;
	}
});
let layoutPatchApplied = false;
const collectPrototypeChain = (instance: object | null) => {
	const protos: object[] = [];
	let current: object | null = instance
		? Object.getPrototypeOf(instance)
		: null;
	while (current && current !== Object.prototype) {
		protos.push(current);
		current = Object.getPrototypeOf(current);
	}

	return protos;
};

const patchElementLayout = (doc: Document) => {
	if (layoutPatchApplied || !doc) {
		return;
	}
	let element: Element;
	try {
		element = doc.createElement('div');
	} catch {
		return;
	}
	// Walk the entire prototype chain so HTMLElement → Element → Node all get
	// the layout shims. Domino's base Element.prototype is several hops above
	// HTMLDivElement.prototype, and 3rd-party libs call methods anywhere along
	// the chain.
	const protos = collectPrototypeChain(element);
	if (protos.length === 0) return;

	const copyLayoutRect = (rect: typeof SSR_LAYOUT_RECT) => ({ ...rect });
	const createLayoutRect = () => copyLayoutRect(SSR_LAYOUT_RECT);
	const getClientRects = () => [];
	const noop = () => undefined;
	const numericProps = [
		'clientWidth',
		'clientHeight',
		'clientLeft',
		'clientTop',
		'offsetWidth',
		'offsetHeight',
		'offsetLeft',
		'offsetTop',
		'scrollWidth',
		'scrollHeight',
		'scrollLeft',
		'scrollTop'
	];

	for (const proto of protos) {
		const define = (name: string, value: unknown) => {
			const descriptor = Object.getOwnPropertyDescriptor(proto, name);
			if (typeof descriptor?.value === 'function') return;

			Object.defineProperty(proto, name, {
				configurable: true,
				value,
				writable: true
			});
		};

		define('getBoundingClientRect', createLayoutRect);
		define('getClientRects', getClientRects);
		define('scrollTo', noop);
		define('scrollBy', noop);
		define('scrollIntoView', noop);
		define('focus', noop);
		define('blur', noop);

		for (const prop of numericProps) {
			const desc = Object.getOwnPropertyDescriptor(proto, prop);
			if (desc) continue;
			Object.defineProperty(proto, prop, {
				configurable: true,
				get: () => 0
			});
		}
	}

	layoutPatchApplied = true;
};

export const applyPatches = async () => {
	const { ɵDominoAdapter } = await import(
		resolveAngularPackage('@angular/platform-server')
	);
	if (!ɵDominoAdapter?.prototype) {
		console.warn(
			'[Angular Patch] ɵDominoAdapter not found, skipping patches'
		);

		return false;
	}

	// Patch the layout shims onto Domino's Element prototypes immediately
	// (don't wait for the first createHtmlDocument call). Components that
	// hold an ElementRef from the very first change-detection pass call
	// these methods before the lazy patch path would have run.
	try {
		const adapter = new ɵDominoAdapter();
		const seedDoc =
			typeof adapter.createHtmlDocument === 'function'
				? adapter.createHtmlDocument()
				: typeof adapter.getDefaultDocument === 'function'
					? adapter.getDefaultDocument()
					: null;
		if (seedDoc) {
			patchElementLayout(seedDoc);
			const probe = seedDoc.createElement('div') as Element & {
				getBoundingClientRect?: () => DOMRect;
			};
			if (typeof probe.getBoundingClientRect !== 'function') {
				console.warn(
					'[Angular Patch] Layout shim did not stick on probe element prototype chain'
				);
			}
		}
	} catch (error) {
		console.warn(
			'[Angular Patch] Could not eagerly patch Element prototypes:',
			error
		);
	}

	const proto = ɵDominoAdapter.prototype;

	const origGetBaseHref = proto.getBaseHref;
	proto.getBaseHref = function (doc: Document) {
		if (!doc || !doc.head || typeof doc.head.children === 'undefined') {
			return '';
		}

		return origGetBaseHref.call(this, doc);
	};

	const origCreateHtmlDocument = proto.createHtmlDocument;
	proto.createHtmlDocument = function () {
		const doc = origCreateHtmlDocument.call(this);
		ensureHead(doc);
		patchElementLayout(doc);

		return doc;
	};

	const origGetDefaultDocument = proto.getDefaultDocument;
	proto.getDefaultDocument = function () {
		const doc = origGetDefaultDocument.call(this);
		ensureHead(doc);
		patchElementLayout(doc);

		return doc;
	};

	return true;
};
