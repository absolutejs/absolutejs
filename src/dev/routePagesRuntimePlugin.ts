import { readServerSource } from './serverSource';

const PROJECT_REACT_FILE = /^(?!.*[\\/]node_modules[\\/]).*\.[jt]sx(\?.*)?$/;

/** With backend HMR off, nothing else loads the dev server's modules, so
 *  this gives React files the router page splitting every build applies
 *  (build/splitRoutePages.ts): the server then renders the boundaries the
 *  browser hydrates. A runtime plugin cannot hand a file back to Bun's own
 *  loader, so it returns every matched file, split or not. */
export const installRoutePagesRuntimePlugin = () => {
	Bun.plugin({
		name: 'absolute-route-pages-runtime',
		setup(build) {
			build.onLoad({ filter: PROJECT_REACT_FILE }, (args) => {
				const queryStart = args.path.indexOf('?');
				const path =
					queryStart === -1
						? args.path
						: args.path.slice(0, queryStart);

				return {
					contents: readServerSource(path),
					loader: path.endsWith('.jsx') ? 'jsx' : 'tsx'
				};
			});
		}
	});
};
