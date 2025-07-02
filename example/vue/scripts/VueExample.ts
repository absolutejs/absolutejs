import { defineComponent as _defineComponent } from 'vue';
import { ref } from 'vue';

export default /*@__PURE__*/ _defineComponent({
	__name: 'VueExample',
	props: {
		test: { required: true, type: Number }
	},
	setup(__props, { expose: __expose }) {
		__expose();

		const props = __props;

		const count = ref(props.test);

		const __returned__ = { count, props };
		Object.defineProperty(__returned__, '__isScriptSetup', {
			enumerable: false,
			value: true
		});

		return __returned__;
	}
});
