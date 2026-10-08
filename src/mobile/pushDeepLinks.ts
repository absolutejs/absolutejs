import {
	pushNotifications,
	type DevicePushNotificationAction,
	type DeviceSubscription
} from '@absolutejs/devices';
import type { AbsoluteMobileClientManifest } from './transport';

/** Data key under which Dispatch's APNs and FCM adapters carry `deepLink`. */
export const ABSOLUTE_PUSH_DEEP_LINK_KEY = 'absoluteDeepLink';

type PushActionSource = {
	onAction: (
		listener: (action: DevicePushNotificationAction) => void
	) => Promise<DeviceSubscription>;
};

/**
 * Opens a tapped notification's deep link inside the app. The link goes
 * through `openDeepLink`, the shell's own validated deep-link route, so a
 * link outside the configured hosts and scheme is ignored rather than
 * followed. Action buttons other than the notification body are left to the
 * application.
 */
export const installAbsoluteMobilePushDeepLinks = async (
	manifest: Pick<AbsoluteMobileClientManifest, 'deviceCapabilities'>,
	openDeepLink: (url: string) => void,
	source: PushActionSource = pushNotifications
) => {
	if (!manifest.deviceCapabilities.includes('pushNotifications'))
		return undefined;

	return source.onAction(({ actionId, notification }) => {
		if (actionId !== 'tap') return;
		const link = notification.data[ABSOLUTE_PUSH_DEEP_LINK_KEY];
		if (typeof link !== 'string' || link.length === 0) return;
		try {
			openDeepLink(link);
		} catch {
			// Outside the app's configured URLs, or not a URL: not ours to open.
		}
	});
};
