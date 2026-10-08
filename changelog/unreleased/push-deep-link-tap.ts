import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "A push sent with `deepLink` carried it to the device as `absoluteDeepLink`, but tapping the notification only opened the app. Tapping it now opens that page inside the app, in Capacitor and Expo apps alike. The link takes the same route as any other deep link, so only the app's configured HTTPS hosts and its URL scheme are opened; anything else is ignored. Action buttons other than the notification body are still left to the app's own `pushNotifications.onAction` listener.",
	kind: 'added',
	summary: 'Tapping a push notification opens its deepLink inside the app'
};
