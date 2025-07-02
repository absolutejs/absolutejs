import {
	defineComponent,
	toDisplayString as _toDisplayString,
	createElementVNode as _createElementVNode,
	openBlock as _openBlock,
	createElementBlock as _createElementBlock
} from 'vue';
import scriptMod, * as named from '../scripts/VueExample.ts';

const _hoisted_1 = { class: 'counter' };

export function render(_ctx, _cache, $props, $setup, $data, $options) {
	return (
		_openBlock(),
		_createElementBlock('div', _hoisted_1, [
			_createElementVNode(
				'p',
				null,
				`Current count: ${_toDisplayString($setup.count)}`,
				1 /* TEXT */
			),
			_createElementVNode(
				'button',
				{
					onClick:
						_cache[0] || (_cache[0] = ($event) => $setup.count++)
				},
				'Increment'
			)
		])
	);
}
export default defineComponent({ ...scriptMod, ...named, render });
