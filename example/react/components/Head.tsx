type HeadProps = {
	title?: string;
	description?: string;
	icon?: string;
	font?: string;
	cssPath?: string;
};

export const Head = ({
	title = 'AbsoluteJS + React',
	description = 'AbsoluteJS React Example',
	icon = '/assets/ico/favicon.ico',
	font = 'Poppins',
	cssPath
}: HeadProps) => (
	<head>
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
		/>
		<link
			href={`https://fonts.googleapis.com/css2?family=${font}:wght@100..900&display=swap`}
			rel="stylesheet"
		/>
		{cssPath && <link rel="stylesheet" href={cssPath} type="text/css" />}
	</head>
);
