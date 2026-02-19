import { file } from 'bun';

export { handleReactPageRequest } from '../react/pageHandler';

export const handleHTMLPageRequest = (pagePath: string) => file(pagePath);

export const handleHTMXPageRequest = (pagePath: string) => file(pagePath);
