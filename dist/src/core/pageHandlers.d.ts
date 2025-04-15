import { ComponentType } from "react";
export declare const handleReactPageRequest: (pageComponent: ComponentType, index: string) => Promise<Response>;
export declare const handleHTMLPageRequest: (html: string) => import("bun").BunFile;
