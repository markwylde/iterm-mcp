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

describe('search_terminal_output', () => {
  let TtyOutputReader;

  beforeEach(async () => {
    jest.clearAllMocks();
    TtyOutputReader = (await import('../../src/TtyOutputReader.js')).default;
  });

  // Helper function that mirrors the search logic in index.ts
  async function searchTerminalOutput(query: string, sessionId?: string, maxResults: number = 50) {
    const buffer = await TtyOutputReader.retrieveBuffer(sessionId);
    const lines = buffer.split('\n');
    const matches: string[] = [];

    for (let i = 0; i < lines.length && matches.length < maxResults; i++) {
      if (lines[i].toLowerCase().includes(query.toLowerCase())) {
        matches.push(`${i + 1}: ${lines[i]}`);
      }
    }

    return matches;
  }

  test('finds matching lines with case-insensitive search', async () => {
    createMockExecPromise(() => ({
      stdout: 'Hello World\nGoodbye World\nHello Again\nNo match here\n',
      stderr: ''
    }));

    const results = await searchTerminalOutput('hello');

    expect(results).toHaveLength(2);
    expect(results[0]).toBe('1: Hello World');
    expect(results[1]).toBe('3: Hello Again');
  });

  test('returns empty array when no matches found', async () => {
    createMockExecPromise(() => ({
      stdout: 'Line 1\nLine 2\nLine 3\n',
      stderr: ''
    }));

    const results = await searchTerminalOutput('notfound');

    expect(results).toHaveLength(0);
  });

  test('respects maxResults limit', async () => {
    createMockExecPromise(() => ({
      stdout: 'match1\nmatch2\nmatch3\nmatch4\nmatch5\n',
      stderr: ''
    }));

    const results = await searchTerminalOutput('match', undefined, 3);

    expect(results).toHaveLength(3);
    expect(results[0]).toBe('1: match1');
    expect(results[1]).toBe('2: match2');
    expect(results[2]).toBe('3: match3');
  });

  test('includes correct line numbers in results', async () => {
    createMockExecPromise(() => ({
      stdout: 'no match\nno match\nfind me\nno match\nfind me too\n',
      stderr: ''
    }));

    const results = await searchTerminalOutput('find');

    expect(results).toHaveLength(2);
    expect(results[0]).toBe('3: find me');
    expect(results[1]).toBe('5: find me too');
  });

  test('handles empty terminal buffer', async () => {
    createMockExecPromise(() => ({
      stdout: '\n',
      stderr: ''
    }));

    const results = await searchTerminalOutput('anything');

    expect(results).toHaveLength(0);
  });

  test('matches partial strings', async () => {
    createMockExecPromise(() => ({
      stdout: 'error: something went wrong\nwarning: be careful\nerror: another issue\n',
      stderr: ''
    }));

    const results = await searchTerminalOutput('error');

    expect(results).toHaveLength(2);
    expect(results[0]).toContain('error: something went wrong');
    expect(results[1]).toContain('error: another issue');
  });

  test('performs case-insensitive matching', async () => {
    createMockExecPromise(() => ({
      stdout: 'ERROR: uppercase\nError: mixed case\nerror: lowercase\n',
      stderr: ''
    }));

    const results = await searchTerminalOutput('ERROR');

    expect(results).toHaveLength(3);
  });

  test('passes sessionId to retrieveBuffer', async () => {
    let capturedCommand = '';
    mockExec.mockImplementation((cmd, callback) => {
      capturedCommand = cmd;
      callback(null, { stdout: 'test line\n', stderr: '' });
      return { stdout: '', stderr: '' };
    });

    await searchTerminalOutput('test', 'session-123');

    expect(capturedCommand).toContain('session-123');
  });

  test('handles special regex characters in query safely', async () => {
    createMockExecPromise(() => ({
      stdout: 'test [bracket] line\ntest (paren) line\ntest $dollar line\n',
      stderr: ''
    }));

    // These should be treated as literal strings, not regex
    const bracketResults = await searchTerminalOutput('[bracket]');
    expect(bracketResults).toHaveLength(1);

    const parenResults = await searchTerminalOutput('(paren)');
    expect(parenResults).toHaveLength(1);
  });

  test('handles multiline output correctly', async () => {
    createMockExecPromise(() => ({
      stdout: 'first line\nsecond line with target\nthird line\nfourth line with target\nfifth line\n',
      stderr: ''
    }));

    const results = await searchTerminalOutput('target');

    expect(results).toHaveLength(2);
    expect(results[0]).toBe('2: second line with target');
    expect(results[1]).toBe('4: fourth line with target');
  });
});
