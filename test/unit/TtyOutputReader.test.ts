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

describe('TtyOutputReader', () => {
  let TtyOutputReader;

  beforeEach(async () => {
    jest.clearAllMocks();
    TtyOutputReader = (await import('../../src/TtyOutputReader.js')).default;
  });

  test('call returns full buffer when no line limit specified', async () => {
    createMockExecPromise(() => ({
      stdout: 'line1\nline2\nline3\nline4\nline5\n',
      stderr: ''
    }));

    const result = await TtyOutputReader.call();

    expect(result).toBe('line1\nline2\nline3\nline4\nline5');
  });

  test('call returns limited lines when linesOfOutput is specified', async () => {
    createMockExecPromise(() => ({
      stdout: 'line1\nline2\nline3\nline4\nline5\n',
      stderr: ''
    }));

    const result = await TtyOutputReader.call(2);

    // Implementation uses slice(-linesOfOutput - 1), so asking for 2 returns 3 lines
    expect(result).toBe('line3\nline4\nline5');
  });

  test('retrieveBuffer targets active session by default', async () => {
    let capturedCommand = '';
    mockExec.mockImplementation((cmd, callback) => {
      capturedCommand = cmd;
      callback(null, { stdout: 'terminal content\n', stderr: '' });
      return { stdout: '', stderr: '' };
    });

    await TtyOutputReader.retrieveBuffer();

    expect(capturedCommand).toContain('current session of current tab');
    expect(capturedCommand).not.toContain('repeat with w in windows');
  });

  test('retrieveBuffer targets active session when sessionId is "active"', async () => {
    let capturedCommand = '';
    mockExec.mockImplementation((cmd, callback) => {
      capturedCommand = cmd;
      callback(null, { stdout: 'terminal content\n', stderr: '' });
      return { stdout: '', stderr: '' };
    });

    await TtyOutputReader.retrieveBuffer('active');

    expect(capturedCommand).toContain('current session of current tab');
  });

  test('retrieveBuffer targets specific session when sessionId is provided', async () => {
    let capturedCommand = '';
    mockExec.mockImplementation((cmd, callback) => {
      capturedCommand = cmd;
      callback(null, { stdout: 'terminal content\n', stderr: '' });
      return { stdout: '', stderr: '' };
    });

    await TtyOutputReader.retrieveBuffer('session-123');

    expect(capturedCommand).toContain('if id of s is "session-123"');
    expect(capturedCommand).toContain('repeat with w in windows');
    expect(capturedCommand).toContain('return contents of s');
  });

  test('retrieveBuffer throws error when AppleScript fails', async () => {
    createMockExecPromise(() => ({
      error: new Error('Script error')
    }));

    await expect(TtyOutputReader.retrieveBuffer()).rejects.toThrow('Failed to read terminal output');
  });

  test('call passes sessionId to retrieveBuffer', async () => {
    let capturedCommand = '';
    mockExec.mockImplementation((cmd, callback) => {
      capturedCommand = cmd;
      callback(null, { stdout: 'line1\nline2\n', stderr: '' });
      return { stdout: '', stderr: '' };
    });

    await TtyOutputReader.call(5, 'session-456');

    expect(capturedCommand).toContain('session-456');
  });
});
