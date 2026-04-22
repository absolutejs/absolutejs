import { resolve } from 'node:path';
import { defineConfig } from '../../../src/index';

export default defineConfig({
	buildDirectory: resolve(import.meta.dir, 'build'),
	reactDirectory: resolve(import.meta.dir, 'react')
});
