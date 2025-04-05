#!/usr/bin/env node
import * as dotenv from 'dotenv';
dotenv.config(); // 로컬 개발 시 .env 파일을 읽습니다.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { google } from 'googleapis';

// Debug log utility
function debugLog(...args) {
  console.error('DEBUG:', new Date().toISOString(), ...args);
}

// Define the create_event tool
const CREATE_EVENT_TOOL = {
  name: "create_event",
  description: "Create a calendar event with specified details",
  inputSchema: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description: "Event title"
      },
      start_time: {
        type: "string",
        description: "Start time (ISO format)"
      },
      end_time: {
        type: "string",
        description: "End time (ISO format)"
      },
      description: {
        type: "string",
        description: "Event description"
      },
      location: {
        type: "string",
        description: "Event location"
      },
      attendees: {
        type: "array",
        items: { type: "string" },
        description: "List of attendee emails"
      },
      reminders: {
        type: "object",
        properties: {
          useDefault: {
            type: "boolean",
            description: "Whether to use default reminders"
          },
          overrides: {
            type: "array",
            items: {
              type: "object",
              properties: {
                method: {
                  type: "string",
                  description: "Reminder method (e.g., popup, email)"
                },
                minutes: {
                  type: "number",
                  description: "Minutes before event start for the reminder"
                }
              },
              required: ["method", "minutes"]
            },
            description: "List of custom reminder settings"
          }
        },
        description: "Reminder settings for the event"
      }
    },
    required: ["summary", "start_time", "end_time"]
  }
};

// Server implementation
const server = new Server({
  name: "mcp_calendar",
  version: "1.0.0"
}, {
  capabilities: {
    tools: {}
  }
});

debugLog('Server initialized');

// 환경 변수 확인: MCP 클라이언트 설정이나 .env 파일을 통해 전달받은 값이 여기에 들어갑니다.
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  console.error("Error: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables are required");
  process.exit(1);
}

// Calendar event creation function
async function createCalendarEvent(args) {
  debugLog('Creating calendar event with args:', JSON.stringify(args, null, 2));
  
  try {
    debugLog('Creating OAuth2 client');
    const oauth2Client = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      'http://localhost'
    );
    debugLog('OAuth2 client created');
    
    debugLog('Setting credentials');
    // refresh token은 실제 발급받은 값으로 교체해야 합니다.
    oauth2Client.setCredentials({
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      token_uri: "https://oauth2.googleapis.com/token"
    });
    debugLog('Credentials set');

    debugLog('Creating calendar service');
    const calendar = google.calendar({ 
      version: 'v3',
      auth: oauth2Client
    });
    debugLog('Calendar service created');
    
    const event = {
      summary: args.summary,
      description: args.description,
      start: {
        dateTime: args.start_time,
        timeZone: 'Asia/Seoul'
      },
      end: {
        dateTime: args.end_time,
        timeZone: 'Asia/Seoul'
      }
    };
    debugLog('Event object created:', JSON.stringify(event, null, 2));

    if (args.location) {
      event.location = args.location;
      debugLog('Location added:', args.location);
    }

    if (args.attendees) {
      event.attendees = args.attendees.map(email => ({ email }));
      debugLog('Attendees added:', event.attendees);
    }
    
    // 알림 설정: 전달된 값이 없으면 기본적으로 10분 전 팝업 알림을 사용합니다.
    if (args.reminders) {
      event.reminders = args.reminders;
      debugLog('Custom reminders set:', JSON.stringify(args.reminders, null, 2));
    } else {
      event.reminders = {
        useDefault: false,
        overrides: [
          { method: 'popup', minutes: 10 }
        ]
      };
      debugLog('Default reminders set:', JSON.stringify(event.reminders, null, 2));
    }

    debugLog('Attempting to insert event');
    const response = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: event
    });
    debugLog('Event insert response:', JSON.stringify(response.data, null, 2));
    return `Event created: ${response.data.htmlLink}`;
  } catch (error) {
    debugLog('ERROR OCCURRED:');
    debugLog('Error name:', error.name);
    debugLog('Error message:', error.message);
    debugLog('Error stack:', error.stack);
    throw new Error(`Failed to create event: ${error.message}`);
  }
}

// Tool handlers
server.setRequestHandler(ListToolsRequestSchema, async () => {
  debugLog('List tools request received');
  return { tools: [CREATE_EVENT_TOOL] };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  debugLog('Call tool request received:', JSON.stringify(request, null, 2));
  
  try {
    const { name, arguments: args } = request.params;
    if (!args) {
      throw new Error("No arguments provided");
    }

    switch (name) {
      case "create_event": {
        debugLog('Handling create_event request');
        const result = await createCalendarEvent(args);
        debugLog('Event creation successful:', result);
        return {
          content: [{ type: "text", text: result }],
          isError: false
        };
      }
      default:
        debugLog('Unknown tool requested:', name);
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true
        };
    }
  } catch (error) {
    debugLog('Error in call tool handler:', error);
    return {
      content: [{
        type: "text",
        text: `Error: ${error instanceof Error ? error.message : String(error)}`
      }],
      isError: true
    };
  }
});

// Server startup function
async function runServer() {
  debugLog('Starting server');
  const transport = new StdioServerTransport();
  await server.connect(transport);
  debugLog('Server connected to transport');
  console.error("Calendar MCP Server running on stdio");
}

// Start the server
runServer().catch((error) => {
  debugLog('Fatal server error:', error);
  console.error("Fatal error running server:", error);
  process.exit(1);
});