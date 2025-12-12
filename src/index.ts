#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import CommandExecutor from "./CommandExecutor.js";
import TtyOutputReader from "./TtyOutputReader.js";
import SendControlCharacter from "./SendControlCharacter.js";
import TerminalLister from "./TerminalLister.js";
import TerminalCreator from "./TerminalCreator.js";

const server = new Server(
  {
    name: "iterm-mcp",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "list_terminals",
        description: "Lists all iTerm terminal sessions with their unique IDs, names, and TTY paths",
        inputSchema: {
          type: "object",
          properties: {},
          required: []
        }
      },
      {
        name: "create_terminal",
        description: "Creates a new iTerm terminal tab and returns its session ID",
        inputSchema: {
          type: "object",
          properties: {},
          required: []
        }
      },
      {
        name: "write_to_terminal",
        description: "Writes text to the active iTerm terminal - often used to run a command in the terminal",
        inputSchema: {
          type: "object",
          properties: {
            command: {
              type: "string",
              description: "The command to run or text to write to the terminal"
            },
            sessionId: {
              type: "string",
              description: "The session ID to target. Use 'active' for the current session, or a specific session ID from list_terminals. Defaults to 'active'."
            },
          },
          required: ["command"]
        }
      },
      {
        name: "read_terminal_output",
        description: "Reads the output from the active iTerm terminal",
        inputSchema: {
          type: "object",
          properties: {
            linesOfOutput: {
              type: "integer",
              description: "The number of lines of output to read."
            },
            sessionId: {
              type: "string",
              description: "The session ID to target. Use 'active' for the current session, or a specific session ID from list_terminals. Defaults to 'active'."
            },
          },
          required: ["linesOfOutput"]
        }
      },
      {
        name: "send_control_character",
        description: "Sends a control character to the active iTerm terminal (e.g., Control-C, or special sequences like ']' for telnet escape)",
        inputSchema: {
          type: "object",
          properties: {
            letter: {
              type: "string",
              description: "The letter corresponding to the control character (e.g., 'C' for Control-C, ']' for telnet escape)"
            },
            sessionId: {
              type: "string",
              description: "The session ID to target. Use 'active' for the current session, or a specific session ID from list_terminals. Defaults to 'active'."
            },
          },
          required: ["letter"]
        }
      },
      {
        name: "search_terminal_output",
        description: "Searches the terminal output for lines matching a query string and returns matching lines with their line numbers",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The search query string to find in terminal output"
            },
            sessionId: {
              type: "string",
              description: "The session ID to target. Use 'active' for the current session, or a specific session ID from list_terminals. Defaults to 'active'."
            },
            maxResults: {
              type: "integer",
              description: "Maximum number of matching lines to return. Defaults to 50."
            }
          },
          required: ["query"]
        }
      }
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  switch (request.params.name) {
    case "list_terminals": {
      const terminals = await TerminalLister.list();

      const output = terminals.map(t =>
        `${t.sessionId}\t${t.name}\t${t.cwd}\t${t.lastCommand}`
      ).join('\n');

      return {
        content: [{
          type: "text",
          text: `Session ID\tTab Name\tWorking Directory\tLast Command\n${output}`
        }]
      };
    }
    case "create_terminal": {
      const result = await TerminalCreator.create();

      return {
        content: [{
          type: "text",
          text: `Created new terminal with session ID: ${result.sessionId}`
        }]
      };
    }
    case "write_to_terminal": {
      const sessionId = request.params.arguments?.sessionId as string | undefined;
      let executor = new CommandExecutor(undefined, sessionId);
      const command = String(request.params.arguments?.command);
      const beforeCommandBuffer = await TtyOutputReader.retrieveBuffer(sessionId);
      const beforeCommandBufferLines = beforeCommandBuffer.split("\n").length;

      await executor.executeCommand(command);

      const afterCommandBuffer = await TtyOutputReader.retrieveBuffer(sessionId);
      const afterCommandBufferLines = afterCommandBuffer.split("\n").length;
      const outputLines = afterCommandBufferLines - beforeCommandBufferLines

      return {
        content: [{
          type: "text",
          text: `${outputLines} lines were output after sending the command to the terminal. Read the last ${outputLines} lines of terminal contents to orient yourself. Never assume that the command was executed or that it was successful.`
        }]
      };
    }
    case "read_terminal_output": {
      const linesOfOutput = Number(request.params.arguments?.linesOfOutput) || 25
      const sessionId = request.params.arguments?.sessionId as string | undefined;
      const output = await TtyOutputReader.call(linesOfOutput, sessionId)

      return {
        content: [{
          type: "text",
          text: output
        }]
      };
    }
    case "send_control_character": {
      const sessionId = request.params.arguments?.sessionId as string | undefined;
      const ttyControl = new SendControlCharacter(sessionId);
      const letter = String(request.params.arguments?.letter);
      await ttyControl.send(letter);

      return {
        content: [{
          type: "text",
          text: `Sent control character: Control-${letter.toUpperCase()}`
        }]
      };
    }
    case "search_terminal_output": {
      const sessionId = request.params.arguments?.sessionId as string | undefined;
      const query = String(request.params.arguments?.query);
      const maxResults = Number(request.params.arguments?.maxResults) || 50;

      const buffer = await TtyOutputReader.retrieveBuffer(sessionId);
      const lines = buffer.split('\n');
      const matches: string[] = [];

      for (let i = 0; i < lines.length && matches.length < maxResults; i++) {
        if (lines[i].toLowerCase().includes(query.toLowerCase())) {
          matches.push(`${i + 1}: ${lines[i]}`);
        }
      }

      if (matches.length === 0) {
        return {
          content: [{
            type: "text",
            text: `No matches found for "${query}"`
          }]
        };
      }

      return {
        content: [{
          type: "text",
          text: `Found ${matches.length} match(es) for "${query}":\n\n${matches.join('\n')}`
        }]
      };
    }
    default:
      throw new Error("Unknown tool");
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
