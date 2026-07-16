import { defineComponent as _defineComponent } from "vue";
import { useCount } from "../composables/useCount.js";
const script = _defineComponent({
  __name: "CountButton",
  props: {
    initialCount: { type: Number, required: true }
  },
  setup(__props, { expose: __expose }) {
    __expose();
    const props = __props;
    const { count, increment } = useCount(props.initialCount);
    const __returned__ = { props, count, increment };
    Object.defineProperty(__returned__, "__isScriptSetup", { enumerable: false, value: true });
    return __returned__;
  }
});

import { ssrRenderAttrs as _ssrRenderAttrs, ssrInterpolate as _ssrInterpolate } from "vue/server-renderer"

export function ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<button${
    _ssrRenderAttrs(_attrs)
  } data-v-count-button>count is ${
    _ssrInterpolate($setup.count)
  }</button>`)
}
script.ssrRender = ssrRender;
script.__scopeId = "data-v-count-button";

export default script;