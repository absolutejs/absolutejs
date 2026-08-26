import { location, type DeviceLocationPosition } from '@absolutejs/devices';
import { useEffect, useRef, useState } from 'react';

const errorCode = (error: unknown) => {
	if (typeof error === 'object' && error !== null) {
		const code = Reflect.get(error, 'code');
		if (typeof code === 'string') return code;
	}

	return 'unknown';
};

export const NativeLocationAcceptance = () => {
	const stopWatch = useRef<(() => void | Promise<void>) | undefined>(
		undefined
	);
	const [accuracy, setAccuracy] = useState<number | null>(null);
	const [active, setActive] = useState(false);
	const [capability, setCapability] = useState('not-queried');
	const [detail, setDetail] = useState('Ready');
	const [error, setError] = useState('none');
	const [permission, setPermission] = useState('not-queried');
	const [position, setPosition] = useState<DeviceLocationPosition | null>(
		null
	);
	const [precision, setPrecision] = useState('unknown');
	const [updates, setUpdates] = useState(0);

	const showPosition = (next: DeviceLocationPosition) => {
		setAccuracy(next.accuracyMeters);
		setPosition(next);
		setError('none');
	};

	const query = async () => {
		try {
			const [nextCapability, nextPermission] = await Promise.all([
				location.capability(),
				location.permission()
			]);
			setCapability(
				nextCapability.available
					? nextCapability.fidelity
					: nextCapability.reason
			);
			setPermission(nextPermission.state);
			setPrecision(nextPermission.precision);
			setDetail('Location capability and permission queried');
			setError('none');
		} catch (caught) {
			setError(errorCode(caught));
			setDetail('Location query failed');
		}
	};

	const request = async () => {
		try {
			const next = await location.requestPermission({
				precision: 'precise'
			});
			setPermission(next.state);
			setPrecision(next.precision);
			setDetail('Location permission request completed');
			setError('none');
		} catch (caught) {
			setError(errorCode(caught));
			setDetail('Location permission request failed');
		}
	};

	const current = async () => {
		try {
			showPosition(
				await location.current({
					accuracy: 'high',
					maximumAgeMs: 60_000,
					timeoutMs: 10_000
				})
			);
			setDetail('Current location received');
		} catch (caught) {
			setError(errorCode(caught));
			setDetail('Current location failed');
		}
	};

	const stop = async () => {
		const dispose = stopWatch.current;
		stopWatch.current = undefined;
		if (dispose) await dispose();
		setActive(false);
		setDetail('Location watch stopped');
	};

	const watch = async () => {
		if (stopWatch.current) return;
		try {
			stopWatch.current = await location.watch(
				(event) => {
					if (event.type === 'error') {
						setError(event.error.code);
						setDetail('Location watch reported an error');

						return;
					}
					showPosition(event.position);
					setUpdates((count) => count + 1);
					setDetail('Location watch update received');
				},
				{
					accuracy: 'high',
					intervalMs: 1_000,
					minimumUpdateIntervalMs: 500
				}
			);
			setActive(true);
			setDetail('Location watch started');
		} catch (caught) {
			setError(errorCode(caught));
			setDetail('Location watch failed');
		}
	};

	useEffect(
		() => () => {
			void stopWatch.current?.();
			stopWatch.current = undefined;
		},
		[]
	);

	return (
		<main>
			<h1>AbsoluteJS Foreground Location</h1>
			<p id="location-detail">{detail}</p>
			<dl id="location-status">
				<dt>Capability</dt>
				<dd data-capability={capability}>{capability}</dd>
				<dt>Permission</dt>
				<dd data-permission={permission}>{permission}</dd>
				<dt>Precision</dt>
				<dd data-precision={precision}>{precision}</dd>
				<dt>Watch</dt>
				<dd data-active={String(active)}>
					{active ? 'active' : 'stopped'}
				</dd>
				<dt>Updates</dt>
				<dd data-updates={updates}>{updates}</dd>
				<dt>Accuracy</dt>
				<dd data-accuracy={accuracy ?? ''}>{accuracy ?? 'none'}</dd>
				<dt>Error</dt>
				<dd data-error={error}>{error}</dd>
			</dl>
			<p
				data-position={position ? 'received' : 'none'}
				id="location-position"
			>
				{position
					? `${position.latitude}, ${position.longitude}`
					: 'No position'}
			</p>
			<button id="location-query" onClick={() => void query()}>
				Query without prompt
			</button>
			<button id="location-request" onClick={() => void request()}>
				Request precise permission
			</button>
			<button id="location-current" onClick={() => void current()}>
				Get current position
			</button>
			<button id="location-watch" onClick={() => void watch()}>
				Start watch
			</button>
			<button id="location-stop" onClick={() => void stop()}>
				Stop watch
			</button>
		</main>
	);
};
