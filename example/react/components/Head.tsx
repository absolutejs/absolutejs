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
	<head suppressHydrationWarning>
		<meta charSet="utf-8" />
		<title>{title}</title>
		<meta content={description} name="description" />
		<meta content="width=device-width, initial-scale=1" name="viewport" />
		<link href={icon} rel="icon" />
		<link href="https://fonts.googleapis.com" rel="preconnect" />
		<link
			crossOrigin="anonymous"
			href="https://fonts.gstatic.com"
			rel="preconnect"
			suppressHydrationWarning
		/>
		<link
			href={`https://fonts.googleapis.com/css2?family=${font}:wght@100..900&display=swap`}
			rel="stylesheet"
			suppressHydrationWarning
		/>
		{cssPath && (
			<link
				href={cssPath}
				rel="stylesheet"
				suppressHydrationWarning
				type="text/css"
			/>
		)}
	</head>
);
