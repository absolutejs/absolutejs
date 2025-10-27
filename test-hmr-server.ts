import { startBunHMRDevServer } from './src/dev/hmrServer';

const config: {
  reactDirectory: string;
  svelteDirectory: string;
  vueDirectory: string;
  angularDirectory: string;
  htmlDirectory: string;
  htmxDirectory: string;
  assetsDirectory: string;
  buildDirectory: string;
  options: { preserveIntermediateFiles: boolean };
} = {
  reactDirectory: 'example/react',
  svelteDirectory: 'example/svelte',
  vueDirectory: 'example/vue',
  angularDirectory: 'example/angular',
  htmlDirectory: 'example/html',
  htmxDirectory: 'example/htmx',
  assetsDirectory: 'example/assets',
  buildDirectory: 'example/build',
  options: { preserveIntermediateFiles: true }
};

console.log('🚀 Starting Bun HMR Dev Server...');

startBunHMRDevServer(config).catch((error) => {
  console.error('❌ Failed to start HMR server:', error);
  process.exit(1);
});