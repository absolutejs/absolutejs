import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "Mobile builds now install `@absolutejs/devices` 0.7.1 and Expo builds `@absolutejs/devices-expo` 0.0.12. On Expo, tapping a notification while the app is closed now reaches `pushNotifications.onAction`, so the notification's deep link opens; before, a tap that launched the app was reported before anything listened and was lost. `@absolutejs/devices/testing` gains a push notifications test capability. Run `absolute mobile sync` to update an existing app.",
	kind: 'fixed',
	summary:
		'Tapping a notification that launches an Expo app now opens its deep link'
};
