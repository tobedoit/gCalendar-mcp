#!/usr/bin/env node
// stdout은 SDK(JSON-RPC)만 사용해야 하므로, 모든 자체 로그는 stderr로만.
// 실수 방지를 위해 console.log를 차단한다.
console.log = (...args) => {
  try {
    // 혹시 외부 라이브러리가 console.log를 호출하면 stderr로 우회
    console.error('[STDOUT-BLOCKED→STDERR]', ...args);
  } catch {}
};

import 'dotenv/config';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import { google } from 'googleapis';

// ----- logging -----
const LOG_LEVEL = process.env.MCP_LOG_LEVEL || 'debug'; // 'debug' | 'info' | 'error' | 'silent'
function logAt(level, ...args) {
  const order = { silent: 0, error: 1, info: 2, debug: 3 };
  if (order[level] <= order[LOG_LEVEL]) {
    console.error(level.toUpperCase() + ':', new Date().toISOString(), ...args);
  }
}
const debugLog = (...a) => logAt('debug', ...a);
const infoLog = (...a) => logAt('info', ...a);
const errorLog = (...a) => logAt('error', ...a);

// ----- env checks -----
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  errorLog('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET is required');
  process.exit(1);
}
if (!GOOGLE_REFRESH_TOKEN) {
  infoLog('GOOGLE_REFRESH_TOKEN is not set. Only public/limited API calls may work.');
}

// ----- tool schema -----
const CREATE_EVENT_TOOL = {
  name: 'create_event',
  description: 'Create a calendar event with specified details',
  inputSchema: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'Event title' },
      start_time: { type: 'string', description: 'Start time (ISO format)' },
      end_time: { type: 'string', description: 'End time (ISO format)' },
      description: { type: 'string', description: 'Event description' },
      location: { type: 'string', description: 'Event location' },
      attendees: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of attendee emails'
      },
      reminders: {
        type: 'object',
        properties: {
          useDefault: {
            type: 'boolean',
            description: 'Whether to use default reminders'
          },
          overrides: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                method: { type: 'string', description: 'popup | email' },
                minutes: { type: 'number', description: 'Minutes before start' }
              },
              required: ['method', 'minutes']
            },
            description: 'List of custom reminder settings'
          }
        },
        description: 'Reminder settings for the event'
      }
    },
    required: ['summary', 'start_time', 'end_time']
  }
};

// ----- server -----
const server = new Server(
  { name: 'mcp_calendar', version: '1.0.1' },
  {
    capabilities: {
      tools: {},
      // 선택: resources/prompts를 비워서라도 구현(Claude가 호출해도 404 안나게)
      resources: {},
      prompts: {}
    }
  }
);

infoLog('Server initialized');

async function createCalendarEvent(args) {
  debugLog('createCalendarEvent args:', JSON.stringify(args));

  const oauth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    // 필요 시 redirect URI 교체
    'http://localhost'
  );

  oauth2Client.setCredentials({
    refresh_token: GOOGLE_REFRESH_TOKEN,
    token_uri: 'https://oauth2.googleapis.com/token'
  });

  const calendar = google.calendar({
    version: 'v3',
    auth: oauth2Client
  });

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

  if (args.location) event.location = args.location;
  if (args.attendees) {
    event.attendees = args.attendees.map((email) => ({ email }));
  }
  if (args.reminders) {
    event.reminders = args.reminders;
  } else {
    event.reminders = {
      useDefault: false,
      overrides: [{ method: 'popup', minutes: 10 }]
    };
  }

  debugLog('event payload:', JSON.stringify(event));

  const res = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: event
  });

  debugLog('insert response id:', res.data.id);
  return `Event created: ${res.data.htmlLink}`;
}

// ----- handlers -----
server.setRequestHandler(ListToolsRequestSchema, async () => {
  debugLog('tools/list');
  return { tools: [CREATE_EVENT_TOOL] };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  debugLog('tools/call:', JSON.stringify(request));
  try {
    const { name, arguments: args } = request.params || {};
    if (!args) throw new Error('No arguments provided');

    if (name === 'create_event') {
      const result = await createCalendarEvent(args);
      return { content: [{ type: 'text', text: result }], isError: false };
    }
    return {
      content: [{ type: 'text', text: `Unknown tool: ${name}` }],
      isError: true
    };
  } catch (e) {
    errorLog('CallTool error:', e?.stack || e);
    return {
      content: [{ type: 'text', text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
      isError: true
    };
  }
});

// ----- run -----
async function runServer() {
  debugLog('Starting server');
  const transport = new StdioServerTransport();
  await server.connect(transport);
  infoLog('Server connected to transport');
  console.error('Calendar MCP Server running on stdio');
}

// ----- hardening: process-level guards -----
process.on('uncaughtException', (err) => {
  // stdout 만지지 말 것. 로그는 stderr.
  errorLog('uncaughtException:', err?.stack || err);
});
process.on('unhandledRejection', (reason) => {
  errorLog('unhandledRejection:', reason);
});
['SIGINT', 'SIGTERM', 'SIGHUP'].forEach((sig) => {
  process.on(sig, () => {
    infoLog(`Received ${sig}, shutting down...`);
    // StdioServerTransport는 종료 훅이 없으니 프로세스 종료
    process.exit(0);
  });
});

// ----- start -----
runServer().catch((err) => {
  errorLog('Fatal error running server:', err?.stack || err);
  process.exit(1);
});