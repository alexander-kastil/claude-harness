// Remote Control in the webview: the tag of a session that ran with it.
import { el } from './dom';

export const REMOTE_TIP = 'Remote\nThis session ran with Remote Control, so it could be continued from claude.ai/code or the Claude app.';

/** The Remote tag of a session row, or nothing when the transcript records no Remote Control. */
export const remoteTag = (s: { remote?: boolean } | undefined) => (s && s.remote ? el('span', { className: 'tag remote-tag', title: REMOTE_TIP }, 'Remote') : '');
