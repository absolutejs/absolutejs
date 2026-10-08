import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "An app that uses push notifications is built with the `development` push environment so debug builds sign, and App Store export is expected to switch it to `production` through the distribution profile. If it does not, Apple rejects every installed device's push token and no user receives push, with nothing to show for it. `absolute mobile build ios` now reads the entitlements signed into the exported IPA and fails, explaining the fix, unless `aps-environment` is `production`. Apps that do not use push are not inspected.",
	kind: 'added',
	summary:
		'iOS release builds check that a push app is signed for production push'
};
