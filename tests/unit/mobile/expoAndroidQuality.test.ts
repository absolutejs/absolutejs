import { describe, expect, test } from 'bun:test';
import {
	absoluteAndroidNodeLabel,
	absoluteAndroidTouchTargetDp,
	absolutePercentile,
	absolutePssMiB,
	parseAbsoluteAndroidAccessibilityHierarchy,
	parseAbsoluteExpoAndroidLaunchTiming,
	parseAbsoluteExpoAndroidMemory
} from '../../../src/mobile/expoAndroidQuality';

describe('Expo Android quality measurements', () => {
	test('parses Android launch and memory output without device identifiers', () => {
		expect(
			parseAbsoluteExpoAndroidLaunchTiming(`Status: ok
LaunchState: COLD
ThisTime: 412
TotalTime: 527
WaitTime: 544`)
		).toEqual({
			launchState: 'COLD',
			thisTimeMs: 412,
			totalTimeMs: 527,
			waitTimeMs: 544
		});
		expect(
			parseAbsoluteExpoAndroidMemory(' App Summary\n TOTAL PSS: 245760')
		).toEqual({ totalPssKiB: 245_760 });
		expect(absolutePssMiB({ totalPssKiB: 245_760 })).toBe(240);
		expect(
			parseAbsoluteExpoAndroidLaunchTiming(`Status: ok
LaunchState: WARM
TotalTime: 91
WaitTime: 99`)
		).toEqual({
			launchState: 'WARM',
			thisTimeMs: undefined,
			totalTimeMs: 91,
			waitTimeMs: 99
		});
	});

	test('parses labels and density-normalized touch bounds from UIAutomator', () => {
		const [node] = parseAbsoluteAndroidAccessibilityHierarchy(
			'<hierarchy><node text="" class="android.widget.Button" package="com.example" content-desc="Save &amp; close" clickable="true" enabled="true" visible-to-user="true" bounds="[20,40][212,232]" /></hierarchy>'
		);
		expect(node).toBeDefined();
		if (!node) return;
		expect(absoluteAndroidNodeLabel(node)).toBe('Save & close');
		expect(absoluteAndroidTouchTargetDp(node, 4)).toEqual({
			height: 48,
			width: 48
		});
	});

	test('calculates a nearest-rank percentile deterministically', () => {
		expect(absolutePercentile([40, 10, 30, 20], 0.95)).toBe(40);
		expect(absolutePercentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
		expect(() => absolutePercentile([], 0.95)).toThrow();
	});
});
