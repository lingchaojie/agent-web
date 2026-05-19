export const assistantStreamJsonLines = [
  JSON.stringify({ type: 'system', subtype: 'init', session_id: 'claude-session-1', uuid: 'event-1' }),
  JSON.stringify({ type: 'stream_event', session_id: 'claude-session-1', uuid: 'event-2', event: { type: 'message_start', message: { id: 'msg-1', role: 'assistant' } } }),
  JSON.stringify({ type: 'stream_event', session_id: 'claude-session-1', uuid: 'event-3', event: { type: 'content_block_start', index: 0, content_block: { type: 'text' } } }),
  JSON.stringify({ type: 'stream_event', session_id: 'claude-session-1', uuid: 'event-4', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } } }),
  JSON.stringify({ type: 'stream_event', session_id: 'claude-session-1', uuid: 'event-5', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' structured' } } }),
  JSON.stringify({ type: 'stream_event', session_id: 'claude-session-1', uuid: 'event-6', event: { type: 'content_block_stop', index: 0 } }),
  JSON.stringify({ type: 'stream_event', session_id: 'claude-session-1', uuid: 'event-7', event: { type: 'message_stop' } }),
];

export const toolStreamJsonLines = [
  JSON.stringify({ type: 'stream_event', session_id: 'claude-session-1', uuid: 'tool-event-1', event: { type: 'message_start', message: { id: 'msg-tool', role: 'assistant' } } }),
  JSON.stringify({ type: 'stream_event', session_id: 'claude-session-1', uuid: 'tool-event-2', event: { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tool-1', name: 'Bash' } } }),
  JSON.stringify({ type: 'stream_event', session_id: 'claude-session-1', uuid: 'tool-event-3', event: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"command":"npm' } } }),
  JSON.stringify({ type: 'stream_event', session_id: 'claude-session-1', uuid: 'tool-event-4', event: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: ' test"}' } } }),
  JSON.stringify({ type: 'stream_event', session_id: 'claude-session-1', uuid: 'tool-event-5', event: { type: 'content_block_stop', index: 0 } }),
];

export const toolResultJsonlEntry = {
  type: 'user',
  uuid: 'tool-result-1',
  timestamp: '2026-01-01T00:00:00.000Z',
  message: {
    role: 'user',
    content: [{ type: 'tool_result', content: 'tests passed' }],
  },
};

export const activityStreamJsonLines = [
  JSON.stringify({ type: 'system', subtype: 'hook_started', session_id: 'claude-session-1', uuid: 'activity-event-1' }),
  JSON.stringify({ type: 'stream_event', session_id: 'claude-session-1', uuid: 'activity-event-2', event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } } }),
  JSON.stringify({ type: 'stream_event', session_id: 'claude-session-1', uuid: 'activity-event-3', event: { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { input_tokens: 2, output_tokens: 3 } } }),
];

export const transientThinkingStreamJsonLines = [
  JSON.stringify({ type: 'system', subtype: 'status', status: 'requesting', session_id: 'claude-session-1', uuid: 'thinking-event-1' }),
  JSON.stringify({ type: 'stream_event', session_id: 'claude-session-1', uuid: 'thinking-event-2', event: { type: 'message_start', message: { id: 'msg-thinking', role: 'assistant' } } }),
  JSON.stringify({ type: 'stream_event', session_id: 'claude-session-1', uuid: 'thinking-event-3', event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } } }),
  JSON.stringify({ type: 'stream_event', session_id: 'claude-session-1', uuid: 'thinking-event-4', event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'internal reasoning' } } }),
  JSON.stringify({ type: 'stream_event', session_id: 'claude-session-1', uuid: 'thinking-event-5', event: { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'signed' } } }),
  JSON.stringify({ type: 'assistant', session_id: 'claude-session-1', uuid: 'thinking-event-6', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'internal reasoning', signature: 'signed' }] } }),
  JSON.stringify({ type: 'stream_event', session_id: 'claude-session-1', uuid: 'thinking-event-7', event: { type: 'content_block_stop', index: 0 } }),
  JSON.stringify({ type: 'stream_event', session_id: 'claude-session-1', uuid: 'thinking-event-8', event: { type: 'content_block_start', index: 1, content_block: { type: 'text' } } }),
  JSON.stringify({ type: 'stream_event', session_id: 'claude-session-1', uuid: 'thinking-event-9', event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'visible answer' } } }),
  JSON.stringify({ type: 'stream_event', session_id: 'claude-session-1', uuid: 'thinking-event-10', event: { type: 'content_block_stop', index: 1 } }),
];

export const lifecycleStreamJsonLines = [
  JSON.stringify({ type: 'system', subtype: 'init', session_id: 'claude-session-1', uuid: 'lifecycle-event-1' }),
  JSON.stringify({ type: 'result', session_id: 'claude-session-1', uuid: 'lifecycle-event-2', result: 'done', is_error: false }),
  JSON.stringify({ type: 'result', session_id: 'claude-session-1', uuid: 'lifecycle-event-3', result: 'failed', is_error: true }),
];

export const immediateNativeSessionIdLine = JSON.stringify({ type: 'system', subtype: 'init', session_id: 'native-session-immediate', uuid: 'identity-event-1' });

export const delayedNativeSessionIdLines = [
  JSON.stringify({ type: 'stream_event', uuid: 'identity-event-2', event: { type: 'message_start', message: { id: 'msg-identity', role: 'assistant' } } }),
  JSON.stringify({ type: 'result', session_id: 'native-session-delayed', uuid: 'identity-event-3', result: 'done', is_error: false }),
];

export const unknownStreamJsonLine = JSON.stringify({ type: 'future_event', session_id: 'claude-session-1', uuid: 'unknown-1', payload: { text: 'do not render as assistant' } });

export const permissionFallbackBoundary = {
  structuralPermissionEvents: false,
  fallback: 'PTY interaction parsing is only allowed for permission or choice prompts not represented by stream-json events; PTY chrome must not create transcript blocks while structured events are active.',
};

export const permissionPromptFixture = {
  source: 'pty-interaction',
  raw: 'Claude wants to run Bash\n1. Allow once\n2. Deny',
  actions: ['Allow once', 'Deny'],
};
