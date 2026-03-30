import { defineConfig } from '../../../src/utils/defineConfig';

export default defineConfig({
	assetsDirectory: 'tests/fixtures/images/assets',
	images: {
		formats: ['avif']
	}
});
