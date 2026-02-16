/* Head element patching for HMR updates (title, meta, favicon, etc.) */

function getHeadElementKey(el: Element): string | null {
	const tag = el.tagName.toLowerCase();

	if (tag === 'title') return 'title';
	if (tag === 'meta' && el.hasAttribute('charset')) return 'meta:charset';
	if (tag === 'meta' && el.hasAttribute('name'))
		return 'meta:name:' + el.getAttribute('name');
	if (tag === 'meta' && el.hasAttribute('property'))
		return 'meta:property:' + el.getAttribute('property');
	if (tag === 'meta' && el.hasAttribute('http-equiv'))
		return 'meta:http-equiv:' + el.getAttribute('http-equiv');

	if (tag === 'link') {
		const rel = (el.getAttribute('rel') || '').toLowerCase();
		if (
			rel === 'icon' ||
			rel === 'shortcut icon' ||
			rel === 'apple-touch-icon'
		)
			return 'link:icon:' + rel;
		if (rel === 'stylesheet') return null;
		if (rel === 'preconnect')
			return 'link:preconnect:' + (el.getAttribute('href') || '');
		if (rel === 'preload')
			return 'link:preload:' + (el.getAttribute('href') || '');
		if (rel === 'canonical') return 'link:canonical';
		if (rel === 'dns-prefetch')
			return 'link:dns-prefetch:' + (el.getAttribute('href') || '');
	}

	if (tag === 'script' && el.hasAttribute('data-hmr-id'))
		return 'script:hmr:' + el.getAttribute('data-hmr-id');
	if (tag === 'script') return null;
	if (tag === 'base') return 'base';

	return null;
}

function shouldPreserveElement(el: Element): boolean {
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
}

function updateHeadElement(oldEl: Element, newEl: Element, key: string): void {
	const tag = oldEl.tagName.toLowerCase();

	if (tag === 'title') {
		const newTitle = newEl.textContent || '';
		if (oldEl.textContent !== newTitle) {
			oldEl.textContent = newTitle;
			document.title = newTitle;
			console.log('[HMR] Updated title to:', newTitle);
		}
		return;
	}

	if (tag === 'meta') {
		const newContent = newEl.getAttribute('content');
		const oldContent = oldEl.getAttribute('content');
		if (oldContent !== newContent && newContent !== null) {
			oldEl.setAttribute('content', newContent);
			console.log('[HMR] Updated meta', key, 'to:', newContent);
		}
		if (newEl.hasAttribute('charset')) {
			const newCharset = newEl.getAttribute('charset');
			if (oldEl.getAttribute('charset') !== newCharset) {
				oldEl.setAttribute('charset', newCharset!);
			}
		}
		return;
	}

	if (tag === 'link') {
		const rel = (oldEl.getAttribute('rel') || '').toLowerCase();
		const newHref = newEl.getAttribute('href');
		const oldHref = oldEl.getAttribute('href');

		if (
			rel === 'icon' ||
			rel === 'shortcut icon' ||
			rel === 'apple-touch-icon'
		) {
			if (newHref && oldHref) {
				const oldBase = oldHref.split('?')[0];
				const newBase = newHref.split('?')[0];
				if (oldBase !== newBase) {
					const cacheBustedHref =
						newHref +
						(newHref.includes('?') ? '&' : '?') +
						't=' +
						Date.now();
					oldEl.setAttribute('href', cacheBustedHref);
					console.log('[HMR] Updated favicon to:', newBase);
				}
			}
		} else if (newHref && oldHref !== newHref) {
			oldEl.setAttribute('href', newHref);
			console.log('[HMR] Updated link', rel, 'to:', newHref);
		}

		const attrsToCheck = ['type', 'sizes', 'crossorigin', 'as', 'media'];
		attrsToCheck.forEach(function (attr) {
			const newVal = newEl.getAttribute(attr);
			const oldVal = oldEl.getAttribute(attr);
			if (newVal !== null && oldVal !== newVal) {
				oldEl.setAttribute(attr, newVal);
			} else if (newVal === null && oldVal !== null) {
				oldEl.removeAttribute(attr);
			}
		});
		return;
	}

	if (tag === 'base') {
		const newHref = newEl.getAttribute('href');
		const newTarget = newEl.getAttribute('target');
		if (newHref && oldEl.getAttribute('href') !== newHref) {
			oldEl.setAttribute('href', newHref);
		}
		if (newTarget && oldEl.getAttribute('target') !== newTarget) {
			oldEl.setAttribute('target', newTarget);
		}
		return;
	}
}

function addHeadElement(newEl: Element, key: string): void {
	const clone = newEl.cloneNode(true) as Element;
	clone.setAttribute('data-hmr-source', 'patched');

	const tag = newEl.tagName.toLowerCase();
	const head = document.head;
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
	console.log('[HMR] Added head element:', key);
}

export function patchHeadInPlace(newHeadHTML: string): void {
	if (!newHeadHTML) return;

	const tempDiv = document.createElement('div');
	tempDiv.innerHTML = newHeadHTML;

	const existingMap = new Map<string, Element>();
	const newMap = new Map<string, Element>();

	Array.from(document.head.children).forEach(function (el) {
		if (shouldPreserveElement(el)) return;
		const key = getHeadElementKey(el);
		if (key) {
			existingMap.set(key, el);
		}
	});

	Array.from(tempDiv.children).forEach(function (el) {
		const key = getHeadElementKey(el);
		if (key) {
			newMap.set(key, el);
		}
	});

	newMap.forEach(function (newEl, key) {
		const existingEl = existingMap.get(key);
		if (existingEl) {
			updateHeadElement(existingEl, newEl, key);
		} else {
			addHeadElement(newEl, key);
		}
	});

	existingMap.forEach(function (existingEl, key) {
		if (!newMap.has(key)) {
			if (!shouldPreserveElement(existingEl)) {
				const tag = existingEl.tagName.toLowerCase();
				const rel = existingEl.getAttribute('rel') || '';
				if (tag === 'link' && rel === 'stylesheet') return;
				existingEl.remove();
				console.log('[HMR] Removed head element:', key);
			}
		}
	});
}
