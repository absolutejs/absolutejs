import { pushNotifications } from '@absolutejs/devices';
import { useEffect, useState } from 'react';

const errorCode = (error: unknown) => {
	if (typeof error === 'object' && error !== null) {
		const code = Reflect.get(error, 'code');
		if (typeof code === 'string') return code;
	}

	return 'unknown';
};

export const NativePushAcceptance = () => {
	const [capability, setCapability] = useState('not-queried');
	const [detail, setDetail] = useState('Ready');
	const [error, setError] = useState('none');
	const [event, setEvent] = useState('none');
	const [permission, setPermission] = useState('not-queried');

	useEffect(() => {
		let active = true;
		const removers: Array<() => void | Promise<void>> = [];
		void Promise.all([
			pushNotifications.onReceived((notification) => {
				if (active) setEvent(`received:${notification.id}`);
			}),
			pushNotifications.onAction((action) => {
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
			<h1>AbsoluteJS Push Notifications</h1>
			<p id="push-detail">{detail}</p>
			<dl id="push-status">
				<dt>Capability</dt>
				<dd data-capability={capability}>{capability}</dd>
				<dt>Permission</dt>
				<dd data-permission={permission}>{permission}</dd>
				<dt>Last event</dt>
				<dd data-event={event}>{event}</dd>
				<dt>Error</dt>
				<dd data-error={error}>{error}</dd>
			</dl>
			<button
				id="push-query"
				onClick={() =>
					void run(async () => {
						const [status, permissionStatus] = await Promise.all([
							pushNotifications.capability(),
							pushNotifications.permission()
						]);
						setCapability(
							status.available ? status.fidelity : status.reason
						);
						setPermission(permissionStatus.state);
					}, 'Push capability queried')
				}
			>
				Query capability
			</button>
			<button
				id="push-permission"
				onClick={() =>
					void run(async () => {
						const status =
							await pushNotifications.requestPermission();
						setPermission(status.state);
					}, 'Push permission requested')
				}
			>
				Request permission
			</button>
			<button
				id="push-enable"
				onClick={() =>
					void run(
						() => pushNotifications.enable(),
						'Push enabled for this signed-in installation'
					)
				}
			>
				Enable push
			</button>
			<button
				id="push-disable"
				onClick={() =>
					void run(
						() => pushNotifications.disable(),
						'Push disabled for this installation'
					)
				}
			>
				Disable push
			</button>
		</main>
	);
};
