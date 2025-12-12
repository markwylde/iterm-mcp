// @ts-nocheck
import { jest, describe, expect, test, beforeEach } from '@jest/globals';
import SendControlCharacter from '../../src/SendControlCharacter.js';

// Create a mock subclass that overrides the executeCommand method
class MockSendControlCharacter extends SendControlCharacter {
  mockExecuteCommand = jest.fn();

  constructor(sessionId?: string) {
    super(sessionId);
  }

  protected async executeCommand(command: string): Promise<void> {
    this.mockExecuteCommand(command);
    return Promise.resolve();
  }
}

describe('SendControlCharacter', () => {
  let sendControlCharacter: MockSendControlCharacter;
  
  beforeEach(() => {
    // Initialize our test subject
    sendControlCharacter = new MockSendControlCharacter();
    sendControlCharacter.mockExecuteCommand.mockClear();
  });
  
  test('should send standard control character (Ctrl+C)', async () => {
    // Act
    await sendControlCharacter.send('C');
    
    // Assert - C is ASCII 67, Ctrl+C is ASCII 3 (67-64)
    expect(sendControlCharacter.mockExecuteCommand).toHaveBeenCalledWith(
      expect.stringContaining('ASCII character 3')
    );
  });
  
  test('should handle lowercase letters correctly', async () => {
    // Act
    await sendControlCharacter.send('c');
    
    // Assert
    expect(sendControlCharacter.mockExecuteCommand).toHaveBeenCalledWith(
      expect.stringContaining('ASCII character 3')
    );
  });
  
  test('should handle telnet escape character (Ctrl+])', async () => {
    // Act
    await sendControlCharacter.send(']');
    
    // Assert - Group Separator (GS) is ASCII 29
    expect(sendControlCharacter.mockExecuteCommand).toHaveBeenCalledWith(
      expect.stringContaining('ASCII character 29')
    );
  });
  
  test('should handle escape key', async () => {
    // Act
    await sendControlCharacter.send('ESC');
    
    // Assert - Escape is ASCII 27
    expect(sendControlCharacter.mockExecuteCommand).toHaveBeenCalledWith(
      expect.stringContaining('ASCII character 27')
    );
    
    // Test with alternative format
    await sendControlCharacter.send('escape');
    expect(sendControlCharacter.mockExecuteCommand).toHaveBeenCalledWith(
      expect.stringContaining('ASCII character 27')
    );
  });
  
  test('should throw an error for invalid control characters', async () => {
    // Act & Assert
    await expect(sendControlCharacter.send('123')).rejects.toThrow(
      'Invalid control character letter'
    );
  });
  
  test('should throw an error when execution fails', async () => {
    // Arrange - Make the mock throw an error
    sendControlCharacter.mockExecuteCommand.mockImplementation(() => {
      throw new Error('Command execution failed');
    });

    // Act & Assert
    await expect(sendControlCharacter.send('C')).rejects.toThrow(
      'Failed to send control character: Command execution failed'
    );
  });

  describe('session targeting', () => {
    test('should target active session when no sessionId provided', async () => {
      const ctrl = new MockSendControlCharacter();
      await ctrl.send('C');

      expect(ctrl.mockExecuteCommand).toHaveBeenCalledWith(
        expect.stringContaining('current session of current tab')
      );
    });

    test('should target active session when sessionId is "active"', async () => {
      const ctrl = new MockSendControlCharacter('active');
      await ctrl.send('C');

      expect(ctrl.mockExecuteCommand).toHaveBeenCalledWith(
        expect.stringContaining('current session of current tab')
      );
    });

    test('should target specific session when sessionId is provided', async () => {
      const ctrl = new MockSendControlCharacter('session-123');
      await ctrl.send('C');

      const calledWith = ctrl.mockExecuteCommand.mock.calls[0][0];
      expect(calledWith).toContain('if id of s is "session-123"');
      expect(calledWith).toContain('repeat with w in windows');
    });

    test('should iterate through all sessions to find specific session', async () => {
      const ctrl = new MockSendControlCharacter('my-session-id');
      await ctrl.send('Z');

      const calledWith = ctrl.mockExecuteCommand.mock.calls[0][0];
      expect(calledWith).toContain('repeat with t in tabs of w');
      expect(calledWith).toContain('repeat with s in sessions of t');
      expect(calledWith).toContain('my-session-id');
    });
  });
});