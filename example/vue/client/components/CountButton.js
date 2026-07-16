import { defineComponent as _defineComponent, toDisplayString as _toDisplayString, openBlock as _openBlock, createElementBlock as _createElementBlock } from "vue";
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


export function render(_ctx, _cache, $props, $setup, $data, $options) {
  return (_openBlock(), _createElementBlock("button", {
    onClick: _cache[0] || (_cache[0] = (...args) => ($setup.increment && $setup.increment(...args)))
  }, "count is " + _toDisplayString($setup.count), 1 /* TEXT */))
}
script.render = render;
script.__scopeId = "data-v-count-button";

// Vue Native HMR Registration
script.__hmrId = "components/CountButton";
if (typeof __VUE_HMR_RUNTIME__ !== 'undefined') {
  __VUE_HMR_RUNTIME__.createRecord(script.__hmrId, script);
  if (typeof window !== 'undefined') {
    window.__VUE_HMR_COMPONENTS__ = window.__VUE_HMR_COMPONENTS__ || {};
    window.__VUE_HMR_COMPONENTS__[script.__hmrId] = script;
  }
}
export default script;