## 1. Discovery and capability validation

- [x] 1.1 Inspect the installed Claude Code CLI and runtime behavior for supported structured output modes, JSON/stream-json flags, environment variables, local JSONL writes, SDK/API streams, or local session protocols.
- [x] 1.2 Create a small capability fixture or test report that records which structured event sources are available in this environment and their ordering/ID semantics.
- [x] 1.3 Verify whether permission and choice prompts are observable structurally; if not, document the exact PTY-only interaction fallback boundary.
- [x] 1.4 If no structured source can be verified, stop before replacing transcript semantics and report the fallback-only blocker.

## 2. Structured event source adapter

- [x] 2.1 Define the backend `ClaudeEventSource` interface and typed event union for lifecycle, user, assistant, tool, permission/choice, usage/activity, error, and unavailable-source events.
- [x] 2.2 Implement the selected structured source adapter behind feature detection, including schema guards and stable event ordering.
- [x] 2.3 Verify real `stream-json` behavior, including top-level SDK events, `stream_event` partial deltas, thinking/status events, and one-turn `-p` process lifecycle.
- [x] 2.4 Rework the adapter lifecycle so live sessions support Claude Code CLI-like multi-turn streaming without treating `-p` turn completion as a stopped chat session.
- [x] 2.5 Preserve PTY only as input/interaction transport and degraded fallback; PTY output must not create render regions while structured events are active.

## 3. CLI-like render state model

- [x] 3.1 Replace the live `ConversationBlock[]`-first model with shared render-state types: stable regions, active assistant region, transient status/activity, tool panels, interaction controls, source metadata, and sequence.
- [x] 3.2 Implement a server-side render reducer from typed Claude events into render-state snapshots/deltas.
- [x] 3.3 Ensure `system/status`, hook, usage, model/token, thinking, signature, and unknown structured entries never become visible assistant prose or normal chat bubbles.
- [x] 3.4 Add fixture tests proving assistant text streams through one active region and finalizes once.
- [x] 3.5 Add fixture tests proving tool activity and permission/choice controls render as distinct regions/controls, not assistant text.
- [x] 3.6 Add fixture tests proving unknown/control events become transient status or diagnostics only.

## 4. Realtime hub and persistence integration

- [x] 4.1 Update the realtime hub to stream render-state snapshots/deltas instead of raw block-added/block-updated chat events for live structured sessions.
- [x] 4.2 Preserve monotonic sequence/reconnect semantics for render-state snapshots and recovered deltas.
- [x] 4.3 Preserve input ordering and failure guarantees: accepted user input appears before response regions, and failed runner delivery does not mutate render state.
- [x] 4.4 Add degraded fallback state/source metadata before any fallback-derived render content is emitted.
- [x] 4.5 Decide and implement persistence boundaries: durable stable regions can be restored, transient activity is not persisted as transcript history.

## 5. History and resume alignment

- [x] 5.1 Update Claude JSONL history restoration to seed initial render regions compatible with the live render state.
- [x] 5.2 Ensure resuming history sessions appends new live render regions without duplicating restored content.
- [x] 5.3 Keep restored history semantics separate from transient live status so old hook/thinking/control entries are not replayed as messages.

## 6. Client rendering and UX

- [x] 6.1 Replace the live message-bubble rendering path with a Claude Code CLI-like session surface driven by render state.
- [x] 6.2 Render one active assistant output area that updates in place during streaming.
- [x] 6.3 Render transient status/activity separately from transcript content and replace it in place.
- [x] 6.4 Render tool panels and inline permission/choice controls from render metadata, not terminal text matching.
- [x] 6.5 Keep degraded fallback visibly labeled without mixing fallback chrome into structured render content.
- [x] 6.6 Preserve mobile composer reachability, scroll containment, and long-output behavior.

## 7. Verification

- [x] 7.1 Run automated tests covering structured adapter lifecycle, render reducer, realtime ordering/reconnect, fallback boundaries, history resume, reducers, and UI rendering.
- [x] 7.2 Run typecheck and build.
- [x] 7.3 Start the app locally and test mobile UI against `~/test_claude` with a real structured-source session.
- [x] 7.4 Capture browser checks for: CLI-like streaming region updates, no raw assistant/system event bubbles, no spinner/token/model/hook/thinking chrome in prose, inline permission/choice controls, long-output scroll behavior, composer reachability, and reconnect without duplicate regions.
- [x] 7.5 If environment limitations prevent structured-source browser verification, record the blocker and rely on structured fixtures plus explicit degraded fallback verification.
