import { NativeAuthSyncAcceptance as Acceptance } from '../components/NativeAuthSyncAcceptance';

type NativeAuthSyncAcceptanceProps = {
	email: string;
	syncUrl: string;
};

export const NativeAuthSyncAcceptance = (
	props: NativeAuthSyncAcceptanceProps
) => (
	<html>
		<head>
			<meta charSet="utf-8" />
			<meta
				content="width=device-width,initial-scale=1,viewport-fit=cover"
				name="viewport"
			/>
			<title>AbsoluteJS Native Auth + Sync</title>
		</head>
		<body>
			<Acceptance {...props} />
		</body>
	</html>
);
