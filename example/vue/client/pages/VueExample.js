import { defineComponent as _defineComponent, ref, createElementVNode as _createElementVNode, createVNode as _createVNode, createTextVNode as _createTextVNode, createStaticVNode as _createStaticVNode, Fragment as _Fragment, openBlock as _openBlock, createElementBlock as _createElementBlock } from "vue";
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


const _hoisted_1 = ["open"]

export function render(_ctx, _cache, $props, $setup, $data, $options) {
  return (_openBlock(), _createElementBlock(_Fragment, null, [
    _createElementVNode("header", null, [
      _cache[3] || (_cache[3] = _createElementVNode("a", { href: "/" }, "AbsoluteJS", -1 /* CACHED */)),
      _createElementVNode("details", {
        open: $setup.isOpen,
        onPointerenter: _cache[0] || (_cache[0] = $event => ($setup.isOpen = true)),
        onPointerleave: _cache[1] || (_cache[1] = $event => ($setup.isOpen = false))
      }, [...(_cache[2] || (_cache[2] = [
        _createStaticVNode("<summary data-v-vue-example>Pages</summary><nav data-v-vue-example><a href=\"/html\" data-v-vue-example>HTML</a><a href=\"/react\" data-v-vue-example>React</a><a href=\"/htmx\" data-v-vue-example>HTMX</a><a href=\"/svelte\" data-v-vue-example>Svelte</a><a href=\"/vue\" data-v-vue-example>Vue</a><a href=\"/angular\" data-v-vue-example>Angular</a></nav>", 2)
      ]))], 40 /* PROPS, NEED_HYDRATION */, _hoisted_1)
    ]),
    _createElementVNode("main", null, [
      _cache[4] || (_cache[4] = _createElementVNode("nav", null, [
        _createElementVNode("a", {
          href: "https://absolutejs.com",
          target: "_blank"
        }, [
          _createElementVNode("img", {
            class: "logo",
            src: "/assets/png/absolutejs-temp.png",
            alt: "AbsoluteJS Logo"
          })
        ]),
        _createElementVNode("a", {
          href: "https://vuejs.org",
          target: "_blank"
        }, [
          _createElementVNode("img", {
            class: "logo vue",
            src: "/assets/svg/vue-logo.svg",
            alt: "Vue Logo"
          })
        ])
      ], -1 /* CACHED */)),
      _cache[5] || (_cache[5] = _createElementVNode("h1", null, "AbsoluteJS + Vue", -1 /* CACHED */)),
      _createVNode($setup["CountButton"], { initialCount: $setup.count }, null, 8 /* PROPS */, ["initialCount"]),
      _cache[6] || (_cache[6] = _createElementVNode("p", null, [
        _createTextVNode(" Edit "),
        _createElementVNode("code", null, "example/vue/pages/VueExample.vue"),
        _createTextVNode(" and save to test HMR. ")
      ], -1 /* CACHED */)),
      _cache[7] || (_cache[7] = _createElementVNode("p", { style: {"margin-top":"2rem"} }, " Explore the other pages to see how AbsoluteJS seamlessly unifies multiple frameworks on a single server. ", -1 /* CACHED */)),
      _cache[8] || (_cache[8] = _createElementVNode("p", { style: {"color":"#777","font-size":"1rem","margin-top":"2rem"} }, " Click on the AbsoluteJS and Vue logos to learn more. ", -1 /* CACHED */))
    ])
  ], 64 /* STABLE_FRAGMENT */))
}
script.render = render;
script.__scopeId = "data-v-vue-example";

// Vue Native HMR Registration
script.__hmrId = "pages/VueExample";
if (typeof __VUE_HMR_RUNTIME__ !== 'undefined') {
  __VUE_HMR_RUNTIME__.createRecord(script.__hmrId, script);
  if (typeof window !== 'undefined') {
    window.__VUE_HMR_COMPONENTS__ = window.__VUE_HMR_COMPONENTS__ || {};
    window.__VUE_HMR_COMPONENTS__[script.__hmrId] = script;
  }
}
export default script;