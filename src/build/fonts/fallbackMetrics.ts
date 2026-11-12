import type { FontFallbackCategory, FontMetrics } from '../../../types/fonts';

type SystemFallback = { local: string[]; metrics: FontMetrics };

/* Measured from the system fonts with parseFontMetrics, so their average
 * width uses the same letter weighting as the web fonts they stand in for. */
const SYSTEM_FALLBACKS: Record<FontFallbackCategory, SystemFallback> = {
	monospace: {
		local: ['Courier New', 'CourierNewPSMT'],
		metrics: {
			ascent: 1705,
			averageWidth: 1229,
			descent: -615,
			lineGap: 0,
			unitsPerEm: 2048
		}
	},
	'sans-serif': {
		local: ['Arial', 'ArialMT'],
		metrics: {
			ascent: 1854,
			averageWidth: 915.53,
			descent: -434,
			lineGap: 67,
			unitsPerEm: 2048
		}
	},
	serif: {
		local: ['Times New Roman', 'TimesNewRomanPSMT'],
		metrics: {
			ascent: 1825,
			averageWidth: 829.78,
			descent: -443,
			lineGap: 87,
			unitsPerEm: 2048
		}
	}
};

export const inferFallbackCategory = (family: string) => {
	if (/\b(mono|code)\b|mono$/i.test(family)) return 'monospace';
	if (/serif/i.test(family) && !/sans/i.test(family)) return 'serif';

	return 'sans-serif';
};

const PERCENT = 100;
const PRECISION = 100;

const percent = (value: number) =>
	`${Math.round(value * PERCENT * PRECISION) / PRECISION}%`;

/** The overrides that make the system fallback occupy the same space as the
 *  web font: `size-adjust` matches average character width, and the
 *  ascent/descent/line-gap overrides (which apply after size-adjust) match
 *  the web font's vertical metrics. */
export const computeFallbackOverrides = (
	metrics: FontMetrics,
	category: FontFallbackCategory
) => {
	const fallback = SYSTEM_FALLBACKS[category];
	const fontWidth = metrics.averageWidth / metrics.unitsPerEm;
	const fallbackWidth =
		fallback.metrics.averageWidth / fallback.metrics.unitsPerEm;
	const sizeAdjust = fontWidth > 0 ? fontWidth / fallbackWidth : 1;
	const scale = metrics.unitsPerEm * sizeAdjust;

	return {
		ascentOverride: percent(metrics.ascent / scale),
		descentOverride: percent(Math.abs(metrics.descent) / scale),
		lineGapOverride: percent(metrics.lineGap / scale),
		local: fallback.local,
		sizeAdjust: percent(sizeAdjust)
	};
};
