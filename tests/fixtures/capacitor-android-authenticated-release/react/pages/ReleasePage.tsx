import { AuthenticatedReleaseProof } from '../../../../helpers/AuthenticatedReleaseProof';
import type { ReleaseProofProps } from '../../../../helpers/ReleaseDataProof';

export const ReleasePage = (props: ReleaseProofProps) => (
	<html lang="en">
		<head>
			<title>Authenticated release proof</title>
			<meta
				content="width=device-width,initial-scale=1"
				name="viewport"
			/>
		</head>
		<body>
			<AuthenticatedReleaseProof {...props} />
		</body>
	</html>
);
