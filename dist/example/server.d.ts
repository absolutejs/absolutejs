import { Elysia } from "elysia";
export declare const server: Elysia<"", false, {
    decorator: {};
    store: {};
    derive: {};
    resolve: {};
}, {
    type: {};
    error: {};
}, {
    schema: {};
    macro: {};
}, {
    index: {
        get: {
            body: unknown;
            params: Record<never, string>;
            query: unknown;
            headers: unknown;
            response: {
                200: import("bun").BunFile;
            };
        };
    };
} & {
    react: {
        get: {
            body: unknown;
            params: Record<never, string>;
            query: unknown;
            headers: unknown;
            response: {
                200: Response;
            };
        };
    };
} & {
    htmx: {
        get: {
            body: unknown;
            params: Record<never, string>;
            query: unknown;
            headers: unknown;
            response: {
                200: import("bun").BunFile;
            };
        };
    };
} & {
    htmx: {
        increment: {
            get: {
                body: unknown;
                params: Record<never, string>;
                query: unknown;
                headers: unknown;
                response: {
                    200: Response;
                };
            };
        };
    };
}, {
    derive: {};
    resolve: {};
    schema: {};
}, {
    derive: {};
    resolve: {};
    schema: {};
    decorator: {};
    store: {};
}>;
