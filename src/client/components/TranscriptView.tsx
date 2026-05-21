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
  const openedTranscriptRef = useRef<string | null>(null);

  useEffect(() => {
    const scroller = scrollerRef.current;
    const previousTop = previousTopRef.current;
    if (!scroller) return;
    if (previousTop) {
      const anchor = scroller.querySelector(`[data-region-id="${CSS.escape(previousTop)}"]`);
      if (anchor instanceof HTMLElement) {
        scroller.scrollTop = anchor.offsetTop;
      }
      previousTopRef.current = null;
      return;
    }
    if (openedTranscriptRef.current === transcript.sessionId) return;
    openedTranscriptRef.current = transcript.sessionId;
    const latest = transcript.regions.at(-1);
    if (!latest) return;
    const latestEntry = scroller.querySelector(`[data-region-id="${CSS.escape(latest.id)}"]`);
    if (latestEntry instanceof HTMLElement) {
      latestEntry.scrollIntoView({ block: 'end' });
    }
  }, [transcript.regions, transcript.sessionId]);

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
