import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { openSync, closeSync } from 'node:fs';
import ProcessTracker from './ProcessTracker.js';
import TtyOutputReader from './TtyOutputReader.js';

/**
 * CommandExecutor handles sending commands to iTerm2 via AppleScript.
 *
 * This includes special handling for multiline text to prevent AppleScript syntax errors
 * when dealing with newlines in command strings. The approach uses AppleScript string
 * concatenation with explicit line breaks rather than trying to embed newlines directly
 * in the AppleScript string.
 */

const execPromise = promisify(exec);
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

class CommandExecutor {
  private _execPromise: typeof execPromise;
  private _sessionId?: string;

  constructor(execPromiseOverride?: typeof execPromise, sessionId?: string) {
    this._execPromise = execPromiseOverride || execPromise;
    this._sessionId = sessionId;
  }

  /**
   * Generates the AppleScript target for the session.
   * If sessionId is provided and not 'active', it targets that specific session.
   * Otherwise, it targets the current session of the current window.
   */
  private getSessionTarget(): { prefix: string; suffix: string; isSpecific: boolean } {
    if (!this._sessionId || this._sessionId === 'active') {
      return {
        prefix: 'tell application "iTerm2" to tell current session of current window to ',
        suffix: '',
        isSpecific: false
      };
    }
    return {
      prefix: `
        tell application "iTerm2"
          repeat with w in windows
            repeat with t in tabs of w
              repeat with s in sessions of t
                if id of s is "${this._sessionId}" then
                  tell s to `,
      suffix: `
                end if
              end repeat
            end repeat
          end repeat
        end tell`,
      isSpecific: true
    };
  }

  /**
   * Executes a command in the iTerm2 terminal.
   *
   * This method handles both single-line and multiline commands by:
   * 1. Properly escaping the command string for AppleScript
   * 2. Using different AppleScript approaches based on whether the command contains newlines
   * 3. Waiting for the command to complete execution
   * 4. Retrieving the terminal output after command execution
   *
   * @param command The command to execute (can contain newlines)
   * @returns A promise that resolves to the terminal output after command execution
   */
  async executeCommand(command: string): Promise<string> {
    const escapedCommand = this.escapeForAppleScript(command);
    const target = this.getSessionTarget();

    try {
      if (target.isSpecific) {
        // For specific session targeting, we need a full AppleScript
        const writeCmd = command.includes('\n')
          ? `write text (${escapedCommand})`
          : `write text "${escapedCommand}"`;

        const ascript = `
          tell application "iTerm2"
            repeat with w in windows
              repeat with t in tabs of w
                repeat with s in sessions of t
                  if id of s is "${this._sessionId}" then
                    tell s to ${writeCmd}
                    return
                  end if
                end repeat
              end repeat
            end repeat
            error "Session not found: ${this._sessionId}"
          end tell
        `;
        await this._execPromise(`/usr/bin/osascript -e '${ascript}'`);
      } else {
        // For active session, use the simpler command
        if (command.includes('\n')) {
          await this._execPromise(`/usr/bin/osascript -e '${target.prefix}write text (${escapedCommand})'`);
        } else {
          await this._execPromise(`/usr/bin/osascript -e '${target.prefix}write text "${escapedCommand}"'`);
        }
      }

      // Wait until iTerm2 reports that command processing is complete
      while (await this.isProcessing()) {
        await sleep(100);
      }

      // Get the TTY path and check if it's waiting for user input
      const ttyPath = await this.retrieveTtyPath();
      while (await this.isWaitingForUserInput(ttyPath) === false) {
        await sleep(100);
      }

      // Give a small delay for output to settle
      await sleep(200);

      // Retrieve the terminal output after command execution
      const afterCommandBuffer = await TtyOutputReader.retrieveBuffer(this._sessionId)
      return afterCommandBuffer
    } catch (error: unknown) {
      throw new Error(`Failed to execute command: ${(error as Error).message}`);
    }
  }

  async isWaitingForUserInput(ttyPath: string): Promise<boolean> {
    let fd;
    try {
      // Open the TTY file descriptor in non-blocking mode
      fd = openSync(ttyPath, 'r');
      const tracker = new ProcessTracker();
      let belowThresholdTime = 0;

      while (true) {
        try {
          const activeProcess = await tracker.getActiveProcess(ttyPath);

          if (!activeProcess) return true;

          if (activeProcess.metrics.totalCPUPercent < 1) {
            belowThresholdTime += 350;
            if (belowThresholdTime >= 1000) return true;
          } else {
            belowThresholdTime = 0;
          }

        } catch {
          return true;
        }

        await sleep(350);
      }
    } catch (error: unknown) {
      return true;
    } finally {
      if (fd !== undefined) {
        closeSync(fd);
      }
      return true;
    }
  }

  /**
   * Escapes a string for use in an AppleScript command.
   *
   * This method handles two scenarios:
   * 1. For multiline text (containing newlines), it uses a special AppleScript
   *    string concatenation approach to properly handle line breaks
   * 2. For single-line text, it escapes special characters for AppleScript compatibility
   *
   * @param str The string to escape
   * @returns A properly escaped string ready for AppleScript execution
   */
  escapeForAppleScript(str: string): string {
    // Check if the string contains newlines
    if (str.includes('\n')) {
      // For multiline text, we need to use a different AppleScript approach
      // that properly handles newlines in AppleScript
      return this.prepareMultilineCommand(str);
    }

    // First, escape any backslashes
    str = str.replace(/\\/g, '\\\\');

    // Escape double quotes
    str = str.replace(/"/g, '\\"');

    // Handle single quotes by breaking out of the quote, escaping the quote, and going back in
    str = str.replace(/'/g, "'\\''");

    // Handle control characters only - AppleScript handles Unicode characters natively
    str = str.replace(/[\x00-\x1F\x7F]/g, (char) => {
      return '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0');
    });

    return str;
  }

  /**
   * Prepares a multiline string for use in AppleScript.
   *
   * This method handles multiline text by splitting it into separate lines
   * and creating an AppleScript expression that concatenates these lines
   * with explicit 'return' statements between them. This approach avoids
   * syntax errors that occur when trying to directly include newlines in
   * AppleScript strings.
   *
   * @param str The multiline string to prepare
   * @returns An AppleScript-compatible string expression that preserves line breaks
   */
  private prepareMultilineCommand(str: string): string {
    // Split the input by newlines and prepare each line separately
    const lines = str.split('\n');

    // Create an AppleScript string that concatenates all lines with proper line breaks
    let applescriptString = '"' + this.escapeAppleScriptString(lines[0]) + '"';

    for (let i = 1; i < lines.length; i++) {
      // For each subsequent line, use AppleScript's string concatenation with line feed
      // The 'return' keyword in AppleScript adds a newline character
      applescriptString += ' & return & "' + this.escapeAppleScriptString(lines[i]) + '"';
    }

    return applescriptString;
  }

  /**
   * Escapes a single line of text for use in an AppleScript string.
   *
   * Handles special characters that would otherwise cause syntax errors
   * in AppleScript strings:
   * - Backslashes are doubled to avoid escape sequence interpretation
   * - Double quotes are escaped to avoid prematurely terminating the string
   * - Tabs are replaced with their escape sequence
   *
   * @param str The string to escape (should not contain newlines)
   * @returns The escaped string
   */
  private escapeAppleScriptString(str: string): string {
    // Escape quotes and backslashes for AppleScript string
    return str
      .replace(/\\/g, '\\\\')  // Double backslashes
      .replace(/"/g, '\\"')    // Escape double quotes
      .replace(/\t/g, '\\t');  // Handle tabs
  }

  private async retrieveTtyPath(): Promise<string> {
    try {
      let ascript: string;

      if (!this._sessionId || this._sessionId === 'active') {
        ascript = 'tell application "iTerm2" to tell current session of current window to get tty';
      } else {
        ascript = `
          tell application "iTerm2"
            repeat with w in windows
              repeat with t in tabs of w
                repeat with s in sessions of t
                  if id of s is "${this._sessionId}" then
                    return tty of s
                  end if
                end repeat
              end repeat
            end repeat
            error "Session not found: ${this._sessionId}"
          end tell
        `;
      }

      const { stdout } = await this._execPromise(`/usr/bin/osascript -e '${ascript}'`);
      return stdout.trim();
    } catch (error: unknown) {
      throw new Error(`Failed to retrieve TTY path: ${(error as Error).message}`);
    }
  }

  private async isProcessing(): Promise<boolean> {
    try {
      let ascript: string;

      if (!this._sessionId || this._sessionId === 'active') {
        ascript = 'tell application "iTerm2" to tell current session of current window to get is processing';
      } else {
        ascript = `
          tell application "iTerm2"
            repeat with w in windows
              repeat with t in tabs of w
                repeat with s in sessions of t
                  if id of s is "${this._sessionId}" then
                    return is processing of s
                  end if
                end repeat
              end repeat
            end repeat
            error "Session not found: ${this._sessionId}"
          end tell
        `;
      }

      const { stdout } = await this._execPromise(`/usr/bin/osascript -e '${ascript}'`);
      return stdout.trim() === 'true';
    } catch (error: unknown) {
      throw new Error(`Failed to check processing status: ${(error as Error).message}`);
    }
  }
}

export default CommandExecutor;
