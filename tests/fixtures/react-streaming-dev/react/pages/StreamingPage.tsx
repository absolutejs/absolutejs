import { StreamSlot } from '@absolutejs/absolute/react/components';
import {
	REACT_STREAM_SLOT_FAST_DELAY_MS,
	REACT_STREAM_SLOT_SLOW_DELAY_MS
} from '../../../../../src/constants';

const delay = async (milliseconds: number) => Bun.sleep(milliseconds);

export const StreamingPage = () => (
	<html lang="en">
		<head>
			<title>React Streaming Dev Fixture</title>
		</head>
		<body>
			<main>
				<StreamSlot
					className={undefined}
					errorHtml={undefined}
					fallbackHtml="<p>fast loading</p>"
					id="fixture-fast"
					resolve={async () => {
						await delay(REACT_STREAM_SLOT_FAST_DELAY_MS);

						return '<section>fixture fast resolved</section>';
					}}
					timeoutMs={undefined}
				/>
				<StreamSlot
					className={undefined}
					errorHtml={undefined}
					fallbackHtml="<p>slow loading</p>"
					id="fixture-slow"
					resolve={async () => {
						await delay(REACT_STREAM_SLOT_SLOW_DELAY_MS);

						return '<section>fixture slow resolved</section>';
					}}
					timeoutMs={undefined}
				/>
			</main>
		</body>
	</html>
);
