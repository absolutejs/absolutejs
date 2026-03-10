// Patches Angular SSR's DominoAdapter to guard against null doc.head
// Must be imported before any Angular SSR modules are used (top-level await)

const insertHead = (doc: any) => {
	const head = doc.createElement('head');
	if (!doc.documentElement) {
		return;
	}

	doc.documentElement.insertBefore(head, doc.documentElement.firstChild);
};

const ensureHead = (doc: any) => {
	if (!doc || doc.head) {
		return;
	}

	try {
		insertHead(doc);
	} catch {
		// head creation failed, getBaseHref guard will handle it
	}
};

const patchGetBaseHref = (proto: any) => {
	if (!proto.getBaseHref || proto.__abs_origGetBaseHref) {
		return;
	}

	proto.__abs_origGetBaseHref = proto.getBaseHref;
	proto.getBaseHref = function (doc: any) {
		if (!doc || !doc.head || typeof doc.head.children === 'undefined') {
			return '';
		}

		return proto.__abs_origGetBaseHref.call(this, doc);
	};
};

const patchCreateHtmlDocument = (proto: any) => {
	if (!proto.createHtmlDocument || proto.__abs_origCreateHtmlDocument) {
		return;
	}

	proto.__abs_origCreateHtmlDocument = proto.createHtmlDocument;
	proto.createHtmlDocument = function () {
		const doc = proto.__abs_origCreateHtmlDocument.call(this);
		ensureHead(doc);

		return doc;
	};
};

const patchGetDefaultDocument = (proto: any) => {
	if (!proto.getDefaultDocument || proto.__abs_origGetDefaultDocument) {
		return;
	}

	proto.__abs_origGetDefaultDocument = proto.getDefaultDocument;
	proto.getDefaultDocument = function () {
		const doc = proto.__abs_origGetDefaultDocument.call(this);
		ensureHead(doc);

		return doc;
	};
};

const patchesApplied = (async () => {
	try {
		const platformServer = await import('@angular/platform-server');
		const DominoAdapter = (platformServer as any).ɵDominoAdapter;
		!DominoAdapter?.prototype &&
			console.warn(
				'[Angular Patch] ɵDominoAdapter not found, skipping patches'
			);
		if (!DominoAdapter?.prototype) {
			return false;
		}

		const proto = DominoAdapter.prototype;
		patchGetBaseHref(proto);
		patchCreateHtmlDocument(proto);
		patchGetDefaultDocument(proto);

		return true;
	} catch (error) {
		console.warn('[Angular Patch] Failed to apply patches:', error);

		return false;
	}
})();

export default patchesApplied;
