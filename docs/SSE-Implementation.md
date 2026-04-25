# Server-Side Events (SSE) Implementation

## Overview

Pocket uses Server-Side Events (SSE) for real-time updates from the server to the client. This allows the AI agent to stream responses, status updates, and tool execution results to the user in real-time without polling.

## Architecture

### Server-Side (server/index.js)

The server implements SSE using Node.js `EventEmitter`:

1. **Event Emitter**: Creates a global `EventEmitter` instance for managing session events
2. **SSE Endpoint**: `GET /api/sessions/:sessionId/events` - Establishes the SSE connection
3. **Event Broadcasting**: The `send()` function emits events to connected clients

```javascript
// Server-side event emission
sessionEvents.emit(`event:${sessionId}`, data);
```

### Client-Side (apps/web/src/hooks/usePocket.ts)

The client uses the native `EventSource` API:

1. **Connection Management**: Establishes SSE connection only when a session ID is available
2. **Message Handling**: Parses JSON messages and updates React state
3. **Error Handling**: Automatic reconnection on connection errors
4. **State Management**: Uses explicit `isConnecting` state for accurate UI feedback

## Key Behavior

### Session-Specific Streams

- SSE connections are **session-specific** - each session has its own event stream
- When a session ID is provided in the URL, the client connects to `/api/sessions/:sessionId/events`
- This ensures that each client only receives events relevant to their active session

### No Global Stream

- **The client does NOT connect to a non-existent `/api/sessions/global/events` endpoint**
- When no session ID is available, the client uses polling for the sessions list
- This prevents connection errors and unnecessary network requests

### Hybrid Approach

The client uses a hybrid approach for reliability:

1. **SSE for Real-Time Updates**: Primary mechanism for streaming responses and status updates
2. **Polling for Redundancy**: Periodic polling (every 10 seconds) as a fallback for long-running operations
3. **Visibility Handling**: Reconnects and fetches latest data when the browser tab becomes visible

### State Management

The client maintains three distinct connection states:

| State | Description | UI Impact |
|-------|-------------|-----------|
| `connected` | Successfully connected to SSE stream | No overlay |
| `isConnecting` | Actively attempting SSE connection | Shows "Connecting to Server" overlay |
| `syncing` | Polling for sessions list updates | Subtle "Syncing..." indicator in header |

**Key Behavior:**
- When visiting `/pocket` without a session ID: `isConnecting=false`, no overlay shown
- When resuming a session: `isConnecting=true` during connection attempt
- On connection error: `isConnecting=false`, retry after 2 seconds
- On successful connection: `connected=true`, `isConnecting=false`

This ensures the overlay only appears during actual connection attempts, allowing users to immediately see the setup form when visiting the app.

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
3. EventSource attempts connection
4. On success: overlay disappears, session loads
5. On error: overlay disappears, retry after 2s
```

**Scenario 3: Connection Retries**
```
1. Connection fails
2. isConnecting=false, overlay disappears
3. After 2 seconds: retry triggered
4. isConnecting=true → overlay appears again
5. Connection attempt repeated
```

**Scenario 4: Polling for Sessions**
```
1. No session ID in URL
2. Client fetches sessions list via polling
3. syncing=true → Subtle "Syncing..." indicator appears
4. User can still interact with setup form
```

### Overlay Behavior

The "Connecting to Server" overlay is **only shown** when:
- `isConnecting=true` (actively attempting SSE connection)
- NOT when `connected=false` (which could mean no session ID present)

This prevents the blocking overlay from appearing when users visit `/pocket` without a session ID, allowing them to immediately create a new session or resume an existing one.

## Event Types

The following event types are supported:

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

1. **Mount**: Client connects to SSE if session ID exists in URL, otherwise uses polling
2. **Session Creation**: After creating a session, client receives `session_created` event and reconnects to session-specific stream
3. **Operation**: Real-time updates streamed via SSE
4. **Error**: On connection error, client retries after 2 seconds
5. **Unmount**: Connection is properly closed and cleaned up

## Error Handling

### Server-Side

- Errors are emitted as `error` events to the client
- Session state is updated to reflect error status

### Client-Side

- Connection errors trigger automatic reconnection
- HTTP errors in `fetchSessions` are captured and displayed to the user
- Network errors are handled gracefully with user-friendly messages

## Testing

The SSE implementation includes comprehensive tests:

### Test Coverage

1. **Connection Behavior**
   - No SSE connection when no session ID is provided
   - Session-specific SSE connection when session ID is in URL
   - No attempt to connect to non-existent global stream endpoint

2. **Sessions List Fetching**
   - Sessions list is fetched via polling when no session ID
   - `listSessions()` method works correctly

3. **Error Handling**
   - HTTP errors are captured and displayed
   - Network errors are handled gracefully
   - SSE connection errors trigger reconnection

4. **State Management**
   - `isConnecting` remains false when no session ID
   - `isConnecting` set to true during connection attempts
   - `isConnecting` cleared on successful connection
   - `isConnecting` cleared on connection error
   - `isConnecting` cleared on manual disconnect

### Test Results

```bash
# Run tests
cd apps/web
pnpm test

# Expected: All 44 tests pass (35 existing + 9 new for isConnecting)
```

### Test Coverage Summary

- **Connection Behavior**: 6 tests
- **Sessions List Fetching**: 2 tests
- **Error Handling**: 1 test
- **isConnecting State Management**: 9 tests
  - No connection attempt without session ID
  - Sets isConnecting=true during connection
  - Clears isConnecting on successful connection
  - Clears isConnecting on connection error
  - Clears isConnecting on manual disconnect
  - Sets isConnecting=true on retry attempt after error
- **Total**: 44 tests

### Running Tests

```bash
cd apps/web
pnpm test
```

## Common Issues and Solutions

### Issue: SSE not connecting

**Symptoms**: Updates appear delayed, client falls back to polling

**Solution**: Check that:
1. Session ID is present in the URL
2. Server is running and accessible
3. No CORS issues blocking the connection

### Issue: Events not being received

**Symptoms**: State doesn't update in real-time

**Solution**: Check that:
1. Server is emitting events via `send()` function
2. Client is connected to the correct session-specific stream
3. Event types match what the client expects

### Issue: Connection errors

**Symptoms**: Error messages in console, connection failures

**Solution**: Check that:
1. Server is running on the correct port
2. Network is accessible
3. No firewall or proxy blocking the connection

## Performance Considerations

- **Connection Overhead**: SSE connections are lightweight compared to WebSockets
- **Memory Usage**: Each connected client maintains an open connection
- **Scaling**: For high traffic, consider using a message broker or connection pooling

## Syncing Indicator

When the app is polling for sessions list updates, a subtle indicator appears in the UI:

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
- Initial page load when fetching sessions list
- When user manually refreshes sessions list
- During periodic polling in the background

**When it disappears:**
- When polling request completes
- When user navigates away from the page

## References

- [MDN: Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events)
- [Node.js EventEmitter](https://nodejs.org/api/events.html)
- [EventSource API](https://developer.mozilla.org/en-US/docs/Web/API/EventSource)
