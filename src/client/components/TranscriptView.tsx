import { useEffect, useRef } from 'react';
import type { TranscriptWindow } from '../../shared/types';
import SessionRenderSurface from './SessionRenderSurface';

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
    <div className="transcript-window" ref={scrollerRef} onScroll={handleScroll}>
      {transcript.hasMoreOlder ? (
        <button className="secondary-button compact load-older-button" type="button" onClick={onLoadOlder} disabled={loadingOlder}>
          {loadingOlder ? '加载中...' : '加载更早历史'}
        </button>
      ) : null}
      <SessionRenderSurface
        render={{
          sessionId: transcript.sessionId,
          regions: transcript.regions,
          activeRegion: null,
          transientStatus: { activity: 'stopped' },
          diagnostics: [],
          transcriptSource: 'structured',
          sequence: 0,
        }}
        disabled
        onAction={() => undefined}
      />
    </div>
  );
}
