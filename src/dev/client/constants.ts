/* Client-side constants — local copy for dist/dev/client/ portability.
   These values MUST stay in sync with the root constants.ts.
   This file exists because the client files are copied raw to dist/dev/client/
   and cannot import from ../../constants when installed from npm. */

export const ANGULAR_INIT_TIMEOUT_MS = 500;
export const CSS_ERROR_RESOLVE_DELAY_MS = 50;
export const CSS_MAX_CHECK_ATTEMPTS = 10;
export const CSS_MAX_PARSE_TIMEOUT_MS = 500;
export const CSS_SHEET_READY_TIMEOUT_MS = 100;
export const DOM_UPDATE_DELAY_MS = 50;
export const FOCUS_ID_PREFIX_LENGTH = 3;
export const FOCUS_IDX_PREFIX_LENGTH = 4;
export const FOCUS_NAME_PREFIX_LENGTH = 5;
export const HMR_UPDATE_TIMEOUT_MS = 2000;
export const MAX_RECONNECT_ATTEMPTS = 60;
export const OVERLAY_FADE_DURATION_MS = 150;
export const PING_INTERVAL_MS = 30_000;
export const RAF_BATCH_COUNT = 3;
export const REBUILD_RELOAD_DELAY_MS = 200;
export const RECONNECT_INITIAL_DELAY_MS = 500;
export const RECONNECT_POLL_INTERVAL_MS = 300;
export const SVELTE_CSS_LOAD_TIMEOUT_MS = 500;
export const UNFOUND_INDEX = -1;
export const WEBSOCKET_NORMAL_CLOSURE = 1000;
