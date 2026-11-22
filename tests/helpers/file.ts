/* Re-export of the published helpers, so this repository's 86 consumers
 * and a user's project share one restore registry and one implementation.
 *
 * Sharing the registry matters: it is module state, and two copies would
 * each restore only the edits made through themselves. */
export {
	createFile,
	mutateFile,
	mutateFileInPlace,
	renameFile,
	restoreAllFiles,
	restoreFile,
	withFileMutation
} from '../../src/testing/files';
