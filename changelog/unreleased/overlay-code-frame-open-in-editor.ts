import type { Change } from '@absolutejs/changelog';
import type * as Api from '../../src/index';

export const change: Change<typeof Api> = {
	detail:
		'The dev error overlay knew the file, line and column and printed ' +
		'them as plain text, with at most the single offending line ' +
		"underneath — which is all Bun's `BuildMessage.position` carries, " +
		'and often the least informative line in the file (`}` or `);`) ' +
		'with no line number to count from. There was nothing to click and ' +
		'nothing to orient by. A build failure now carries the lines around ' +
		'the error, read off disk by the dev server because the browser ' +
		'cannot read the filesystem, and the overlay renders them numbered ' +
		'with a caret on the reported column. The file path above the frame ' +
		'is a button that opens the file at that line: set ' +
		'`ABSOLUTE_EDITOR`, `LAUNCH_EDITOR` or `EDITOR` to `code`, ' +
		'`cursor`, `subl`, `webstorm`, `nvim` and the rest, and the ' +
		'argument shape per editor family is handled for you. With none set ' +
		'the button says which variable to set rather than guessing at an ' +
		'installed editor. The endpoint that launches it is dev-only, ' +
		'refuses any path resolving outside the project, requires the file ' +
		'to exist, takes the editor command from the environment and never ' +
		'from the request, and passes the path as an argv entry with no ' +
		'shell.',
	kind: 'added',
	summary:
		'the dev error overlay shows a code frame and opens the file in your editor',
	symbols: ['ErrorOverlayOptions']
};
