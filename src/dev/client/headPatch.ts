/* Head element patching for HMR updates (title, meta, favicon, etc.) */

const getLinkElementKey = (el: Element) => {
	const rel = (el.getAttribute('rel') || '').toLowerCase();
	if (rel === 'icon' || rel === 'shortcut icon' || rel === 'apple-touch-icon')
		return `link:icon:${rel}`;
	if (rel === 'stylesheet') return null;
	if (rel === 'preconnect')
		return `link:preconnect:${el.getAttribute('href') || ''}`;
	if (rel === 'preload')
		return `link:preload:${el.getAttribute('href') || ''}`;
	if (rel === 'canonical') return 'link:canonical';
	if (rel === 'dns-prefetch')
		return `link:dns-prefetch:${el.getAttribute('href') || ''}`;

	return null;
};

const getHeadElementKey = (el: Element) => {
	const tag = el.tagName.toLowerCase();

	if (tag === 'title') return 'title';
	if (tag === 'meta' && el.hasAttribute('charset')) return 'meta:charset';
	if (tag === 'meta' && el.hasAttribute('name'))
		return `meta:name:${el.getAttribute('name')}`;
	if (tag === 'meta' && el.hasAttribute('property'))
		return `meta:property:${el.getAttribute('property')}`;
	if (tag === 'meta' && el.hasAttribute('http-equiv'))
		return `meta:http-equiv:${el.getAttribute('http-equiv')}`;

	if (tag === 'link') return getLinkElementKey(el);

	if (tag === 'script' && el.hasAttribute('data-hmr-id'))
		return `script:hmr:${el.getAttribute('data-hmr-id')}`;
	if (tag === 'script') return null;
	if (tag === 'base') return 'base';

	return null;
};

const shouldPreserveElement = (el: Element) => {
	if (el.hasAttribute('data-hmr-import-map')) return true;
	if (el.hasAttribute('data-hmr-client')) return true;
	if (el.hasAttribute('data-react-refresh-setup')) return true;

	const attrs = Array.from(el.attributes);
	for (let idx = 0; idx < attrs.length; idx++) {
		if (attrs[idx]!.name.startsWith('data-hmr-')) return true;
	}

	if (el.tagName === 'SCRIPT') {
		const src = el.getAttribute('src') || '';
		if (src.includes('htmx.min.js') || src.includes('htmx.js')) return true;
	}

	return false;
};

const updateTitleElement = (oldEl: Element, newEl: Element) => {
	const newTitle = newEl.textContent || '';
	if (oldEl.textContent === newTitle) return;
	oldEl.textContent = newTitle;
	document.title = newTitle;
};

const updateMetaElement = (oldEl: Element, newEl: Element) => {
	const newContent = newEl.getAttribute('content');
	const oldContent = oldEl.getAttribute('content');
	if (oldContent !== newContent && newContent !== null) {
		oldEl.setAttribute('content', newContent);
	}
	if (!newEl.hasAttribute('charset')) return;
	const newCharset = newEl.getAttribute('charset');
	if (oldEl.getAttribute('charset') !== newCharset) {
		oldEl.setAttribute('charset', newCharset!);
	}
};

const updateFaviconHref = (
	oldEl: Element,
	newHref: string,
	oldHref: string
) => {
	const oldBase = oldHref.split('?')[0];
	const newBase = newHref.split('?')[0];
	if (oldBase === newBase) return;
	const cacheBustedHref = `${
		newHref + (newHref.includes('?') ? '&' : '?')
	}t=${Date.now()}`;
	oldEl.setAttribute('href', cacheBustedHref);
};

const updateLinkElement = (oldEl: Element, newEl: Element) => {
	const rel = (oldEl.getAttribute('rel') || '').toLowerCase();
	const newHref = newEl.getAttribute('href');
	const oldHref = oldEl.getAttribute('href');

	const isIcon =
		rel === 'icon' || rel === 'shortcut icon' || rel === 'apple-touch-icon';

	if (isIcon && newHref && oldHref) {
		updateFaviconHref(oldEl, newHref, oldHref);
	} else if (!isIcon && newHref && oldHref !== newHref) {
		oldEl.setAttribute('href', newHref);
	}

	const attrsToCheck = ['type', 'sizes', 'crossorigin', 'as', 'media'];
	attrsToCheck.forEach((attr) => {
		const newVal = newEl.getAttribute(attr);
		const oldVal = oldEl.getAttribute(attr);
		if (newVal !== null && oldVal !== newVal) {
			oldEl.setAttribute(attr, newVal);
		} else if (newVal === null && oldVal !== null) {
			oldEl.removeAttribute(attr);
		}
	});
};

const updateBaseElement = (oldEl: Element, newEl: Element) => {
	const newHref = newEl.getAttribute('href');
	const newTarget = newEl.getAttribute('target');
	if (newHref && oldEl.getAttribute('href') !== newHref) {
		oldEl.setAttribute('href', newHref);
	}
	if (newTarget && oldEl.getAttribute('target') !== newTarget) {
		oldEl.setAttribute('target', newTarget);
	}
};

const updateHeadElement = (oldEl: Element, newEl: Element, key: string) => {
	const tag = oldEl.tagName.toLowerCase();

	if (tag === 'title') {
		updateTitleElement(oldEl, newEl);

		return;
	}

	if (tag === 'meta') {
		updateMetaElement(oldEl, newEl);

		return;
	}

	if (tag === 'link') {
		updateLinkElement(oldEl, newEl);

		return;
	}

	if (tag === 'base') {
		updateBaseElement(oldEl, newEl);
	}
};

const addHeadElement = (newEl: Element, key: string) => {
	const clone = newEl.cloneNode(true) as Element;
	clone.setAttribute('data-hmr-source', 'patched');

	const tag = newEl.tagName.toLowerCase();
	const { head } = document;
	let insertBefore: Node | null = null;

	if (tag === 'title') {
		insertBefore = head.firstChild;
	} else if (tag === 'meta') {
		const firstLink = head.querySelector('link');
		const firstScript = head.querySelector('script');
		insertBefore = firstLink || firstScript;
	} else if (tag === 'link') {
		const firstScript = head.querySelector('script');
		insertBefore = firstScript;
	}

	if (insertBefore) {
		head.insertBefore(clone, insertBefore);
	} else {
		head.appendChild(clone);
	}
};

const removeStaleElement = (existingEl: Element) => {
	if (shouldPreserveElement(existingEl)) return;
	const tag = existingEl.tagName.toLowerCase();
	const rel = existingEl.getAttribute('rel') || '';
	if (tag === 'link' && rel === 'stylesheet') return;
	existingEl.remove();
};

export const patchHeadInPlace = (newHeadHTML: string) => {
	if (!newHeadHTML) return;

	const tempDiv = document.createElement('div');
	tempDiv.innerHTML = newHeadHTML;

	const existingMap = new Map<string, Element>();
	const newMap = new Map<string, Element>();

	Array.from(document.head.children).forEach((el) => {
		if (shouldPreserveElement(el)) return;
		const key = getHeadElementKey(el);
		if (key) {
			existingMap.set(key, el);
		}
	});

	Array.from(tempDiv.children).forEach((el) => {
		const key = getHeadElementKey(el);
		if (key) {
			newMap.set(key, el);
		}
	});

	newMap.forEach((newEl, key) => {
		const existingEl = existingMap.get(key);
		if (existingEl) {
			updateHeadElement(existingEl, newEl, key);
		} else {
			addHeadElement(newEl, key);
		}
	});

	existingMap.forEach((existingEl, key) => {
		if (!newMap.has(key)) {
			removeStaleElement(existingEl);
		}
	});
};
