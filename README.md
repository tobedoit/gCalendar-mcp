# MCP Google Calendar Server 
 
A Model Context Protocol (MCP) server implementation that enables AI assistants like Claude to create and manage Google Calendar events. 
 
## Features 
 
- Create calendar events with title, description, start/end times 
- Support for adding event attendees 
- OAuth2 authentication with Google Calendar API 
- Full MCP protocol implementation 
- Debug logging for troubleshooting 
 
## Prerequisites 
 
- Node.js v18 or later 
- Google Cloud Console project with Calendar API enabled 
- OAuth2 credentials (Client ID and Client Secret) 
 
## Setup 
 
Paste Claude "claude_desktop_config.json"
```json
{
  "mcpServers": {
    "zmes-calendar": {
      "command": "npx",
      "args": [
        "-y",
        "@tobedoit/google-calendar-mcp"
      ],
      "env": {
        "GOOGLE_CLIENT_ID": "your_google_client_id",
        "GOOGLE_CLIENT_SECRET": "your_google_client_secret",
        "GOOGLE_REFRESH_TOKEN": "your_google_refresh_token"
      }
    }
  }
}
```
