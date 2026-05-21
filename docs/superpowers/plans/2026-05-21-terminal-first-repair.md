# Terminal-First Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix duplicate live sessions, terminal slash input focus, and the read-only history transcript UI in the terminal-first flow.

**Architecture:** Keep live sessions terminal-only. Fix duplicate sessions at the tmux discovery boundary, fix slash behavior inside `TerminalView` focus/input handling, and render history with a separate terminal-like read-only transcript component path instead of the live render surface.

**Tech Stack:** TypeScript, React, xterm.js, Fastify, tmux, Vitest, Testing Library.

---

## File Structure

- Modify `src/server/services/tmuxPaneDiscovery.ts` — filter app-owned `webagent-*` tmux sessions out of external discovery.
- Modify `tests/server/tmuxPaneDiscovery.test.ts` — add regression coverage for excluding app-owned tmux sessions while keeping explicitly exposed external panes.
- Modify `src/client/components/TerminalView.tsx` — focus xterm after open/attach and on terminal panel click; keep `/` input flowing through terminal data.
- Modify `tests/client/TerminalView.test.tsx` — extend the xterm mock with `focus()` and assert focus/input behavior.
- Modify `src/client/components/TranscriptView.tsx` — replace `SessionRenderSurface` usage with terminal-like read-only log markup.
- Modify `src/client/styles.css` — add terminal-like history transcript styles.
- Modify `tests/client/ChatViewStream.test.tsx` and/or add `tests/client/TranscriptView.test.tsx` — assert read-only terminal-like history rendering and absence of `structured` labels.

### Task 1: Exclude app-owned tmux sessions from external discovery

**Files:**
- Modify: `tests/server/tmuxPaneDiscovery.test.ts`
- Modify: `src/server/services/tmuxPaneDiscovery.ts`

- [ ] **Step 1: Write the failing test**

Add this test to `tests/server/tmuxPaneDiscovery.test.ts` after `keeps explicitly exposed panes and webagent-marked panes`:

```ts
  it('excludes app-owned webagent tmux sessions from external discovery', () => {
    const panes = parseTmuxPaneList([
      ['%20', 'webagent-session-1', 'claude', 'claude', '/tmp/demo', '1', '/tmp/tmux-1000/default'].join('\t'),
      ['%21', 'main', 'webagent-claude', 'bash', '/tmp/demo', '', '/tmp/tmux-1000/default'].join('\t'),
    ].join('\n'));

    expect(exposedTmuxPanes(panes).map((pane) => pane.paneId)).toEqual(['%21']);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npx vitest run tests/server/tmuxPaneDiscovery.test.ts
```

Expected: FAIL because `%20` is currently included due `exposedFlag === '1'`.

- [ ] **Step 3: Implement the filter**

Update `src/server/services/tmuxPaneDiscovery.ts`:

```ts
export function exposedTmuxPanes(panes: TmuxPane[]): TmuxPane[] {
  return panes.filter((pane) => {
    if (isAppOwnedTmuxSession(pane)) return false;
    if (pane.exposedFlag === '1') return true;
    return [pane.sessionName, pane.windowName, pane.paneTitle]
      .join(' ')
      .toLowerCase()
      .includes('webagent');
  });
}

function isAppOwnedTmuxSession(pane: TmuxPane): boolean {
  return pane.sessionName.startsWith('webagent-');
}
```

- [ ] **Step 4: Run the focused test**

Run:

```bash
npx vitest run tests/server/tmuxPaneDiscovery.test.ts
```

Expected: PASS.

### Task 2: Keep xterm focused and verify slash input

**Files:**
- Modify: `tests/client/TerminalView.test.tsx`
- Modify: `src/client/components/TerminalView.tsx`

- [ ] **Step 1: Extend the xterm mock and write failing assertions**

In `tests/client/TerminalView.test.tsx`, add `focus = vi.fn();` to `MockTerminal`:

```ts
  class MockTerminal {
    open = vi.fn();
    write = vi.fn();
    loadAddon = vi.fn();
    focus = vi.fn();
    dispose = vi.fn();
```

Then add this test after `opens xterm and sends attach with proposed dimensions when the socket opens`:

```ts
  it('focuses xterm after opening, after attach, and when the panel is clicked', async () => {
    render(<TerminalView sessionId="session-1" title="Claude shell" onBack={vi.fn()} />);
    const terminal = xtermMocks.terminalInstances[0];

    expect(terminal.focus).toHaveBeenCalledTimes(1);

    socket.open();
    socket.receive({ type: 'status', sessionId: 'session-1', status: 'attached' });
    await waitFor(() => expect(terminal.focus).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole('region', { name: 'Claude Code terminal' }));

    expect(terminal.focus).toHaveBeenCalledTimes(3);
  });
```

Extend the existing `sends xterm data and mobile shortcut input only after attach is confirmed` test after `terminal.emitData('ls\r');`:

```ts
    terminal.emitData('/');
```

And add this assertion:

```ts
    expect(sendTerminalWs).toHaveBeenCalledWith(socket, { type: 'input', sessionId: 'session-1', data: '/' });
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npx vitest run tests/client/TerminalView.test.tsx
```

Expected: FAIL because `TerminalView` does not call `terminal.focus()` yet.

- [ ] **Step 3: Implement focus behavior**

In `src/client/components/TerminalView.tsx`, after `terminal.open(terminalHost);` add:

```ts
    terminal.focus();
```

In the message handler, update status handling to focus on attach:

```ts
      attachedRef.current = message.status === 'attached';
      setStatus(message.status);
      setStatusMessage(message.message ?? defaultStatusMessage(message.status));
      if (message.status === 'attached') terminal.focus();
```

Update the root section element:

```tsx
    <section className="panel terminal-panel terminal-view" aria-label="Claude Code terminal" onClick={() => terminalRef.current?.focus()}>
```

- [ ] **Step 4: Run the focused test**

Run:

```bash
npx vitest run tests/client/TerminalView.test.tsx
```

Expected: PASS.

### Task 3: Render history as terminal-like read-only log

**Files:**
- Modify: `src/client/components/TranscriptView.tsx`
- Modify: `src/client/styles.css`
- Modify: `tests/client/ChatViewStream.test.tsx`

- [ ] **Step 1: Write the failing history UI test**

In `tests/client/ChatViewStream.test.tsx`, extend the history transcript test with a tool/system-like region and terminal-like assertions. Replace the `transcript={transcriptWindow()}` call with:

```tsx
        transcript={transcriptWindow({
          regions: [
            { id: 'history-1', kind: 'user', text: 'Historical prompt', status: 'final', source: 'history', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
            { id: 'history-2', kind: 'assistant', text: 'Historical response', status: 'final', source: 'history', createdAt: '2026-01-01T00:01:00.000Z', updatedAt: '2026-01-01T00:01:00.000Z' },
            { id: 'history-3', kind: 'tool', text: 'Tool details', status: 'final', source: 'history', createdAt: '2026-01-01T00:02:00.000Z', updatedAt: '2026-01-01T00:02:00.000Z' },
          ],
        })}
```

Then add assertions after the existing history text assertions:

```ts
    expect(screen.getByLabelText('Read-only terminal history')).toBeInTheDocument();
    expect(screen.getByText('$ user')).toBeInTheDocument();
    expect(screen.getByText('assistant')).toBeInTheDocument();
    expect(screen.getByText('[tool]')).toBeInTheDocument();
    expect(screen.queryByText('structured')).not.toBeInTheDocument();
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npx vitest run tests/client/ChatViewStream.test.tsx
```

Expected: FAIL because `TranscriptView` still renders through `SessionRenderSurface`.

- [ ] **Step 3: Implement terminal-like history markup**

Replace `src/client/components/TranscriptView.tsx` with this implementation:

```tsx
import { useEffect, useRef } from 'react';
import type { RenderRegion, TranscriptWindow } from '../../shared/types';

type TranscriptViewProps = {
  transcript: TranscriptWindow;
  loadingOlder: boolean;
  onLoadOlder(): void;
};

export default function TranscriptView({ transcript, loadingOlder, onLoadOlder }: TranscriptViewProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const previousTopRef = useRef<string | null>(null);

  useEffect(() => {
    const scroller = scrollerRef.current;
    const previousTop = previousTopRef.current;
    if (!scroller || !previousTop) return;
    const anchor = scroller.querySelector(`[data-region-id="${CSS.escape(previousTop)}"]`);
    if (anchor instanceof HTMLElement) {
      scroller.scrollTop = anchor.offsetTop;
    }
    previousTopRef.current = null;
  }, [transcript.regions]);

  function handleScroll() {
    const scroller = scrollerRef.current;
    if (!scroller || scroller.scrollTop > 24 || !transcript.hasMoreOlder || loadingOlder) return;
    previousTopRef.current = transcript.regions[0]?.id ?? null;
    onLoadOlder();
  }

  return (
    <div className="transcript-window history-terminal-window" ref={scrollerRef} onScroll={handleScroll} aria-label="Read-only terminal history">
      {transcript.hasMoreOlder ? (
        <button className="secondary-button compact load-older-button" type="button" onClick={onLoadOlder} disabled={loadingOlder}>
          {loadingOlder ? '加载中...' : '加载更早历史'}
        </button>
      ) : null}
      <div className="history-terminal-log">
        {transcript.regions.map((region) => (
          <HistoryTerminalEntry key={region.id} region={region} />
        ))}
      </div>
    </div>
  );
}

function HistoryTerminalEntry({ region }: { region: RenderRegion }) {
  const meta = historyRegionMeta(region);
  return (
    <article className={`history-terminal-entry ${meta.className}`} data-region-id={region.id}>
      <div className="history-terminal-prefix">{meta.prefix}</div>
      <pre className="history-terminal-text">{region.text}</pre>
    </article>
  );
}

function historyRegionMeta(region: RenderRegion): { prefix: string; className: string } {
  if (region.kind === 'user') return { prefix: '$ user', className: 'user' };
  if (region.kind === 'assistant') return { prefix: 'assistant', className: 'assistant' };
  return { prefix: `[${region.kind}]`, className: 'secondary' };
}
```

- [ ] **Step 4: Add terminal-like history styles**

Append this near the existing transcript/message styles in `src/client/styles.css`:

```css
.history-terminal-window {
  background: #0f172a;
  border: 1px solid rgba(148, 163, 184, 0.25);
  color: #e2e8f0;
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
}

.history-terminal-log {
  display: grid;
  gap: 0.75rem;
  padding: 0.85rem;
}

.history-terminal-entry {
  display: grid;
  gap: 0.35rem;
  padding: 0.65rem 0.75rem;
  border-left: 2px solid rgba(148, 163, 184, 0.35);
  background: rgba(15, 23, 42, 0.72);
}

.history-terminal-entry.user {
  border-left-color: #93c5fd;
}

.history-terminal-entry.assistant {
  border-left-color: #86efac;
}

.history-terminal-entry.secondary {
  color: #94a3b8;
}

.history-terminal-prefix {
  color: #38bdf8;
  font-size: 0.72rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.history-terminal-entry.assistant .history-terminal-prefix {
  color: #86efac;
}

.history-terminal-entry.secondary .history-terminal-prefix {
  color: #64748b;
}

.history-terminal-text {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font: inherit;
  line-height: 1.5;
}
```

- [ ] **Step 5: Run the focused test**

Run:

```bash
npx vitest run tests/client/ChatViewStream.test.tsx
```

Expected: PASS.

### Task 4: Regression verification

**Files:**
- No code changes unless verification exposes a failure.

- [ ] **Step 1: Run focused repair tests**

Run:

```bash
npx vitest run tests/server/tmuxPaneDiscovery.test.ts tests/client/TerminalView.test.tsx tests/client/ChatViewStream.test.tsx tests/client/App.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run full tests**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 4: Run build**

Run:

```bash
npm run build
```

Expected: PASS. The existing chunk-size warning is acceptable.

- [ ] **Step 5: Manual browser verification**

Use the already-running dev server or restart with:

```bash
npm run dev
```

Manual checks:

1. Mobile width: create a new session, go back to project list, re-enter `test_claude`; live sessions should not multiply.
2. Open terminal and type `/`; Claude Code should receive slash and display its native command list.
3. Tap a history card body; the transcript should look like a read-only terminal log and should not show `structured`.

## Self-Review

- Spec coverage: duplicate live sessions are covered by Task 1; slash/focus is covered by Task 2; history UI is covered by Task 3; verification is covered by Task 4.
- Placeholder scan: no placeholders or TODOs remain.
- Type consistency: `RenderRegion`, `TranscriptWindow`, `TerminalView`, and `exposedTmuxPanes` names match current code.
- Scope check: plan avoids unrelated cleanup and does not modify `start-prod.sh` or commit.
