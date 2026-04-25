# Polling Architecture Implementation

## Overview

Pocket uses HTTP polling for real-time updates from the server to the client. This approach replaces the previous Server-Sent Events (SSE) implementation to improve reliability and simplify the architecture.

## Architecture

### Server-Side (server/index.js)

The server provides RESTful endpoints for session management:

1. **Session Endpoints**:
   - `GET /api/sessions` - List all sessions
   - `POST /api/sessions` - Create a new session
   - `GET /api/sessions/:sessionId` - Get session data (used for polling)
   - `POST /api/sessions/:sessionId/*` - Various session operations

2. **State Management**: Session state is stored in memory and persisted to disk

### Client-Side (apps/web/src/hooks/usePocket.ts)

The client uses HTTP polling with a 5-second interval:

1. **Polling Mechanism**: Periodic `fetch` requests to `/api/sessions/:sessionId`
2. **State Updates**: Full session state is fetched and merged into local state
3. **No EventStream**: Removed `EventSource` connection logic

## Key Behavior

### Polling Interval

- **Interval**: 5 seconds (5000ms) across all environments
- **Frequency**: Consistent polling ensures timely updates without overwhelming the server
- **Adjustment**: Can be modified in `usePocket.ts` `startPolling` function

### Session-Specific Polling

- Each session has its own polling interval
- Polling starts when a session ID is available
- Polling stops when the session is disconnected or the component unmounts

### State Management

The client maintains these connection states:

| State | Description | UI Impact |
|-------|-------------|-----------|
| `connected` | Successfully polling session data | No overlay |
| `isConnecting` | Actively starting polling | Shows "Connecting to Server" overlay |
| `syncing` | Polling request in progress | Subtle "Syncing..." indicator in header |

**Key Behavior:**
- When visiting `/pocket` without a session ID: `isConnecting=false`, no overlay shown
- When resuming a session: `isConnecting=true` during initial fetch
- On polling error: `connected=false`, continues polling on next interval
- On successful poll: `connected=true`, `isConnecting=false`

### User Interface States

**Scenario 1: Visiting `/pocket` (No Session ID)**
```
Initial State: connected=false, isConnecting=false, syncing=false
Result: Setup form visible immediately, no overlay
```

**Scenario 2: Resuming a Session**
```
1. User clicks "Resume Session"
2. isConnecting=true → "Connecting to Server" overlay appears
3. Initial session data fetched
4. On success: overlay disappears, session loads, polling starts (5s interval)
5. On error: overlay disappears, polling continues on next interval
```

**Scenario 3: Polling for Updates**
```
1. Session active with polling running
2. Every 5 seconds: fetch session data
3. syncing=true → Subtle "Syncing..." indicator appears briefly
4. State updates when new data is received
5. User can continue interacting with the app
```

## Event Types

The following event types are supported (received via polling):

| Event Type | Description |
|------------|-------------|
| `session_created` | New session created |
| `session_resumed` | Session resumed with full state |
| `session_data` | Session data updates |
| `sessions_list` | List of all sessions |
| `status` | Status changes (cloning, ready, working, etc.) |
| `user_message` | User messages in chat |
| `thinking_start` | AI thinking started |
| `reasoning` | AI reasoning tokens |
| `token` | AI response tokens (streaming) |
| `tool_start` | Tool execution started |
| `tool_result` | Tool execution completed |
| `done` | Task completed (with optional PR URL) |
| `permission_request` | Permission requests for tool execution |
| `error` | Error messages |
| `aborted` | Operation aborted |

## Connection Lifecycle

1. **Mount**: Client checks for session ID in URL
2. **Session Creation**: After creating a session, polling starts for that session
3. **Operation**: Session state fetched every 5 seconds
4. **Error**: On polling error, continues on next interval (no retry delay)
5. **Unmount**: Polling interval is cleared and cleaned up

## Error Handling

### Server-Side

- Errors are stored in session state
- Session status is updated to reflect error state

### Client-Side

- HTTP errors in `fetchSessionData` are captured and displayed to the user
- Network errors are handled gracefully with user-friendly messages
- Polling continues on next interval despite errors

## Performance Considerations

- **Network Overhead**: 5-second polling interval balances freshness with server load
- **Memory Usage**: Each active session maintains a polling interval
- **Scaling**: For high traffic, consider rate limiting or adjusting polling interval

## Syncing Indicator

When the app is polling for session updates, a subtle indicator appears in the UI:

```
┌─────────────────────────────────────────────────────┐
│ Pocket                                             │
│ ┌────────────────────────────────────────────────┐ │
│ │ [●] Syncing...                                │ │
│ └────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

**Properties:**
- **Appearance**: Small blue dot with "Syncing..." text
- **Position**: Next to the Pocket header in the main area
- **Behavior**: Non-blocking, users can still interact with the form
- **Trigger**: Set when `syncing=true` during polling operations
- **Duration**: Appears during the brief polling interval (typically < 1 second)

**When it appears:**
- Initial page load when fetching session data
- During periodic polling in the background

**When it disappears:**
- When polling request completes
- When user navigates away from the page

## Migration from SSE

The following changes were made to migrate from SSE to polling:

1. **Backend**:
   - Removed SSE endpoint (`/api/sessions/:sessionId/events`)
   - Removed `EventEmitter` and `send()` function
   - Removed `ws` and `events` dependencies

2. **Frontend**:
   - Removed `EventSource` connection logic
   - Removed automatic reconnection (2-second delay)
   - Updated polling interval from 10s to 5s
   - Simplified connection state management

3. **Demo**:
   - Removed demo SSE endpoint (`/demo/api/mcp-todos`)
   - Removed demo frontend component (`/demo/mcp-todos`)
   - Removed demo backend logic (`/mcp-todos.ts`)

## References

- [MDN: Fetch API](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API)
- [MDN: setInterval](https://developer.mozilla.org/en-US/docs/Web/API/setInterval)
