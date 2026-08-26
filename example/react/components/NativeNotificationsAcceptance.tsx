import { localNotifications } from '@absolutejs/devices';
import { useEffect, useState } from 'react';

const TEST_NOTIFICATION_ID = 20_260_826;

const errorCode = (error: unknown) => {
	if (typeof error === 'object' && error !== null) {
		const code = Reflect.get(error, 'code');
		if (typeof code === 'string') return code;
	}

	return 'unknown';
};

export const NativeNotificationsAcceptance = () => {
	const [capability, setCapability] = useState('not-queried');
	const [detail, setDetail] = useState('Ready');
	const [error, setError] = useState('none');
	const [event, setEvent] = useState('none');
	const [pending, setPending] = useState('not-queried');
	const [permission, setPermission] = useState('not-queried');

	useEffect(() => {
		let active = true;
		const removers: Array<() => void | Promise<void>> = [];
		void Promise.all([
			localNotifications.onReceived((notification) => {
				if (active) setEvent(`received:${notification.id}`);
			}),
			localNotifications.onAction((action) => {
				if (active)
					setEvent(`${action.actionId}:${action.notification.id}`);
			})
		])
			.then((subscriptions) => removers.push(...subscriptions))
			.catch((caught) => {
				if (active) setError(errorCode(caught));
			});

		return () => {
			active = false;
			void Promise.all(removers.map((remove) => remove()));
		};
	}, []);

	const run = async (action: () => Promise<void>, success: string) => {
		try {
			await action();
			setDetail(success);
			setError('none');
		} catch (caught) {
			setDetail(`${success} failed`);
			setError(errorCode(caught));
		}
	};

	return (
		<main>
			<h1>AbsoluteJS Local Notifications</h1>
			<p id="notifications-detail">{detail}</p>
			<dl id="notifications-status">
				<dt>Capability</dt>
				<dd data-capability={capability}>{capability}</dd>
				<dt>Permission</dt>
				<dd data-permission={permission}>{permission}</dd>
				<dt>Pending</dt>
				<dd data-pending={pending}>{pending}</dd>
				<dt>Last event</dt>
				<dd data-event={event}>{event}</dd>
				<dt>Error</dt>
				<dd data-error={error}>{error}</dd>
			</dl>
			<button
				id="notifications-query"
				onClick={() =>
					void run(async () => {
						const [status, permissionStatus] = await Promise.all([
							localNotifications.capability(),
							localNotifications.permission()
						]);
						setCapability(
							status.available ? status.fidelity : status.reason
						);
						setPermission(permissionStatus.state);
					}, 'Notification capability queried')
				}
			>
				Query capability
			</button>
			<button
				id="notifications-permission"
				onClick={() =>
					void run(async () => {
						const status =
							await localNotifications.requestPermission();
						setPermission(status.state);
					}, 'Notification permission requested')
				}
			>
				Request permission
			</button>
			<button
				id="notifications-schedule"
				onClick={() =>
					void run(async () => {
						await localNotifications.schedule({
							body: 'Tap to return to the AbsoluteJS acceptance route.',
							data: { route: '/native-notifications' },
							id: TEST_NOTIFICATION_ID,
							scheduledAtMs: Date.now() + 8_000,
							title: 'AbsoluteJS notification test'
						});
						setPending('1');
					}, 'Notification scheduled for about 8 seconds')
				}
			>
				Schedule notification
			</button>
			<button
				id="notifications-pending"
				onClick={() =>
					void run(async () => {
						const scheduled = await localNotifications.pending();
						setPending(String(scheduled.length));
					}, 'Pending notifications queried')
				}
			>
				List pending
			</button>
			<button
				id="notifications-cancel"
				onClick={() =>
					void run(async () => {
						await localNotifications.cancel([TEST_NOTIFICATION_ID]);
						setPending('0');
					}, 'Notification cancelled')
				}
			>
				Cancel notification
			</button>
		</main>
	);
};
