## Why

The current live transcript pipeline depends on regex-style PTY text matching to infer whether Claude Code is thinking, printing status chrome, asking for input, or producing durable assistant content. The `test_screenshot` feedback shows this approach is fundamentally brittle: new terminal status variants keep leaking into the conversation and the UI cannot reliably match native Claude Code behavior by guessing from screen text.

## What Changes

- Introduce a structured Claude session event ingestion layer that prefers Claude Code JSON/session/message events over PTY transcript scraping whenever structured data is available.
- Treat structured events as the data source for a Claude Code CLI-like render state, not as one chat bubble per assistant/system/tool event.
- Replace the current message-list transcript model for live sessions with a render-state stream: stable transcript regions, one active assistant stream region, transient status/activity, tool panels, and inline interaction controls.
- Keep native UI status/progress/thinking/model/token/hook state out of visible assistant prose by construction; those events update transient render state only.
- Treat PTY output as an input/interaction transport and degraded fallback path, not as the primary render source or business-semantic classifier.
- Retain bounded PTY fallback normalization only for environments where structured events are unavailable, with explicit degraded-mode visibility.
- **BREAKING** for implementation internals: live UI semantics should come from a CLI-like render state machine driven by structured events; `terminalText.ts` must stop being the authoritative classifier for Claude output.

## Capabilities

### New Capabilities
- `structured-claude-session-events`: Ingest structured Claude Code session/message events as the authoritative source for CLI-like render state.
- `claude-cli-like-render-state`: Render live Claude sessions as a native CLI-style streaming surface instead of an event-by-event chat transcript.

### Modified Capabilities
- `resumable-session-streaming`: Live snapshots/deltas must carry render-state changes driven by structured event sequence semantics when available, with PTY fallback only as degraded compatibility.
- `native-claude-client-experience`: Conversation UI must mimic Claude Code CLI streaming behavior: one active output area updates in place, transient status stays outside prose, and structured events are not displayed one-for-one.
- `claude-transcript-restoration`: Restored JSONL transcript normalization must provide initial render regions compatible with the live CLI-like render state.

## Impact

- Affected backend services: Claude runner/session process integration, realtime hub/render-state reducer, session registry/event persistence, history restoration alignment, PTY fallback normalizer.
- Affected shared contracts: session stream event model should carry CLI-like render regions, active output state, transient activity, tool/action payloads, and degraded PTY fallback state.
- Affected frontend: message rendering should become a CLI-like streaming surface driven by render state, not cleaned terminal prose and not raw structured event bubbles.
- Affected tests: add fixture-driven structured event streams, parity tests against Claude history JSONL/session events, fallback tests, reconnect tests, and mobile browser acceptance tests against `~/test_claude`.
- Dependency/system impact: may require invoking Claude Code with a structured output mode or reading a reliable local session JSONL/event source; implementation must verify the available Claude Code mechanism before coding the adapter.
