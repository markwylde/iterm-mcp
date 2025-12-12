import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execPromise = promisify(exec);

export interface TerminalInfo {
  sessionId: string;
  name: string;
  tty: string;
  cwd: string;
  lastCommand: string;
}

export default class TerminalLister {
  static async list(): Promise<TerminalInfo[]> {
    // First get basic session info
    const listScript = `
      tell application "iTerm2"
        set output to ""
        repeat with w in windows
          repeat with t in tabs of w
            repeat with s in sessions of t
              set sessionId to id of s
              set sessionName to name of s
              set sessionTty to tty of s
              set output to output & sessionId & "\\t" & sessionTty & "\\t" & sessionName & "\\n"
            end repeat
          end repeat
        end repeat
        return output
      end tell
    `;

    try {
      const { stdout } = await execPromise(`osascript -e '${listScript}'`);
      const lines = stdout.trim().split('\n').filter(line => line.length > 0);

      const terminals: TerminalInfo[] = [];

      for (const line of lines) {
        const [sessionId, tty, ...nameParts] = line.split('\t');
        const name = nameParts.join('\t');

        // Get working directory and last command in parallel
        const [cwd, lastCommand] = await Promise.all([
          this.getWorkingDirectory(tty),
          this.getLastCommand(sessionId)
        ]);

        terminals.push({
          sessionId,
          tty,
          name,
          cwd,
          lastCommand
        });
      }

      return terminals;
    } catch (error: unknown) {
      throw new Error(`Failed to list terminals: ${(error as Error).message}`);
    }
  }

  private static async getWorkingDirectory(tty: string): Promise<string> {
    try {
      // Get the PID of the foreground process on this tty
      const { stdout: pidOutput } = await execPromise(`lsof -t "${tty}" 2>/dev/null | head -1`);
      const pid = pidOutput.trim();

      if (!pid) {
        return '(unknown)';
      }

      // Get the current working directory of that process
      const { stdout: cwdOutput } = await execPromise(`lsof -a -d cwd -p "${pid}" 2>/dev/null | tail -1 | awk '{print $NF}'`);
      const cwd = cwdOutput.trim();

      return cwd || '(unknown)';
    } catch {
      return '(unknown)';
    }
  }

  private static async getLastCommand(sessionId: string): Promise<string> {
    const contentScript = `
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
      end tell
    `;

    try {
      const { stdout } = await execPromise(`osascript -e '${contentScript}'`);
      const content = stdout.trim();

      // Find the last command by looking for prompt patterns
      // Common patterns: "$ ", "% ", "> ", "# ", or lines ending with these
      const lines = content.split('\n');

      // Work backwards to find the last line that looks like a command prompt with a command
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();

        // Skip empty lines and separator lines
        if (!line || /^[-─═]+$/.test(line)) continue;

        // Check if this is just a prompt waiting for input (no command after prompt char)
        // Patterns: "user in dir %", "user@host:path$", "> ", "$ ", etc.
        if (/[\$%]\s*$/.test(line)) {
          return '(waiting for input)';
        }

        // Look for prompt patterns with a command after them
        // Use greedy match (.*) to find the LAST $ or % followed by a command
        // This handles cases like "> markwylde in dir % command"
        const promptWithCommand = line.match(/^.*[\$%]\s+(.+)$/);
        if (promptWithCommand && promptWithCommand[1]) {
          const cmd = promptWithCommand[1].trim();
          // Make sure it's not just another prompt or empty
          if (cmd && !/^[\$%]\s*$/.test(cmd)) {
            return cmd;
          }
        }
      }

      return '(unknown)';
    } catch {
      return '(error reading)';
    }
  }
}
