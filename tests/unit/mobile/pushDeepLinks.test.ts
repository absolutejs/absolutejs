import { describe, expect, test } from 'bun:test';
import type { DevicePushNotificationAction } from '@absolutejs/devices';
import { installAbsoluteMobilePushDeepLinks } from '../../../src/mobile/pushDeepLinks';
import {
	resolveAbsoluteMobileDeepLink,
	type AbsoluteMobileClientManifest
} from '../../../src/mobile/transport';

const manifest: Pick<
	AbsoluteMobileClientManifest,
	'deepLinkHosts' | 'deepLinkScheme' | 'deviceCapabilities'
> = {
	deepLinkHosts: ['app.example.com'],
	deepLinkScheme: 'exampleapp',
	deviceCapabilities: ['pushNotifications']
};

const action = (
	data: Record<string, unknown>,
	actionId = 'tap'
): DevicePushNotificationAction => ({
	actionId,
	notification: { data, id: 'notification-1' }
});

const harness = async (capabilities = manifest.deviceCapabilities) => {
	const opened: string[] = [];
	let listener: ((value: DevicePushNotificationAction) => void) | undefined;
	const subscription = await installAbsoluteMobilePushDeepLinks(
		{ deviceCapabilities: capabilities },
		(url) => {
			// The shell's own route: rejects anything outside the app's URLs.
			opened.push(
				resolveAbsoluteMobileDeepLink(
					{ ...manifest, deviceCapabilities: capabilities } as never,
					url
				)
			);
		},
		{
			onAction: async (next) => {
				listener = next;

				return () => undefined;
			}
		}
	);

	return {
		opened,
		subscribed: subscription !== undefined,
		tap: (value: DevicePushNotificationAction) => listener?.(value)
	};
};

describe('push notification deep links', () => {
	test('opens a tapped notification’s link inside the app', async () => {
		const push = await harness();
		push.tap(
			action({
				absoluteDeepLink: 'https://app.example.com/orders/42?tab=items'
			})
		);
		push.tap(action({ absoluteDeepLink: 'exampleapp:///inbox' }));

		expect(push.opened).toEqual(['/orders/42?tab=items', '/inbox']);
	});

	test('ignores links outside the configured hosts and scheme', async () => {
		const push = await harness();
		push.tap(
			action({ absoluteDeepLink: 'https://evil.example.net/phish' })
		);
		push.tap(
			action({ absoluteDeepLink: 'http://app.example.com/insecure' })
		);
		push.tap(action({ absoluteDeepLink: 'not a url' }));
		push.tap(
			action({ absoluteDeepLink: 'https://user:pass@app.example.com/' })
		);

		expect(push.opened).toEqual([]);
	});

	test('leaves action buttons and notifications without a link alone', async () => {
		const push = await harness();
		push.tap(
			action({ absoluteDeepLink: 'https://app.example.com/a' }, 'reply')
		);
		push.tap(action({}));
		push.tap(action({ absoluteDeepLink: 42 }));

		expect(push.opened).toEqual([]);
	});

	test('does nothing when the app does not use push', async () => {
		const push = await harness(['camera']);

		expect(push.subscribed).toBe(false);
	});
});
