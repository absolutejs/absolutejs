import type { RuntimeIslandRenderProps } from '../../types/island';
import { preserveIslandMarkup } from '../client/preserveIslandMarkup';

export const Island = (props: RuntimeIslandRenderProps) => {
	const { attributes, innerHTML } = preserveIslandMarkup(props);

	return (
		<div
			{...attributes}
			dangerouslySetInnerHTML={{ __html: innerHTML }}
			suppressHydrationWarning
		/>
	);
};
