import { defineComponent as _defineComponent, ref } from "vue";
import CountButton from "../components/CountButton.js";
const script = _defineComponent({
  __name: "VueExample",
  props: {
    initialCount: { type: Number, required: true }
  },
  setup(__props, { expose: __expose }) {
    __expose();
    const props = __props;
    const count = ref(props.initialCount);
    const isOpen = ref(false);
    const __returned__ = { props, count, isOpen, CountButton };
    Object.defineProperty(__returned__, "__isScriptSetup", { enumerable: false, value: true });
    return __returned__;
  }
});

import { ssrIncludeBooleanAttr as _ssrIncludeBooleanAttr, ssrRenderComponent as _ssrRenderComponent, ssrRenderStyle as _ssrRenderStyle } from "vue/server-renderer"

export function ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<!--[--><header data-v-vue-example><a href="/" data-v-vue-example>AbsoluteJS</a><details${(_ssrIncludeBooleanAttr($setup.isOpen)) ? " open" : ""} data-v-vue-example><summary data-v-vue-example>Pages</summary><nav data-v-vue-example><a href="/html" data-v-vue-example>HTML</a><a href="/react" data-v-vue-example>React</a><a href="/htmx" data-v-vue-example>HTMX</a><a href="/svelte" data-v-vue-example>Svelte</a><a href="/vue" data-v-vue-example>Vue</a><a href="/angular" data-v-vue-example>Angular</a></nav></details></header><main data-v-vue-example><nav data-v-vue-example><a href="https://absolutejs.com" target="_blank" data-v-vue-example><img class="logo" src="/assets/png/absolutejs-temp.png" alt="AbsoluteJS Logo" data-v-vue-example></a><a href="https://vuejs.org" target="_blank" data-v-vue-example><img class="logo vue" src="/assets/svg/vue-logo.svg" alt="Vue Logo" data-v-vue-example></a></nav><h1 data-v-vue-example>AbsoluteJS + Vue</h1>`)
  _push(_ssrRenderComponent($setup["CountButton"], { initialCount: $setup.count }, null, _parent))
  _push(`<p data-v-vue-example> Edit <code data-v-vue-example>example/vue/pages/VueExample.vue</code> and save to test HMR. </p><p style="${
    _ssrRenderStyle({"margin-top":"2rem"})
  }" data-v-vue-example> Explore the other pages to see how AbsoluteJS seamlessly unifies multiple frameworks on a single server. </p><p style="${
    _ssrRenderStyle({"color":"#777","font-size":"1rem","margin-top":"2rem"})
  }" data-v-vue-example> Click on the AbsoluteJS and Vue logos to learn more. </p></main><!--]-->`)
}
script.ssrRender = ssrRender;
script.__scopeId = "data-v-vue-example";

export default script;