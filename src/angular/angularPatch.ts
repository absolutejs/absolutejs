// Patches Angular SSR's DominoAdapter to guard against null doc.head
// Must be imported before any Angular SSR modules are used (top-level await)

// Minimal passthrough kept for type compatibility with pageHandlers.ts
export const createDocumentProxy = (doc: any): any => doc;

const patchesApplied = (async () => {
	try {
		const platformServer = await import('@angular/platform-server');

		// Angular exports DominoAdapter as ɵDominoAdapter
		const DominoAdapter = (platformServer as any).ɵDominoAdapter;
		if (!DominoAdapter?.prototype) {
			console.warn(
				'[Angular Patch] ɵDominoAdapter not found, skipping patches'
			);

			return false;
		}

		const proto = DominoAdapter.prototype;

		// Patch getBaseHref — the primary crash site
		if (proto.getBaseHref && !proto.__abs_origGetBaseHref) {
			proto.__abs_origGetBaseHref = proto.getBaseHref;
			proto.getBaseHref = function (doc: any) {
				if (
					!doc ||
					!doc.head ||
					typeof doc.head.children === 'undefined'
				) {
					return '';
				}

				return proto.__abs_origGetBaseHref.call(this, doc);
			};
		}

		// Patch createHtmlDocument — ensure created docs have a valid head
		if (
			proto.createHtmlDocument &&
			!proto.__abs_origCreateHtmlDocument
		) {
			proto.__abs_origCreateHtmlDocument =
				proto.createHtmlDocument;
			proto.createHtmlDocument = function () {
				const doc =
					proto.__abs_origCreateHtmlDocument.call(this);
				if (doc && !doc.head) {
					try {
						const head = doc.createElement('head');
						if (doc.documentElement) {
							doc.documentElement.insertBefore(
								head,
								doc.documentElement.firstChild
							);
						}
					} catch {
						// head creation failed, getBaseHref guard will handle it
					}
				}

				return doc;
			};
		}

		// Patch getDefaultDocument — same guard
		if (
			proto.getDefaultDocument &&
			!proto.__abs_origGetDefaultDocument
		) {
			proto.__abs_origGetDefaultDocument =
				proto.getDefaultDocument;
			proto.getDefaultDocument = function () {
				const doc =
					proto.__abs_origGetDefaultDocument.call(this);
				if (doc && !doc.head) {
					try {
						const head = doc.createElement('head');
						if (doc.documentElement) {
							doc.documentElement.insertBefore(
								head,
								doc.documentElement.firstChild
							);
						}
					} catch {
						// head creation failed, getBaseHref guard will handle it
					}
				}

				return doc;
			};
		}

		return true;
	} catch (error) {
		console.warn(
			'[Angular Patch] Failed to apply patches:',
			error
		);

		return false;
	}
})();

export default patchesApplied;
