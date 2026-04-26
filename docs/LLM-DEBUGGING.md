# LLM Debugging Guide

## Overview

Pocket now includes comprehensive debug logging to help diagnose issues with LLM responses.

## Debug Logging

### Server-Side Logs

When the LLM processes a message, the server logs the following to the console:

**LLM Delta Logs** (`[LLM] Delta:`)
```
[LLM] Delta: {
  source: 'llm_delta',
  hasContent: true,
  hasToolCalls: false,
  contentLength: 11,
  toolCallsCount: 0,
  finishReason: 'stop'
}
```

**LLM Complete Logs** (`[LLM] Complete:`)
```
[LLM] Complete: {
  source: 'llm_complete',
  finishReason: 'stop',
  assistantMessageLength: 11,
  hasToolCall: false,
  toolCallName: null
}
```

### Client-Side Debug Messages

Debug logs are also sent to the client via the polling mechanism as `type: 'debug'` messages.

**To view debug messages in the browser:**
1. Open Developer Tools (F12)
2. Go to Console tab
3. Look for messages starting with `[SSE]` or check the network tab for polling responses

## Defensive Coding and Robustness Improvements

To prevent "thinking undefined" issues and ensure tool calls are executed reliably, the following improvements have been added:

### Callback Alignment (index.js)
- Corrected the alignment of arguments passed to `streamChat`. Previously, the reasoning and start-turn callbacks were swapped, which caused the backend to incorrectly handle reasoning tokens and possibly fail when using models that provide them.

### Tool Call Robustness (llm.js)
- **Finish Reason Independence**: The agent now processes tool calls based on their presence in the stream rather than strictly relying on `finish_reason: 'tool_calls'`. This ensures compatibility with models that end the stream with `finish_reason: 'stop'` even when a tool call was provided.
- **Robust Argument Parsing**: Tool argument JSON parsing is now wrapped in try-catch blocks to prevent the entire session from crashing on malformed LLM output.
- **JSON Validation and Fallback**: Before parsing tool arguments, the system validates the JSON structure. If parsing fails, it attempts to extract `path` and `content` using a safe regex pattern.
- **Retry Logic**: Tool calls with malformed JSON are retried up to 3 times before giving up, with each retry logging the attempt.
- **Finalization**: Tool calls are explicitly finalized after the stream ends to ensure no tool calls are missed.

### Server-Side (llm.js)
- `onReasoning()` is only called with valid string values (not undefined, null, or empty string)
- **Error Result Synchronization**: When tool execution fails due to malformed JSON, the error result is now added to the message history so the LLM receives it in the next request. Previously, this caused the session to get stuck in a thinking state because the LLM would retry the same tool call indefinitely.

### Server-Side (index.js)  
- `fullReasoning` only appends chunks that are valid strings (not undefined, null, or empty string)
- **Argument Validation**: The `write_file` tool now validates that `path` and `content` arguments are present before execution

### Server-Side (sessions.js)
- `reasoning` field is only updated with valid string values (not undefined, null, or empty string)

### Client-Side (PocketApp.tsx)
- "Thinking" section only renders if `msg.reasoning` is truthy AND not the string "undefined"

## Malformed JSON Handling

### Overview
When the LLM sends tool call arguments in chunks, the JSON structure can become malformed if chunks are split at character boundaries. The system now includes robust handling for this scenario.

### How It Works
1. **Validation**: Before parsing, the system checks if the accumulated JSON string is valid using `isValidJSON()`
2. **Fallback Extraction**: If JSON is malformed, the system attempts to extract `path` and `content` using a regex pattern: `/"([^"\\]*(?:\\.[^"\\]*)*)"/g`
3. **Retry Logic**: Failed tool calls are retried up to 3 times (per tool call)
4. **File Logging**: Malformed JSON is logged to `server/logs/malformed-json-{timestamp}.log` for debugging
5. **Auto-cleanup**: Log files older than 7 days are automatically deleted

### Log Format
Each malformed JSON log contains:
```json
{
  "timestamp": "2026-04-26T12:15:42.123Z",
  "toolCall": "write_file",
  "rawArguments": "{\"path\": \"test.txt\", \"content\": \"...",
  "error": "Unterminated string in JSON at position 16932"
}
```

### Viewing Malformed JSON Logs
```bash
# View all logs
ls -la server/logs/

# View latest log
tail -n 50 server/logs/malformed-json-*.log | head -100

# Search for specific tool call
grep -l "write_file" server/logs/malformed-json-*.log
```

## Common Scenarios

### 1. LLM Only Returns Tool Calls (No Text)

**Symptoms:**
- User sends "hi" or other conversational message
- Server shows tool calls being executed
- No text response appears in chat

**Debug Check:**
1. Check server logs for `[LLM] Delta:` entries
2. If `hasContent: false` and `hasToolCalls: true`, the LLM is interpreting the message as requiring tools
3. Check the system prompt in `server/llm.js` - it should allow conversational responses

**Solution:**
- The system prompt now explicitly states: "For greetings/conversation: Respond naturally without using tools"
- If issue persists, check the `finishReason` - if it's `tool_calls`, the LLM is stuck in a tool-call loop

### 2. LLM Returns Empty Text Response

**Symptoms:**
- Server shows `[LLM] Complete: assistantMessageLength: 0`
- No text appears in chat even though tool calls completed

**Debug Check:**
1. Check `[LLM] Delta:` logs - if `contentLength: 0`, the LLM isn't sending text content
2. Check `finishReason` - if `stop`, the LLM finished but produced no text
3. This might indicate the LLM only intended to make tool calls

**Solution:**
- Ensure the system prompt encourages text responses for conversational messages
- Check if the LLM is confused by the prompt wording

### 3. Polling Not Showing Updates

**Symptoms:**
- Chat appears "stuck" after sending a message
- No updates appear even after waiting 5+ seconds

**Debug Check:**
1. Check server logs to confirm `processChat()` completed
2. Check client polling logs: `[Poll] Periodic poll triggered`
3. Verify session history is being updated in the database

**Solution:**
- Check `server/sessions.js` to ensure `updateLastHistoryMessage()` is persisting to disk
- Verify the polling interval (currently 5 seconds)

### 4. "Thinking Undefined" Display

**Symptoms:**
- User sees "Thinking" label followed by "undefined" text in the chat UI
- Happens when `msg.reasoning` contains the string "undefined"

**Root Cause:**
JavaScript string concatenation converts `undefined` value to the string "undefined":
```javascript
fullReasoning += chunk;  // If chunk is undefined, fullReasoning becomes "undefined"
```

**Debug Check:**
1. Check saved sessions: `grep -r '"reasoning": "undefined"' server/sessions/`
2. Check server logs for `[LLM] Delta:` to see if LLM is sending unexpected values

**Solution:**
The codebase now includes defensive coding to prevent this:
- `llm.js`: Checks that reasoning values are valid strings before calling `onReasoning()`
- `index.js`: Checks that chunks are valid strings before concatenating to `fullReasoning`
- `sessions.js`: Checks that reasoning is valid before saving to session
- `PocketApp.tsx`: Skips rendering if `msg.reasoning` is the string "undefined"

**Cleanup Existing Sessions:**
If you have sessions with `"reasoning": "undefined"`, clean them with:
```bash
cd server/sessions
sed -i 's/"reasoning": "undefined"/"reasoning": ""/g' *.json
```

### 5. Malformed JSON in Tool Arguments

**Symptoms:**
- Error: `SyntaxError: Unterminated string in JSON at position 16932`
- Tool execution fails with `args.path is undefined`
- Large file writes fail with JSON parsing errors
- **"Stuck message"**: Chat shows thinking bubbles but no progress

**Root Cause:**
When the LLM sends tool call arguments in chunks, the JSON structure can become malformed if chunks are split at character boundaries (e.g., mid-escape sequence).

**Debug Check:**
1. Check server logs for `[LLM] Malformed JSON, attempting fallback extraction`
2. Check for `[Tool] Error parsing arguments for write_file`
3. Look for log files in `server/logs/malformed-json-*.log`
4. Check the error position in the JSON - it often indicates where the chunk was cut off
5. For "stuck message" issue: Check if `onToolCall` with `status: 'error'` or `status: 'retry'` is being called

**Solution:**
The system now includes robust handling:
- **JSON Validation**: Validates JSON before parsing
- **Fallback Extraction**: Attempts to extract `path` and `content` from malformed JSON
- **Retry Logic**: Retries tool calls up to 3 times
- **File Logging**: Logs malformed JSON for debugging
- **Error Result Synchronization**: When tool execution fails, the error result is added to the message history so the LLM receives it in the next request

**Root Cause of "Stuck Message":**
Previously, when the LLM sent a tool call with malformed JSON:
1. The tool execution would fail
2. The error result was NOT added to the message history
3. The LLM would receive the same tool call in the next request (because it didn't know it failed)
4. This created an infinite loop, causing the session to get stuck in a thinking state

**Fix:**
The error result is now added to `allMessages` so the LLM receives it in the next request and can respond appropriately.

**To view malformed JSON logs:**
```bash
# List all logs
ls -la server/logs/

# View latest log
tail -n 100 server/logs/malformed-json-*.log | head -200

# Search for specific tool call
grep -l "write_file" server/logs/malformed-json-*.log | xargs cat
```

**Prevention:**
- Ensure LLM is sending complete JSON chunks
- Check system prompt for clarity on tool argument format
- Monitor for patterns in malformed JSON (e.g., specific content lengths)

## System Prompt Changes

The system prompt in `server/llm.js` now includes explicit rules to prevent infinite tool-call loops:

```
# Interaction Rules
1. For greetings/conversation: Respond naturally without using tools
2. For repository questions: Explore using tools ONCE, then answer based on results
3. Do NOT loop - after exploring, answer the user's question directly
```

## Troubleshooting Steps

1. **Check Server Logs**: Look for `[LLM]` entries in the server console
2. **Check Client Polling**: Look for `[Poll]` entries in browser console
3. **Verify System Prompt**: Ensure the prompt encourages natural conversation
4. **Test with Simple Messages**: Try "hi" or "hello" to verify basic conversation works
5. **Check Debug Messages**: Look for `type: 'debug'` messages in client

## Related Documentation

- [Architecture.md](Architecture.md) - Overall system architecture
- [POLLING-MIGRATION.md](POLLING-MIGRATION.md) - Polling-based architecture details

## Quick Reference: JSON Error Handling

| Error | Cause | Solution |
|-------|-------|----------|
| `Unterminated string in JSON` | LLM sent incomplete JSON | System retries automatically (up to 3 times) |
| `args.path is undefined` | Tool arguments failed to parse | Check `server/logs/malformed-json-*.log` |
| `Fallback extraction failed` | Could not extract path/content | Review LLM output for malformed structure |

**View logs:**
```bash
ls -la server/logs/malformed-json-*.log
cat server/logs/malformed-json-*.log | jq .
```
