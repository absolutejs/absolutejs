export default function BoomError({ error }: { error: { message: string } }) {
	return (
		<html>
			<head>
				<title>Error</title>
			</head>
			<body>
				<h1>REACT_ERROR_CONVENTION</h1>
				<p>{error.message}</p>
			</body>
		</html>
	);
}
