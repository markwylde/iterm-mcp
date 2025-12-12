import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execPromise = promisify(exec);

export default class TtyOutputReader {
  static async call(linesOfOutput?: number, sessionId?: string) {
    const buffer = await this.retrieveBuffer(sessionId);
    if (!linesOfOutput) {
      return buffer;
    }
    const lines = buffer.split('\n');
    return lines.slice(-linesOfOutput - 1).join('\n');
  }

  static async retrieveBuffer(sessionId?: string): Promise<string> {
    let ascript: string;

    if (!sessionId || sessionId === 'active') {
      // Use the current/active session
      ascript = `
        tell application "iTerm2"
          tell front window
            tell current session of current tab
              set numRows to number of rows
              set allContent to contents
              return allContent
            end tell
          end tell
        end tell
      `;
    } else {
      // Find the specific session by ID
      ascript = `
        tell application "iTerm2"
          repeat with w in windows
            repeat with t in tabs of w
              repeat with s in sessions of t
                if id of s is "${sessionId}" then
                  return contents of s
                end if
              end repeat
            end repeat
          end repeat
          error "Session not found: ${sessionId}"
        end tell
      `;
    }

    try {
      const { stdout: finalContent } = await execPromise(`osascript -e '${ascript}'`);
      return finalContent.trim();
    } catch (error: unknown) {
      throw new Error(`Failed to read terminal output: ${(error as Error).message}`);
    }
  }
}
