import { getAngularDeps } from './angularDeps';
import { withSuppressedAngularDevLogs } from './ssrRender';
import { getSsrContextId } from '../utils/registerClientScript';

const angularIslandSelector = 'abs-angular-island';

export const getAngularIslandSelector = (_islandId: string) =>
	angularIslandSelector;

const getSelectorFromRenderedIsland = (rootElement: HTMLElement) => {
	const firstChild = rootElement.firstElementChild;
	if (!(firstChild instanceof HTMLElement)) {
		return null;
	}

	const selector = firstChild.tagName.toLowerCase();

	return selector.length > 0 ? selector : null;
};

const getClientAngularComponentSelector = (
	component: import('@angular/core').Type<object>
) => {
	const maybeDef = Reflect.get(component, 'ɵcmp');
	if (typeof maybeDef !== 'object' || maybeDef === null) {
		return null;
	}

	const maybeSelectors = Reflect.get(maybeDef, 'selectors');
	if (!Array.isArray(maybeSelectors)) {
		return null;
	}

	const [firstSelectorGroup] = maybeSelectors;
	if (!Array.isArray(firstSelectorGroup)) {
		return null;
	}

	const [selector] = firstSelectorGroup;

	return typeof selector === 'string' && selector.length > 0
		? selector
		: null;
};

const createAngularIslandApp = async () => {
	const { EnvironmentInjector, provideZonelessChangeDetection } =
		await import('@angular/core');
	const { createApplication } = await import('@angular/platform-browser');
	const app = await createApplication({
		providers: [provideZonelessChangeDetection()]
	});
	const environmentInjector = app.injector.get(EnvironmentInjector);

	return { app, environmentInjector };
};

let angularIslandAppPromise: Promise<{
	app: import('@angular/core').ApplicationRef;
	environmentInjector: import('@angular/core').EnvironmentInjector;
}> | null = null;

const getAngularIslandApp = async () => {
	if (!angularIslandAppPromise) {
		angularIslandAppPromise = createAngularIslandApp();
	}

	return angularIslandAppPromise;
};

type AngularIslandWrapperMetadata = {
	deps: Awaited<ReturnType<typeof getAngularDeps>>;
	propsToken: import('@angular/core').InjectionToken<Record<string, unknown>>;
	selector: string;
	WrapperComponent: import('@angular/core').Type<object>;
};

const wrapperMetadataCache = new Map<
	string,
	Promise<AngularIslandWrapperMetadata>
>();
const requestRenderCache = new Map<string, Map<string, string>>();

const getRequestRenderCache = () => {
	const requestId = getSsrContextId();
	if (!requestId) {
		return null;
	}

	const cached = requestRenderCache.get(requestId);
	if (cached) {
		return cached;
	}

	const renderCache = new Map<string, string>();
	requestRenderCache.set(requestId, renderCache);

	return renderCache;
};

const getAngularIslandWrapperKey = (
	component: import('@angular/core').Type<object>,
	_islandId: string
) => {
	const componentName =
		typeof component.name === 'string' && component.name.length > 0
			? component.name
			: 'AngularIsland';

	return `${componentName}:${angularIslandSelector}`;
};

const getIslandRenderCacheKey = (
	component: import('@angular/core').Type<object>,
	props: Record<string, unknown>
) => {
	const componentName =
		typeof component.name === 'string' && component.name.length > 0
			? component.name
			: 'AngularIsland';

	return `${componentName}:${JSON.stringify(props)}`;
};

const buildAngularIslandWrapperMetadata = async (
	component: import('@angular/core').Type<object>,
	islandId: string,
	wrapperKey: string
) => {
	const { Component, InjectionToken, inject } = await import('@angular/core');
	const { NgComponentOutlet } = await import('@angular/common');
	const deps = await getAngularDeps();
	const selector = getAngularIslandSelector(islandId);
	const propsToken = new InjectionToken<Record<string, unknown>>(
		`${wrapperKey}:props`
	);

	class AngularIslandWrapperComponent {
		component = component;
		props = inject(propsToken);
	}

	return {
		deps,
		propsToken,
		selector,
		WrapperComponent: Component({
			imports: [NgComponentOutlet, component],
			selector,
			standalone: true,
			template:
				'<ng-container *ngComponentOutlet="component; inputs: props"></ng-container>'
		})(AngularIslandWrapperComponent)
	};
};

const createAngularIslandWrapper = async (
	component: import('@angular/core').Type<object>,
	islandId: string
) => {
	const wrapperKey = getAngularIslandWrapperKey(component, islandId);
	const cached = wrapperMetadataCache.get(wrapperKey);
	if (cached) {
		return cached;
	}

	const metadataPromise = buildAngularIslandWrapperMetadata(
		component,
		islandId,
		wrapperKey
	);

	wrapperMetadataCache.set(wrapperKey, metadataPromise);

	return metadataPromise;
};

const extractAngularIslandRoot = (html: string, selector: string) => {
	const openTag = `<${selector}`;
	const start = html.indexOf(openTag);
	if (start < 0) {
		throw new Error(`Could not find Angular island root "${selector}".`);
	}

	const endTag = `</${selector}>`;
	const end = html.indexOf(endTag, start);
	if (end < 0) {
		throw new Error(`Could not close Angular island root "${selector}".`);
	}

	return html.slice(start, end + endTag.length);
};

export const mountAngularIsland = async <Props extends Record<string, unknown>>(
	component: import('@angular/core').Type<object>,
	element: HTMLElement,
	props: Props,
	islandId: string
) => {
	await import('@angular/compiler');
	const { createComponent, inputBinding } = await import('@angular/core');
	const selector = getAngularIslandSelector(islandId);
	const { app, environmentInjector } = await getAngularIslandApp();

	let rootElement = element.querySelector(selector);
	if (!(rootElement instanceof HTMLElement)) {
		element.innerHTML = `<${selector}></${selector}>`;
		rootElement = element.querySelector(selector);
	}
	if (!(rootElement instanceof HTMLElement)) return app;

	const componentSelector =
		getClientAngularComponentSelector(component) ??
		getSelectorFromRenderedIsland(rootElement);
	if (!componentSelector) return app;

	rootElement.innerHTML = `<${componentSelector}></${componentSelector}>`;
	const hostElement = rootElement.querySelector(componentSelector);
	if (!(hostElement instanceof HTMLElement)) return app;

	const bindings = Object.entries(props).map(([key, value]) =>
		inputBinding(key, () => value)
	);
	const componentRef = createComponent(component, {
		bindings,
		environmentInjector,
		hostElement
	});
	app.attachView(componentRef.hostView);
	componentRef.changeDetectorRef.detectChanges();
	window.__ABS_ANGULAR_ISLAND_APPS__ ??= [];
	window.__ABS_ANGULAR_ISLAND_APPS__.push(app);

	return app;
};
export const renderAngularIslandToHtml = async <
	Props extends Record<string, unknown>
>(
	component: import('@angular/core').Type<object>,
	props: Props,
	islandId: string
) => {
	const requestCache = getRequestRenderCache();
	const renderCacheKey = getIslandRenderCacheKey(component, props);
	const cachedHtml = requestCache?.get(renderCacheKey);
	if (cachedHtml) {
		return cachedHtml;
	}

	const { deps, propsToken, selector, WrapperComponent } =
		await createAngularIslandWrapper(component, islandId);

	const providers: (
		| import('@angular/core').Provider
		| import('@angular/core').EnvironmentProviders
	)[] = [
		deps.provideServerRendering(),
		deps.provideZonelessChangeDetection(),
		{ provide: deps.APP_BASE_HREF, useValue: '/' },
		{ provide: propsToken, useValue: props }
	];
	const document = `<!DOCTYPE html><html><body><${selector}></${selector}></body></html>`;
	const html = await withSuppressedAngularDevLogs(() =>
		deps.renderApplication(
			(context) =>
				deps.bootstrapApplication(
					WrapperComponent,
					{ providers },
					context
				),
			{
				document,
				platformProviders: [],
				url: '/'
			}
		)
	);
	const islandHtml = extractAngularIslandRoot(html, selector);
	requestCache?.set(renderCacheKey, islandHtml);

	return islandHtml;
};
