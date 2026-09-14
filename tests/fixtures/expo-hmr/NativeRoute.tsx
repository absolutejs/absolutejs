/* eslint-disable no-restricted-exports */
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- The managed module may not exist before the generator runs.
// @ts-ignore This managed module exists after the conformance generator runs.
import { AbsoluteWebHost } from './.absolutejs/native/src/generated/AbsoluteWebHost';

const MARKER = 'expo-native-fast-refresh-v1';
const REPORT_ORIGIN = process.env.EXPO_PUBLIC_ABSOLUTE_HMR_REPORT_ORIGIN;
const RADIX = 36;

export default function NativeRoute() {
	const [stateToken] = useState(
		() => `${Date.now()}-${Math.random().toString(RADIX).slice(2)}`
	);

	useEffect(() => {
		if (!REPORT_ORIGIN) return () => undefined;
		void fetch(`${REPORT_ORIGIN}/native-report`, {
			body: JSON.stringify({ marker: MARKER, stateToken }),
			headers: { 'content-type': 'application/json' },
			method: 'POST'
		}).catch(() => undefined);

		return () => undefined;
	});

	if (MARKER.endsWith('-v2')) return <AbsoluteWebHost />;

	return (
		<View>
			<Text>{MARKER}</Text>
			<Text testID="absolute-state-token">{stateToken}</Text>
		</View>
	);
}
