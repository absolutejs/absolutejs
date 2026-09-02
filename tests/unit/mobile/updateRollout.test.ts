import { describe, expect, test } from 'bun:test';
import {
	isAbsoluteMobileUpdateRolloutMember,
	parseAbsoluteMobileUpdateRequest,
	type AbsoluteMobileUpdateRolloutOptions
} from '../../../src/mobile/updateRollout';

describe('mobile update rollout', () => {
	test('parses the anonymous update identity and assigns a stable cohort', () => {
		const identity = parseAbsoluteMobileUpdateRequest(
			new Request('https://updates.example.com/update.json', {
				headers: {
					'x-absolute-mobile-app': 'com.example.absolute',
					'x-absolute-mobile-channel': 'production',
					'x-absolute-mobile-installation':
						'11111111-1111-4111-8111-111111111111',
					'x-absolute-mobile-release': 'embedded:build-1',
					'x-absolute-mobile-runtime': 'a'.repeat(64)
				}
			})
		);
		const options: AbsoluteMobileUpdateRolloutOptions = {
			...identity,
			releaseId: `amu_${'b'.repeat(64)}`,
			rollout: 0.5
		};

		expect(isAbsoluteMobileUpdateRolloutMember(options)).toBe(
			isAbsoluteMobileUpdateRolloutMember(options)
		);
		expect(
			isAbsoluteMobileUpdateRolloutMember({ ...options, rollout: 0 })
		).toBe(false);
		expect(
			isAbsoluteMobileUpdateRolloutMember({ ...options, rollout: 1 })
		).toBe(true);
	});

	test('rejects user identifiers and malformed runtime values at the boundary', () => {
		expect(() =>
			parseAbsoluteMobileUpdateRequest(
				new Request('https://updates.example.com/update.json', {
					headers: {
						'x-absolute-mobile-app': 'com.example.absolute',
						'x-absolute-mobile-channel': 'production',
						'x-absolute-mobile-installation': 'user@example.com',
						'x-absolute-mobile-release': 'embedded:build-1',
						'x-absolute-mobile-runtime': 'bad'
					}
				})
			)
		).toThrow('installation identity');
	});
});
