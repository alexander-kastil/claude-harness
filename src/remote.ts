/**
 * Remote Control: Claude Code's `--remote-control` (alias `--rc`) flag starts an interactive session that can also be
 * continued from claude.ai/code and the phone. With `--resume <id>` it does that for an existing session.
 * The transcript records a started bridge as a `{"type":"system","subtype":"bridge_status"}` line; session-flags.ts reads it.
 */

/** The terminal line that resumes a session with Remote Control on; `base` builds the claude line (command and extra arguments). */
export function remoteCommand(base: (rest: string) => string, sessionId: string): string {
  return base(`--resume ${sessionId} --remote-control`);
}
