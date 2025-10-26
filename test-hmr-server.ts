// test-hmr-server.ts
import { startBunHMRDevServer } from './src/dev/bunHMRDevServer';

const config = {
  reactDirectory: 'example/react',
  svelteDirectory: 'example/svelte',
  vueDirectory: 'example/vue',
  angularDirectory: 'example/angular',
  htmlDirectory: 'example/html',
  htmxDirectory: 'example/htmx',
  assetsDirectory: 'example/assets',
  buildDirectory: 'example/build',  // ← Changed from 'build' to 'example/build'
  options: { preserveIntermediateFiles: true }
};

console.log('🚀 Starting Bun HMR Dev Server...');

startBunHMRDevServer(config).catch((error) => {
  console.error('❌ Failed to start HMR server:', error);
  process.exit(1);
});