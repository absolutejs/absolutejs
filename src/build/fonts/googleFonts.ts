import type { FontFamilyConfig, FontStyle } from '../../../types/fonts';

export const GOOGLE_FONTS_CSS_ORIGIN = 'https://fonts.googleapis.com';
/* Google Fonts serves woff2 only to browsers it knows support it. */
export const GOOGLE_FONTS_USER_AGENT =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

export type GoogleFontFace = {
	family: string;
	style: FontStyle;
	subset: string;
	unicodeRange?: string;
	url: string;
	weight: string;
};

const DEFAULT_WEIGHTS = [400];
const DEFAULT_STYLES: FontStyle[] = ['normal'];

export const familyStyles = (family: FontFamilyConfig) =>
	family.styles && family.styles.length > 0 ? family.styles : DEFAULT_STYLES;

export const familyWeights = (family: FontFamilyConfig) => {
	const weights = family.weights ?? DEFAULT_WEIGHTS;

	return (Array.isArray(weights) ? weights : [weights]).map(String);
};

const compareAxisValues = (left: string, right: string) =>
	Number.parseFloat(left) - Number.parseFloat(right);

/** The css2 API URL for one family. Tuples must be sorted, italic last. */
export const googleFontsCssUrl = (
	family: FontFamilyConfig,
	display: string
) => {
	const weights = [...familyWeights(family)].sort(compareAxisValues);
	const styles = familyStyles(family);
	const name = family.family.trim().replace(/\s+/g, '+');
	const hasItalic = styles.includes('italic');
	const italicValues = [
		...(styles.includes('normal') ? ['0'] : []),
		...(hasItalic ? ['1'] : [])
	];
	const axes = hasItalic
		? `ital,wght@${italicValues
				.flatMap((italic) =>
					weights.map((weight) => `${italic},${weight}`)
				)
				.join(';')}`
		: `wght@${weights.join(';')}`;

	return `${GOOGLE_FONTS_CSS_ORIGIN}/css2?family=${name}:${axes}&display=${display}`;
};

const FACE_PATTERN = /\/\*\s*([^*]+?)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g;

const readDescriptor = (body: string, name: string) =>
	new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(body)?.[1]?.trim();

const parseFace = (subset: string, body: string) => {
	const url = /url\(\s*['"]?([^'")\s]+)['"]?\s*\)/.exec(body)?.[1];
	if (!url) return undefined;
	const face: GoogleFontFace = {
		family: (readDescriptor(body, 'font-family') ?? '').replace(
			/^['"]|['"]$/g,
			''
		),
		style:
			readDescriptor(body, 'font-style') === 'italic'
				? 'italic'
				: 'normal',
		subset,
		unicodeRange: readDescriptor(body, 'unicode-range'),
		url,
		weight: readDescriptor(body, 'font-weight') ?? '400'
	};

	return face;
};

/** Every `@font-face` in a css2 response, each tagged with the subset named
 *  in the comment Google puts before it. */
export const parseGoogleFontsCss = (css: string) =>
	Array.from(css.matchAll(FACE_PATTERN))
		.map(([, subset = '', body = '']) => parseFace(subset, body))
		.filter((face): face is GoogleFontFace => face !== undefined);
