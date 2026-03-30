import { resolveAngularPackage } from './resolveAngularPackage';

// Patches Angular SSR's DominoAdapter to guard against null doc.head

const ensureHead = (doc: Document) => {
	if (!doc || doc.head || !doc.documentElement) {
		return;
	}

	const head = doc.createElement('head');
	doc.documentElement.insertBefore(head, doc.documentElement.firstChild);
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
};
