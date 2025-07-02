import { createSSRApp } from 'vue';
import Comp from '../client/VueExample.js';
const props = window.__INITIAL_PROPS__ ?? {};
const app = createSSRApp(Comp, props);
app.mount('#app');
