import {
	ReleaseDataProof,
	type ReleaseProofProps
} from '../../../../helpers/ReleaseDataProof';

export type ReleasePageProps = { message: string; proof?: ReleaseProofProps };

export const ReleasePage = ({ message, proof }: ReleasePageProps) => (
	<html lang="en">
		<head>
			<title>AbsoluteJS Capacitor Release Acceptance</title>
		</head>
		<body>
			<main>
				<h1>{message}</h1>
				{proof && <ReleaseDataProof {...proof} />}
			</main>
		</body>
	</html>
);
