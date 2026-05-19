/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import MessageStream from '../../src/client/components/MessageStream';
import type { ConversationBlock, ConversationBlockKind } from '../../src/shared/types';

describe('MessageStream', () => {
  it('renders tool calls collapsed by default', () => {
    const { container } = render(<MessageStream blocks={[block('assistant', '● Bash(npm test)\n ⎿  71 passed')]} />);

    expect(screen.getByText('工具调用 · Bash')).toBeInTheDocument();
    expect(container.querySelector('details.tool-message')).not.toHaveAttribute('open');
  });

  it('renders typed assistant blocks without legacy append-only merging', () => {
    const { container } = render(<MessageStream blocks={[block('assistant', '你好'), block('assistant', '世界', '2')]} />);

    expect(container.querySelectorAll('article.message-bubble.assistant')).toHaveLength(2);
    expect(screen.getByText('你好')).toBeInTheDocument();
    expect(screen.getByText('世界')).toBeInTheDocument();
  });

  it('hides repeated Claude status fragments from the visible transcript', () => {
    const noisy = [
      '* Orbiting...',
      'r',
      'b',
      'rt',
      'bin',
      'tg',
      'n',
      '(ls',
      '*2thinking with xhigh effort',
      'thinking with xhigh effort',
      'thinking with xhigh effort',
      '*3',
      'thinking with xhigh effort',
      '*thinking with xhigh effort',
      'thinking with xhigh effort',
      '4thinking with xhigh effort',
    ].join('\n');

    render(<MessageStream blocks={[block('assistant', noisy)]} />);

    expect(screen.getByText('等待输出')).toBeInTheDocument();
    expect(screen.queryByText(/thinking with xhigh effort/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Orbiting/i)).not.toBeInTheDocument();
  });

  it('keeps assistant reply text and hides inline status redraws', () => {
    const noisy = '✻ Smooshing… (1s ·thinking with xhigh effort ✢…thinking with xhigh effort gthinking with xhigh effort ✽4 ↓ 1 tokens thought for 4s) 你好 ✶ Smooshing… (5s · ↓ 1 tokens · thought for 4s) Smooshing…3 tokens · thought for 4s) running stop hook · 5s · ↓ 26 tokens · thought for 4s) ✽51 ✻Smooshing…101 tokens · thought for 4s) ✶26 ✢66';

    render(<MessageStream blocks={[block('assistant', noisy)]} />);

    expect(screen.getByText('你好')).toBeInTheDocument();
    expect(screen.queryByText(/Smooshing/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/thinking with xhigh effort/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/running stop hook/i)).not.toBeInTheDocument();
  });

  it('hides empty timing fragments left after status cleanup', () => {
    render(<MessageStream blocks={[block('assistant', '(4s · )')]} />);

    expect(screen.getByText('等待输出')).toBeInTheDocument();
    expect(screen.queryByText('(4s · )')).not.toBeInTheDocument();
  });

  it('keeps reply text while hiding Undulating status redraws', () => {
    const noisy = 'anthinking with xhigh effort ✻10s · still ) still still ↓ 你好 Undulating…76 Undulating…38 ██30k/272k (11%, auto@218k) Undulating…13 Undulating…9 Undulating…3 Undulating…3';

    render(<MessageStream blocks={[block('assistant', noisy)]} />);

    expect(screen.getByText('你好')).toBeInTheDocument();
    expect(screen.queryByText(/Undulating/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/thinking with xhigh effort/i)).not.toBeInTheDocument();
  });

  it('keeps reply text while hiding arbitrary English status redraws', () => {
    const noisy = '* Whatchamacalliting… ✢(2s · ) ↓ 你好 * Whatchamacalliting… (5s · ↓ ✽Whhamacalliting… ✻Whatchamacalliting…76 ✢Whatchamacalliting…9 ✶Whatchamacalliting…3 Whatchamacalliting…7 Whatchamacalliting… ✶Whatchamacalliting… Whatchamacalliting… Whatchamacalliting… 10s · ↓ Whatchamacalliting… Whatchamacalliting… Whatchamacalliting… ✶Whatchamacalliting… ✻Crunched for 12s';

    render(<MessageStream blocks={[block('assistant', noisy)]} />);

    expect(screen.getByText('你好')).toBeInTheDocument();
    expect(screen.queryByText(/Whatchamacalliting/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Crunched/i)).not.toBeInTheDocument();
  });

  it('keeps reply text while hiding accented status redraws', () => {
    const noisy = '✶ Sautéing… ✻auéi ✶ég ✢é aé ↓ thought for 5s) 你好 ✻ Sautéing… ( running sp hook· ✶Sautéing…38 Sautéing…13 ✽Sautéing…12 ✶Sautéing…20 ✢Sautéing… ✻Sautéing… Sautéing… Sautéing… Sautéing… Sautéing… Sautéing… Sautéing…';

    render(<MessageStream blocks={[block('assistant', noisy)]} />);

    expect(screen.getByText('你好')).toBeInTheDocument();
    expect(screen.queryByText(/Sautéing/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/thought for/i)).not.toBeInTheDocument();
  });

  it('does not scroll the whole page when messages change', () => {
    const scrollIntoView = vi.mocked(Element.prototype.scrollIntoView);
    scrollIntoView.mockClear();
    const { rerender } = render(<MessageStream blocks={[block('assistant', 'hello')]} />);

    rerender(<MessageStream blocks={[block('assistant', 'hello'), block('assistant', 'world', '2')]} />);

    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});

function block(kind: ConversationBlockKind, text: string, id = '1'): ConversationBlock {
  return {
    id,
    sessionId: 'session-1',
    kind,
    text,
    sequence: Number(id),
    status: 'final',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    source: 'live',
  };
}
