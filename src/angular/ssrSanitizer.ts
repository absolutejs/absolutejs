import type { AngularDeps } from '../../types/angular';

const escapeHtml = (str: string) =>
	String(str)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');

const bypassValue = (value: string) =>
	({ changingThisBreaksApplicationSecurity: value }) as any;

// Deferred: SsrSanitizer class is built after deps load because it
// extends DomSanitizer which comes from the lazy import. We cache the
// class + singleton instance after the first request.
let ssrSanitizer: any = null;

export const resetSsrSanitizer = () => {
	ssrSanitizer = null;
};

export const getSsrSanitizer = (deps: AngularDeps) => {
	if (ssrSanitizer) return ssrSanitizer;

	const SsrSanitizerClass = class extends deps.DomSanitizer {
		sanitize(ctx: any, value: any) {
			if (value == null) return null;
			let strValue: string;
			if (typeof value === 'string') {
				strValue = value;
			} else if (
				typeof value === 'object' &&
				'changingThisBreaksApplicationSecurity' in value
			) {
				strValue = String(value.changingThisBreaksApplicationSecurity);
			} else {
				strValue = String(value);
			}

			if (ctx === deps.SecurityContext?.HTML || ctx === 1) {
				return escapeHtml(strValue);
			}

			return strValue;
		}
		bypassSecurityTrustHtml(value: string) {
			return bypassValue(escapeHtml(value));
		}
		bypassSecurityTrustStyle(value: string) {
			return bypassValue(value);
		}
		bypassSecurityTrustScript(value: string) {
			return bypassValue(value);
		}
		bypassSecurityTrustUrl(value: string) {
			return bypassValue(value);
		}
		bypassSecurityTrustResourceUrl(value: string) {
			return bypassValue(value);
		}
	};

	ssrSanitizer = new SsrSanitizerClass();

	return ssrSanitizer;
};
