import { createAuthClient } from '@absolutejs/auth/client';
import { createSyncClient } from '@absolutejs/sync/client';
import { useRef, useState } from 'react';

type NativeAuthSyncAcceptanceProps = {
	email: string;
	syncUrl: string;
};

type NativeSyncRow = { id: number; label: string };

const RECONNECT_DELAY_MS = 50;

type AcceptanceState =
	| 'idle'
	| 'signing-in'
	| 'authenticated'
	| 'syncing'
	| 'reconnecting'
	| 'complete'
	| 'failed';

export const NativeAuthSyncAcceptance = ({
	email,
	syncUrl
}: NativeAuthSyncAcceptanceProps) => {
	const [detail, setDetail] = useState('Ready');
	const [state, setState] = useState<AcceptanceState>('idle');
	const running = useRef(false);

	const run = async () => {
		if (running.current) return;
		running.current = true;
		setState('signing-in');
		setDetail('Opening the system browser');
		try {
			const auth = createAuthClient();
			const signedIn = await auth.signIn.email({ email, password: '' });
			if (signedIn.error) throw new Error(signedIn.error.message);
			const status = await auth.status();
			if (status.error) throw new Error(status.error.message);
			const { user } = status.data;
			if (
				typeof user !== 'object' ||
				user === null ||
				Reflect.get(user, 'sub') !== 'native-conformance-user'
			) {
				throw new Error(
					'Native user-info did not return the expected user.'
				);
			}
			setState('authenticated');
			setDetail('Native auth authenticated');
			setState('syncing');
			setDetail('Native auth authenticated; connecting sync');

			const sync = createSyncClient({
				maxReconnectMs: 100,
				reconnectMs: 50,
				url: syncUrl
			});
			const collection = sync.collection<NativeSyncRow>({
				collection: 'native-acceptance'
			});
			let readyCount = 0;
			const unsubscribe = collection.subscribe((snapshot) => {
				if (
					snapshot.status !== 'ready' ||
					snapshot.data[0]?.label !== 'native-authenticated-sync'
				) {
					return;
				}
				readyCount += 1;
				if (readyCount === 1) {
					setState('reconnecting');
					setDetail('Native sync ready; forcing reconnect');
					setTimeout(() => sync.disconnect(), RECONNECT_DELAY_MS);

					return;
				}
				setState('complete');
				setDetail('Native auth + sync complete');
				unsubscribe();
				collection.close();
				sync.close();
			});
		} catch (error) {
			setState('failed');
			setDetail(error instanceof Error ? error.message : String(error));
			running.current = false;
		}
	};

	return (
		<main>
			<h1>AbsoluteJS Native Auth + Sync</h1>
			<p data-state={state} id="native-auth-sync-status">
				{detail}
			</p>
			<button id="native-auth-sync-start" onClick={() => void run()}>
				Run native acceptance
			</button>
		</main>
	);
};
