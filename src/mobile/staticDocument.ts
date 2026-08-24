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
const SCRIPT_PLACEHOLDER_ATTRIBUTE = 'data-absolute-mobile-script';

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
	const validateUrl = (event: Event) => {
		const detail: unknown = Reflect.get(event, 'detail');
		if (typeof detail !== 'object' || detail === null) {
			event.preventDefault();

			return;
		}
		const url: unknown = Reflect.get(detail, 'url');
		if (!(url instanceof URL) || !backendUrl(url.href, productionOrigin)) {
			event.preventDefault();
		}
	};
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
	addEventListener('htmx:validateUrl', validateUrl);
	addEventListener('htmx:configRequest', configureRequest);
	addEventListener('htmx:beforeSwap', sanitize);

	return () => {
		removeEventListener('htmx:validateUrl', validateUrl);
		removeEventListener('htmx:configRequest', configureRequest);
		removeEventListener('htmx:beforeSwap', sanitize);
	};
};

type TrustedDocumentScript = {
	attributes: [string, string][];
	content: string;
};

type InstallTrustedDocumentOptions = {
	htmx: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const replaceAttributes = (target: Element, source: Element) => {
	for (const attribute of [...target.attributes]) {
		target.removeAttribute(attribute.name);
	}
	for (const attribute of [...source.attributes]) {
		target.setAttribute(attribute.name, attribute.value);
	}
};

const applyScriptAttribute = (
	element: HTMLScriptElement,
	name: string,
	value: string,
	localUrl: string
) => {
	if (name === SCRIPT_PLACEHOLDER_ATTRIBUTE) return;
	if (name === 'src') {
		const source = new URL(value, localUrl);
		const navigation = new URL(localUrl).searchParams.get(
			'absoluteNavigation'
		);
		if (navigation)
			source.searchParams.set('absoluteNavigation', navigation);
		element.src = source.href;

		return;
	}
	element.setAttribute(name, value);
};

const executableScript = (script: TrustedDocumentScript, localUrl: string) => {
	const element = document.createElement('script');
	for (const [name, value] of script.attributes) {
		applyScriptAttribute(element, name, value, localUrl);
	}
	element.textContent = script.content;

	return element;
};

const executeTrustedDocumentScript = async (
	placeholder: HTMLScriptElement,
	script: TrustedDocumentScript,
	localUrl: string
) => {
	const executable = executableScript(script, localUrl);
	if (executable.type === 'module' && executable.src !== '') {
		placeholder.remove();
		await import(executable.src);

		return;
	}
	const waitsForLoad = executable.src !== '' || executable.type === 'module';
	const loaded = waitsForLoad
		? new Promise<void>((resolve, reject) => {
				executable.addEventListener('load', () => resolve(), {
					once: true
				});
				executable.addEventListener(
					'error',
					() =>
						reject(
							new TypeError(
								`Embedded document script failed: ${executable.src || 'inline module'}.`
							)
						),
					{ once: true }
				);
			})
		: Promise.resolve();
	placeholder.replaceWith(executable);
	await loaded;
};

const configureHtmxDocument = (parsed: Document) => {
	let meta = parsed.head.querySelector<HTMLMetaElement>(
		'meta[name="htmx-config"]'
	);
	if (!meta) {
		meta = parsed.createElement('meta');
		meta.name = 'htmx-config';
		parsed.head.appendChild(meta);
	}
	let authorConfig: Record<string, unknown> = {};
	try {
		const parsedConfig: unknown = JSON.parse(meta.content || '{}');
		if (isRecord(parsedConfig)) authorConfig = parsedConfig;
	} catch {
		// Invalid author config is replaced by the safe mobile transport config.
	}
	meta.content = JSON.stringify({
		...authorConfig,
		selfRequestsOnly: false
	});
};

const executeTrustedDocumentScripts = async (
	scripts: readonly TrustedDocumentScript[],
	localUrl: string,
	index = 0
): Promise<void> => {
	const script = scripts[index];
	if (!script) return;
	const placeholder = document.querySelector<HTMLScriptElement>(
		`script[${SCRIPT_PLACEHOLDER_ATTRIBUTE}="${index}"]`
	);
	if (placeholder) {
		await executeTrustedDocumentScript(placeholder, script, localUrl);
	}

	await executeTrustedDocumentScripts(scripts, localUrl, index + 1);
};

const installTrustedDocument = async (
	source: string,
	localUrl: string,
	options: InstallTrustedDocumentOptions
) => {
	const parsed = new DOMParser().parseFromString(source, 'text/html');
	if (options.htmx) configureHtmxDocument(parsed);
	const scripts = [...parsed.querySelectorAll('script')].map(
		(script, index) => {
			const definition: TrustedDocumentScript = {
				attributes: [...script.attributes].map((attribute) => [
					attribute.name,
					attribute.value
				]),
				content: script.textContent ?? ''
			};
			script.removeAttribute('src');
			script.type = 'application/x-absolute-mobile-script';
			script.setAttribute(SCRIPT_PLACEHOLDER_ATTRIBUTE, String(index));

			return definition;
		}
	);
	replaceAttributes(document.documentElement, parsed.documentElement);
	document.head.replaceChildren(
		...[...parsed.head.childNodes].map((node) =>
			document.importNode(node, true)
		)
	);
	document.body.replaceWith(document.importNode(parsed.body, true));

	await executeTrustedDocumentScripts(scripts, localUrl);
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
	const ready = installTrustedDocument(
		page.framework === 'htmx'
			? rewriteAbsoluteMobileHtmxRequests(
					source,
					manifest.productionOrigin
				)
			: source,
		localUrl,
		{ htmx: page.framework === 'htmx' }
	);
	Reflect.set(window, '__ABSOLUTE_PAGE_READY__', ready);
	Reflect.set(window, '__ABSOLUTE_PAGE_DISPOSE__', () =>
		disposeHtmxBoundary?.()
	);
	await ready;
};
