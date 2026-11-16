/** `*.test.tsx`, `*.spec.ts`, anything under `__tests__/`: run by `bun
 *  test`, never part of the running app. */
const TEST_FILE = /(?:\.(?:spec|test)\.[cm]?[jt]sx?$)|(?:[\\/]__tests__[\\/])/i;

export const isTestFile = (path: string) => TEST_FILE.test(path);
