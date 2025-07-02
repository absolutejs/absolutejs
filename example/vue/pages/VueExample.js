import { defineComponent, mergeProps as _mergeProps } from 'vue';
import {
	ssrRenderAttrs as _ssrRenderAttrs,
	ssrInterpolate as _ssrInterpolate
} from 'vue/server-renderer';
import scriptMod, * as named from '../scripts/VueExample.ts';

export function ssrRender(
	_ctx,
	_push,
	_parent,
	_attrs,
	$props,
	$setup,
	$data,
	$options
) {
	_push(
		`<div${_ssrRenderAttrs(
			_mergeProps({ class: 'counter' }, _attrs)
		)}><p>Current count: ${_ssrInterpolate(
			$setup.count
		)}</p><button>Increment</button></div>`
	);
}
export default defineComponent({ ...scriptMod, ...named, ssrRender });
