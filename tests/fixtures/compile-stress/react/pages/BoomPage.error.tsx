export default function BoomError({ message }: { message: string }) {
	return (
		<html>
			<head>
				<title>Error</title>
			</head>
			<body>
				<h1>REACT_ERROR_CONVENTION</h1>
				<p>{message}</p>
			</body>
		</html>
	);
}
