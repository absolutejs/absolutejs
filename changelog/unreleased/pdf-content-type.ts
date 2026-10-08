import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'PDF assets were served without a PDF content type in `absolute dev` and in compiled apps, so browsers could download them instead of opening them. They are now served as `application/pdf`.',
	kind: 'fixed',
	summary: 'PDF assets are served as application/pdf'
};
