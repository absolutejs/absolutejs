import { BuildConfig } from "./types";
export declare const build: ({ buildDirectory, assetsDirectory, reactDirectory, html, htmxDirectory, tailwind }: BuildConfig) => Promise<Record<string, string> | null>;
