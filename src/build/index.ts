/* Public build-step API.

   These exports let users drive AbsoluteJS's Tailwind compilation from
   their own build pipelines without going through `absolute build`.
   The same persistent-compiler path used by `absolute build` and by HMR
   is what runs here, so callers get the fast path for free. */

export {
	compileTailwind,
	compileTailwindConfig,
	isTailwindCandidate
} from './compileTailwind';

export {
	disposeTailwindCompiler,
	incrementalTailwindBuild,
	warmTailwindCompiler
} from './tailwindCompiler';
