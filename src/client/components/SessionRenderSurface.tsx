import type { SessionRenderState, RenderRegion } from '../../shared/types';
import PromptActions from './PromptActions';

type SessionRenderSurfaceProps = {
  render: SessionRenderState;
  disabled: boolean;
  onAction(actionId: string): void;
};

export default function SessionRenderSurface({ render, disabled, onAction }: SessionRenderSurfaceProps) {
  const visibleRegions = render.activeRegion ? [...render.regions, render.activeRegion] : render.regions;

  return (
    <div className="cli-render-surface" aria-live="polite" data-render-source={render.transcriptSource}>
      <div className="cli-transient-status" role="status">
        {statusLabel(render)}
      </div>
      {visibleRegions.length === 0 ? (
        <div className="empty-chat">
          <p className="eyebrow">已连接</p>
          <h3>等待输出</h3>
          <p className="muted">在下方输入消息，或等待 Claude Code 输出下一段内容。</p>
        </div>
      ) : visibleRegions.map((region) => <RenderRegionView key={region.id} region={region} disabled={disabled} onAction={onAction} />)}
    </div>
  );
}

function RenderRegionView({ region, disabled, onAction }: { region: RenderRegion; disabled: boolean; onAction(actionId: string): void }) {
  if (region.kind === 'interaction' && region.interaction) {
    return (
      <section className="cli-region interaction" data-region-id={region.id} data-render-kind="interaction" data-render-status={region.status}>
        <pre>{region.text}</pre>
        <PromptActions interaction={region.interaction} disabled={disabled} onAction={onAction} />
      </section>
    );
  }

  if (region.kind === 'tool' || region.kind === 'system') {
    const title = collapsedRegionTitle(region.kind, region.text);
    return (
      <details className={`cli-region ${region.kind} tool-message`} data-region-id={region.id} data-render-kind={region.kind} data-render-status={region.status}>
        <summary>{title}</summary>
        <pre>{region.text}</pre>
      </details>
    );
  }

  const className = region.kind === 'user' ? 'cli-region user user-message' : `cli-region ${region.kind}`;
  return (
    <section className={className} data-region-id={region.id} data-render-kind={region.kind} data-render-status={region.status}>
      <pre>{region.text}</pre>
    </section>
  );
}

function statusLabel(render: SessionRenderState): string {
  if (render.transientStatus.label) return render.transientStatus.label;
  if (render.activeRegion?.status === 'streaming') return 'Claude 正在输出…';
  if (render.transientStatus.activity === 'working') return 'Claude 正在处理…';
  if (render.transcriptSource === 'pty-fallback') return 'PTY fallback';
  return 'structured';
}

function collapsedRegionTitle(kind: RenderRegion['kind'], text: string): string {
  const first = text.split(/\r?\n/)[0]?.trim();
  if (kind === 'tool') return first ? `工具调用 · ${first}` : '工具调用';
  if (kind === 'system') return first ? `系统信息 · ${first}` : '系统信息';
  return first || kind;
}
