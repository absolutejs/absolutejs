type GenerateHeadElementProps = {
	cssPath?: string;
	title?: string;
	icon?: string;
	description?: string;
	font?: string;
};

export const generateHeadElement = ({
	cssPath,
	title = 'AbsoluteJS',
	description = 'A page created using AbsoluteJS',
	font,
	icon = '/assets/ico/favicon.ico'
}: GenerateHeadElementProps = {}) =>
	`<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <meta name="description" content="${description}">
  <link rel="icon" href="${icon}" type="image/x-icon">
  ${
		font
			? `<link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=${font}:wght@100..900&display=swap" rel="stylesheet">`
			: ''
  }
  ${cssPath ? `<link rel="stylesheet" href="${cssPath}" type="text/css">` : ''}
</head>` as const;
