import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execPromise = promisify(exec);

export interface CreateTerminalResult {
  sessionId: string;
}

export default class TerminalCreator {
  static async create(): Promise<CreateTerminalResult> {
    const ascript = `
      tell application "iTerm2"
        tell front window
          set newTab to (create tab with default profile)
          tell current session of newTab
            return id of it
          end tell
        end tell
      end tell
    `;

    try {
      const { stdout } = await execPromise(`osascript -e '${ascript}'`);
      return {
        sessionId: stdout.trim()
      };
    } catch (error: unknown) {
      throw new Error(`Failed to create terminal: ${(error as Error).message}`);
    }
  }
}
