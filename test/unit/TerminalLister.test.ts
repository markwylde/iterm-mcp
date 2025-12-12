// @ts-nocheck
import { jest, describe, expect, test, beforeEach } from '@jest/globals';

// Mock child_process.exec before importing the module
const mockExec = jest.fn();
jest.unstable_mockModule('node:child_process', () => ({
  exec: mockExec
}));

// Helper to create promisified mock responses
const createMockExecPromise = (impl) => {
  mockExec.mockImplementation((cmd, callback) => {
    const result = impl(cmd);
    if (result instanceof Promise) {
      result.then(
        (res) => callback(null, res),
        (err) => callback(err, null)
      );
    } else if (result.error) {
      callback(result.error, null);
    } else {
      callback(null, result);
    }
    return { stdout: '', stderr: '' };
  });
};

describe('TerminalLister', () => {
  let TerminalLister;

  beforeEach(async () => {
    jest.clearAllMocks();
    TerminalLister = (await import('../../src/TerminalLister.js')).default;
  });

  test('list returns an array of terminal info', async () => {
    createMockExecPromise((command) => {
      if (command.includes('set output to ""')) {
        return { stdout: 'session-123\t/dev/ttys001\tTab 1\nsession-456\t/dev/ttys002\tTab 2\n', stderr: '' };
      }
      if (command.includes('return contents of s')) {
        return { stdout: 'user@host % ls -la\nfile1.txt\nfile2.txt\n', stderr: '' };
      }
      if (command.includes('lsof -t')) {
        return { stdout: '12345\n', stderr: '' };
      }
      if (command.includes('lsof -a -d cwd')) {
        return { stdout: '/Users/test/project\n', stderr: '' };
      }
      return { stdout: '', stderr: '' };
    });

    const terminals = await TerminalLister.list();

    expect(terminals).toHaveLength(2);
    expect(terminals[0]).toHaveProperty('sessionId', 'session-123');
    expect(terminals[0]).toHaveProperty('tty', '/dev/ttys001');
    expect(terminals[0]).toHaveProperty('name', 'Tab 1');
  });

  test('list returns empty array when no terminals exist', async () => {
    createMockExecPromise(() => ({ stdout: '', stderr: '' }));

    const terminals = await TerminalLister.list();

    expect(terminals).toHaveLength(0);
  });

  test('list throws error when AppleScript fails', async () => {
    createMockExecPromise((command) => {
      if (command.includes('osascript')) {
        return { error: new Error('AppleScript error') };
      }
      return { stdout: '', stderr: '' };
    });

    await expect(TerminalLister.list()).rejects.toThrow('Failed to list terminals');
  });

  test('getWorkingDirectory returns (unknown) when lsof returns no PID', async () => {
    createMockExecPromise((command) => {
      if (command.includes('set output to ""')) {
        return { stdout: 'session-123\t/dev/ttys001\tTab 1\n', stderr: '' };
      }
      if (command.includes('lsof -t')) {
        return { stdout: '', stderr: '' }; // No PID
      }
      if (command.includes('return contents of s')) {
        return { stdout: 'user % \n', stderr: '' };
      }
      return { stdout: '', stderr: '' };
    });

    const terminals = await TerminalLister.list();

    expect(terminals[0].cwd).toBe('(unknown)');
  });

  test('getLastCommand returns (waiting for input) when prompt has no command', async () => {
    createMockExecPromise((command) => {
      if (command.includes('set output to ""')) {
        return { stdout: 'session-123\t/dev/ttys001\tTab 1\n', stderr: '' };
      }
      if (command.includes('return contents of s')) {
        return { stdout: 'some output\nuser@host % \n', stderr: '' };
      }
      if (command.includes('lsof')) {
        return { stdout: '', stderr: '' };
      }
      return { stdout: '', stderr: '' };
    });

    const terminals = await TerminalLister.list();

    expect(terminals[0].lastCommand).toBe('(waiting for input)');
  });

  test('getLastCommand extracts command after prompt', async () => {
    createMockExecPromise((command) => {
      if (command.includes('set output to ""')) {
        return { stdout: 'session-123\t/dev/ttys001\tTab 1\n', stderr: '' };
      }
      if (command.includes('return contents of s')) {
        return { stdout: 'some output\nuser@host % npm test\nrunning tests...\n', stderr: '' };
      }
      if (command.includes('lsof')) {
        return { stdout: '', stderr: '' };
      }
      return { stdout: '', stderr: '' };
    });

    const terminals = await TerminalLister.list();

    expect(terminals[0].lastCommand).toBe('npm test');
  });
});
