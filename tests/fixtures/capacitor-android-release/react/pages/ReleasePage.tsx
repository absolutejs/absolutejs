export type ReleasePageProps = { message: string };

export const ReleasePage = ({ message }: ReleasePageProps) => (
	<html lang="en">
		<head>
			<title>AbsoluteJS Capacitor Release Acceptance</title>
		</head>
		<body>
			<main>
				<h1>{message}</h1>
			</main>
		</body>
	</html>
);
