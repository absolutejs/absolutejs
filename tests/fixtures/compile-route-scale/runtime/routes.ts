export const scalePageCount = 48;

export const staticRoutes = [
	'/',
	'/section',
	'/section/',
	'/section/deep',
	'/query?tab=alpha',
	'/query?tab=beta',
	'/redirect-static',
	'/redirect-query?target=from-static&mode=static',
	'/api/static-json',
	'/asset-like/known.txt',
	...Array.from({ length: scalePageCount }, (_, index) => `/page-${index}`)
];
