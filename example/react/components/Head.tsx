type HeadProps = {
	title?: string;
	description?: string;
	icon?: string;
	font?: string;
	cssPath?: string;
	cssPaths?: string[];
};

export const Head = ({
	title = 'AbsoluteJS + React',
	description = 'AbsoluteJS React Example',
	icon = '/assets/ico/favicon.ico',
	font = 'Poppins',
	cssPath,
	cssPaths = []
}: HeadProps) => {
	const allCssPaths = [...(cssPath ? [cssPath] : []), ...cssPaths];

	return (
		<head suppressHydrationWarning>
			<meta charSet="utf-8" />
			<title>{title}</title>
			<meta name="description" content={description} />
			<meta name="viewport" content="width=device-width, initial-scale=1" />
			<link rel="icon" href={icon} />
			<link rel="preconnect" href="https://fonts.googleapis.com" />
			<link
				rel="preconnect"
				href="https://fonts.gstatic.com"
				crossOrigin="anonymous"
				suppressHydrationWarning
			/>
			<link
				href={`https://fonts.googleapis.com/css2?family=${font}:wght@100..900&display=swap`}
				rel="stylesheet"
				suppressHydrationWarning
			/>
			{allCssPaths.map((path, index) => (
				<link
					key={index}
					rel="stylesheet"
					href={path}
					type="text/css"
					suppressHydrationWarning
				/>
			))}
		</head>
	);
};
