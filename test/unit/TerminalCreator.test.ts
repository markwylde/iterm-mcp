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

describe('TerminalCreator', () => {
  let TerminalCreator;

  beforeEach(async () => {
    jest.clearAllMocks();
    TerminalCreator = (await import('../../src/TerminalCreator.js')).default;
  });

  test('create returns a session ID for the new terminal', async () => {
    createMockExecPromise(() => ({
      stdout: 'w0t0p0.session-ABC123\n',
      stderr: ''
    }));

    const result = await TerminalCreator.create();

    expect(result).toHaveProperty('sessionId', 'w0t0p0.session-ABC123');
  });

  test('create throws error when AppleScript fails', async () => {
    createMockExecPromise(() => ({
      error: new Error('iTerm2 not running')
    }));

    await expect(TerminalCreator.create()).rejects.toThrow('Failed to create terminal');
  });

  test('create trims whitespace from session ID', async () => {
    createMockExecPromise(() => ({
      stdout: '  session-XYZ789  \n',
      stderr: ''
    }));

    const result = await TerminalCreator.create();

    expect(result.sessionId).toBe('session-XYZ789');
  });

  test('create calls AppleScript with correct command structure', async () => {
    let capturedCommand = '';
    mockExec.mockImplementation((cmd, callback) => {
      capturedCommand = cmd;
      callback(null, { stdout: 'session-test\n', stderr: '' });
      return { stdout: '', stderr: '' };
    });

    await TerminalCreator.create();

    expect(capturedCommand).toContain('osascript');
    expect(capturedCommand).toContain('tell application "iTerm2"');
    expect(capturedCommand).toContain('tell front window');
    expect(capturedCommand).toContain('create tab with default profile');
    expect(capturedCommand).toContain('return id of it');
  });
});
