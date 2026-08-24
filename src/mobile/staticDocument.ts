import type {
	AbsoluteMobileClientManifest,
	AbsoluteMobileClientPage
} from './transport';

const HTMX_REQUEST_ATTRIBUTE_PATTERN =
	/(\s(?:action|formaction|hx-(?:delete|get|patch|post|put))\s*=\s*["'])(\/[^"']*)(["'])/giu;
const BLOCKED_FRAGMENT_ELEMENTS =
	'script,base,iframe,object,embed,link[rel="modulepreload"],meta[http-equiv="refresh"]';
const HTMX_REQUEST_ATTRIBUTES = new Set([
	'hx-delete',
	'hx-get',
	'hx-patch',
	'hx-post',
	'hx-put'
]);
const URL_ATTRIBUTES = new Set(['action', 'formaction', 'href', 'src']);

const HEX_RADIX = 16;

const bytesToHex = (bytes: Uint8Array) =>
	[...bytes]
		.map((byte) => byte.toString(HEX_RADIX).padStart(2, '0'))
		.join('');

export const hashAbsoluteMobileStaticDocument = async (source: string) =>
	bytesToHex(
		new Uint8Array(
			await crypto.subtle.digest(
				'SHA-256',
				new TextEncoder().encode(source)
			)
		)
	);

export const rewriteAbsoluteMobileHtmxRequests = (
	source: string,
	productionOrigin: string
) =>
	source.replace(
		HTMX_REQUEST_ATTRIBUTE_PATTERN,
		(_match, prefix: string, path: string, quote: string) =>
			`${prefix}${new URL(path, productionOrigin).href}${quote}`
	);

const backendUrl = (value: string, productionOrigin: string) => {
	try {
		const expected = new URL(productionOrigin);
		const candidate = new URL(value, expected);

		return candidate.origin === expected.origin
			? candidate.href
			: undefined;
	} catch {
		return undefined;
	}
};

const sanitizeFragmentAttribute = (
	element: Element,
	attribute: Attr,
	productionOrigin: string
) => {
	const name = attribute.name.toLowerCase();
	const isExecutable =
		name === 'srcdoc' || name.startsWith('on') || name.startsWith('hx-on');
	const isUnsafeUrl =
		(HTMX_REQUEST_ATTRIBUTES.has(name) || URL_ATTRIBUTES.has(name)) &&
		!backendUrl(attribute.value, productionOrigin);
	if (isExecutable || isUnsafeUrl) element.removeAttribute(attribute.name);
	else if (HTMX_REQUEST_ATTRIBUTES.has(name) || URL_ATTRIBUTES.has(name)) {
		element.setAttribute(
			attribute.name,
			backendUrl(attribute.value, productionOrigin) ?? attribute.value
		);
	}
};

export const sanitizeAbsoluteMobileHtmxFragment = (
	source: string,
	productionOrigin: string,
	parse: (source: string) => Document = (value) =>
		new DOMParser().parseFromString(value, 'text/html')
) => {
	const parsed = parse(source);
	parsed.querySelectorAll(BLOCKED_FRAGMENT_ELEMENTS).forEach((element) => {
		element.remove();
	});
	parsed.querySelectorAll('*').forEach((element) => {
		for (const attribute of [...element.attributes]) {
			sanitizeFragmentAttribute(element, attribute, productionOrigin);
		}
	});

	return parsed.body.innerHTML;
};

const installHtmxFragmentBoundary = (productionOrigin: string) => {
	const configureRequest = (event: Event) => {
		const detail: unknown = Reflect.get(event, 'detail');
		if (typeof detail !== 'object' || detail === null) return;
		const path: unknown = Reflect.get(detail, 'path');
		if (typeof path !== 'string') return;
		const resolved = backendUrl(path, productionOrigin);
		if (resolved) Reflect.set(detail, 'path', resolved);
	};
	const sanitize = (event: Event) => {
		const detail: unknown = Reflect.get(event, 'detail');
		if (typeof detail !== 'object' || detail === null) return;
		const serverResponse: unknown = Reflect.get(detail, 'serverResponse');
		if (typeof serverResponse !== 'string') return;
		Reflect.set(
			detail,
			'serverResponse',
			sanitizeAbsoluteMobileHtmxFragment(serverResponse, productionOrigin)
		);
	};
	addEventListener('htmx:configRequest', configureRequest);
	addEventListener('htmx:beforeSwap', sanitize);

	return () => {
		removeEventListener('htmx:configRequest', configureRequest);
		removeEventListener('htmx:beforeSwap', sanitize);
	};
};

export const installAbsoluteMobileStaticDocument = async (
	manifest: AbsoluteMobileClientManifest,
	page: AbsoluteMobileClientPage,
	localUrl: string
) => {
	const response = await fetch(localUrl, { cache: 'no-store' });
	if (!response.ok) {
		throw new TypeError(
			`Embedded ${page.framework} document failed with HTTP ${response.status}.`
		);
	}
	const source = await response.text();
	const actualHash = await hashAbsoluteMobileStaticDocument(source);
	if (actualHash !== page.bundleHash) {
		throw new TypeError(
			`Embedded ${page.framework} document failed integrity.`
		);
	}
	const disposeHtmxBoundary =
		page.framework === 'htmx'
			? installHtmxFragmentBoundary(manifest.productionOrigin)
			: undefined;
	const ready = new Promise<void>((resolve) => {
		addEventListener('load', () => resolve(), { once: true });
	});
	Reflect.set(window, '__ABSOLUTE_PAGE_READY__', ready);
	Reflect.set(window, '__ABSOLUTE_PAGE_DISPOSE__', () =>
		disposeHtmxBoundary?.()
	);
	const documentSource =
		page.framework === 'htmx'
			? rewriteAbsoluteMobileHtmxRequests(
					source,
					manifest.productionOrigin
				)
			: source;
	document.open();
	document.write(documentSource);
	document.close();
};
