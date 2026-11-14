import type { RuntimeIslandRenderProps } from '../../types/island';
import {
	getStableInnerHtml,
	preserveIslandMarkup
} from '../client/preserveIslandMarkup';
import { IslandWithStylesheet } from './IslandStyleLink';

export const Island = (props: RuntimeIslandRenderProps) => {
	const { attributes, innerHTML } = preserveIslandMarkup(props);

	return (
		<IslandWithStylesheet
			component={props.component}
			framework={props.framework}
			marker={{
				...attributes,
				dangerouslySetInnerHTML: getStableInnerHtml(innerHTML),
				suppressHydrationWarning: true
			}}
		/>
	);
};
