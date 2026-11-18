import { resolve } from 'node:path';
import { defineConfig } from '@absolutejs/absolute';

export default defineConfig({
	buildDirectory: resolve(import.meta.dir, 'build'),
	reactDirectory: resolve(import.meta.dir, 'react')
});
