import { file } from 'bun';

export { handleReactPageRequest } from '../react/pageHandler';

export const handleHTMLPageRequest = (pagePath: string) => {
    return new Response(file(pagePath), {
        headers: {
            'Content-Type': 'text/html',
            ...(process.env.NODE_ENV === 'development' ? {
                'X-Absolute-Framework': 'html',
                'X-Absolute-Type': 'page',
                'X-Absolute-SSR': 'false'
            } : {})
        }
    });
};

export const handleHTMXPageRequest = (pagePath: string) => {
    return new Response(file(pagePath), {
        headers: {
            'Content-Type': 'text/html',
            ...(process.env.NODE_ENV === 'development' ? {
                'X-Absolute-Framework': 'htmx',
                'X-Absolute-Type': 'page',
                'X-Absolute-SSR': 'false'
            } : {})
        }
    });
};
