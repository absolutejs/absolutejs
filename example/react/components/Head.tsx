import type { Metadata } from '../../../types/metadata';
import { Head as BaseHead } from '../../../src/react/components/Head';

export const Head = (props: Metadata = {}) => (
	<BaseHead
		description="AbsoluteJS React Example"
		font="Poppins"
		title="AbsoluteJS + React"
		{...props}
	/>
);
