// Patches Angular SSR's DominoAdapter to guard against null doc.head
// Must be imported before any Angular SSR modules are used (top-level await)

const insertHead = (doc: Document) => {
	const head = doc.createElement('head');
	if (!doc.documentElement) {
		return;
	}

	doc.documentElement.insertBefore(head, doc.documentElement.firstChild);
};

const ensureHead = (doc: Document) => {
	if (!doc || doc.head) {
		return;
	}

	try {
		insertHead(doc);
	} catch {
		// head creation failed, getBaseHref guard will handle it
	}
};

export const patchesApplied = (async () => {
	try {
		const { ɵDominoAdapter } = await import('@angular/platform-server');
		if (!ɵDominoAdapter?.prototype) {
			console.warn(
				'[Angular Patch] ɵDominoAdapter not found, skipping patches'
			);

			return false;
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

			return doc;
		};

		const origGetDefaultDocument = proto.getDefaultDocument;
		proto.getDefaultDocument = function () {
			const doc = origGetDefaultDocument.call(this);
			ensureHead(doc);

			return doc;
		};

		return true;
	} catch (error) {
		console.warn('[Angular Patch] Failed to apply patches:', error);

		return false;
	}
})();

