import { App } from '../components/App';
import { Dropdown } from '../components/Dropdown';

type ReactExampleProps = { initialCount: number; cssPath: string };

export const ReactExample = ({ initialCount, cssPath }: ReactExampleProps) => (
	<div data-absolute-react-root data-react-css={cssPath}>
			<header>
				<a href="/">AbsoluteJS</a>
				<Dropdown />
			</header>
			<App initialCount={initialCount} />
	</div>
);
