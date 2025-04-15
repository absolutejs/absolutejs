type BuildConfig = {
    buildDir?: string;
    assetsDir?: string;
    reactIndexDir?: string;
    javascriptDir?: string;
    typeScriptDir?: string;
    reactPagesDir?: string;
    htmlDir?: string;
    htmxDir?: string;
    tailwind?: {
        input: string;
        output: string;
    };
};
export declare const build: ({ buildDir, assetsDir, reactIndexDir, javascriptDir, typeScriptDir, reactPagesDir, htmlDir, htmxDir, tailwind }: BuildConfig) => Promise<Record<string, string> | null>;
export {};
