import type { RuntimeIslandRenderProps } from '../../types/island';
import {
	getStableInnerHtml,
	preserveIslandMarkup
} from '../client/preserveIslandMarkup';

export const Island = (props: RuntimeIslandRenderProps) => {
	const { attributes, innerHTML } = preserveIslandMarkup(props);

	return (
		<div
			{...attributes}
			dangerouslySetInnerHTML={getStableInnerHtml(innerHTML)}
			suppressHydrationWarning
		/>
	);
};
