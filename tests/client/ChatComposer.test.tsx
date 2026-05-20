/** @vitest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ChatComposer from '../../src/client/components/ChatComposer';
import type { HistorySession, SlashCommandEntry } from '../../src/shared/types';

class MockSpeechRecognition {
  static instances: MockSpeechRecognition[] = [];

  continuous = false;
  interimResults = false;
  lang = '';
  onstart: ((event: Event) => void) | null = null;
  onresult: ((event: Event & { resultIndex: number; results: BrowserLikeResultList }) => void) | null = null;
  onerror: ((event: Event & { error: string; message?: string }) => void) | null = null;
  onend: ((event: Event) => void) | null = null;
  start = vi.fn(() => this.onstart?.(new Event('start')));
  stop = vi.fn(() => this.onend?.(new Event('end')));
  abort = vi.fn(() => this.onend?.(new Event('end')));

  constructor() {
    MockSpeechRecognition.instances.push(this);
  }

  emitResult(results: MockResult[], resultIndex = 0) {
    this.onresult?.(Object.assign(new Event('result'), { resultIndex, results: toResultList(results) }));
  }

  emitError(error: string, message?: string) {
    this.onerror?.(Object.assign(new Event('error'), { error, message }));
  }
}

type MockResult = { transcript: string; isFinal: boolean };
type BrowserLikeResult = { isFinal: boolean; length: number; [index: number]: { transcript: string; confidence?: number } };
type BrowserLikeResultList = { length: number; [index: number]: BrowserLikeResult };

type SpeechWindow = Window & typeof globalThis & {
  SpeechRecognition?: typeof MockSpeechRecognition;
  webkitSpeechRecognition?: typeof MockSpeechRecognition;
};

const originalSpeechRecognition = (window as SpeechWindow).SpeechRecognition;
const originalWebkitSpeechRecognition = (window as SpeechWindow).webkitSpeechRecognition;

function toResultList(results: MockResult[]): BrowserLikeResultList {
  const list = { length: results.length } as BrowserLikeResultList;
  results.forEach((result, index) => {
    list[index] = { isFinal: result.isFinal, length: 1, 0: { transcript: result.transcript, confidence: 0.9 } };
  });
  return list;
}

function renderComposer(overrides: Partial<Parameters<typeof ChatComposer>[0]> = {}) {
  const props = {
    value: '',
    disabled: false,
    commandEntries: [] as SlashCommandEntry[],
    resumeCandidates: [] as HistorySession[],
    onChange: vi.fn(),
    onSubmit: vi.fn(),
    onOpenHistorySession: vi.fn(),
    ...overrides,
  };
  const view = render(<ChatComposer {...props} />);
  return { ...view, props };
}

function enableSpeechRecognition() {
  (window as SpeechWindow).SpeechRecognition = MockSpeechRecognition;
}

function disableSpeechRecognition() {
  delete (window as SpeechWindow).SpeechRecognition;
  delete (window as SpeechWindow).webkitSpeechRecognition;
}

const slashCommands: SlashCommandEntry[] = [
  { name: '/deploy', title: 'Deploy', description: 'Ship the selected service', scope: 'project', behavior: 'prompt-insert', support: 'supported', aliases: [] },
];

describe('ChatComposer speech input', () => {
  beforeEach(() => {
    MockSpeechRecognition.instances = [];
    disableSpeechRecognition();
    vi.clearAllMocks();
  });

  afterAll(() => {
    (window as SpeechWindow).SpeechRecognition = originalSpeechRecognition;
    (window as SpeechWindow).webkitSpeechRecognition = originalWebkitSpeechRecognition;
  });

  it('switches voice and text modes while preserving typed text', () => {
    enableSpeechRecognition();
    renderComposer({ value: '已有输入' });

    fireEvent.click(screen.getByRole('button', { name: '切换到语音输入' }));
    expect(screen.getByText('当前输入：已有输入')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '切换到键盘输入' }));
    expect(screen.getByPlaceholderText('输入要发送给 Claude Code 的内容...')).toHaveValue('已有输入');
  });

  it('starts on hold, stops on release, and inserts finalized text', () => {
    enableSpeechRecognition();
    const { props } = renderComposer({ value: '请帮我' });

    fireEvent.click(screen.getByRole('button', { name: '切换到语音输入' }));
    const holdButton = screen.getByRole('button', { name: '按住说话' });
    fireEvent.pointerDown(holdButton, { pointerId: 1 });
    act(() => MockSpeechRecognition.instances[0].emitResult([{ transcript: '写测试', isFinal: true }]));
    fireEvent.pointerUp(holdButton, { pointerId: 1 });

    expect(MockSpeechRecognition.instances[0].start).toHaveBeenCalledOnce();
    expect(MockSpeechRecognition.instances[0].stop).toHaveBeenCalledOnce();
    expect(props.onChange).toHaveBeenCalledWith('请帮我 写测试');
  });

  it('previews interim text without submitting and only sends after explicit submit', () => {
    enableSpeechRecognition();
    const { props, rerender } = renderComposer({ value: '' });

    fireEvent.click(screen.getByRole('button', { name: '切换到语音输入' }));
    const holdButton = screen.getByRole('button', { name: '按住说话' });
    fireEvent.pointerDown(holdButton, { pointerId: 1 });
    act(() => MockSpeechRecognition.instances[0].emitResult([{ transcript: '临时文字', isFinal: false }]));

    expect(screen.getByText('正在识别：临时文字')).toBeInTheDocument();
    expect(props.onChange).not.toHaveBeenCalled();
    expect(props.onSubmit).not.toHaveBeenCalled();

    act(() => MockSpeechRecognition.instances[0].emitResult([{ transcript: '最终文字', isFinal: true }]));
    fireEvent.pointerUp(holdButton, { pointerId: 1 });
    expect(props.onChange).toHaveBeenCalledWith('最终文字');
    expect(props.onSubmit).not.toHaveBeenCalled();

    rerender(<ChatComposer {...props} value="最终文字" />);
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    expect(props.onSubmit).toHaveBeenCalledOnce();
  });

  it('cancels a hold without inserting interim or final text', () => {
    enableSpeechRecognition();
    const { props } = renderComposer({ value: '原文' });

    fireEvent.click(screen.getByRole('button', { name: '切换到语音输入' }));
    const holdButton = screen.getByRole('button', { name: '按住说话' });
    fireEvent.pointerDown(holdButton, { pointerId: 1 });
    act(() => MockSpeechRecognition.instances[0].emitResult([
      { transcript: '不要插入', isFinal: false },
      { transcript: '也不要插入', isFinal: true },
    ]));
    fireEvent.pointerCancel(holdButton, { pointerId: 1 });

    expect(MockSpeechRecognition.instances[0].abort).toHaveBeenCalledOnce();
    expect(props.onChange).not.toHaveBeenCalled();
    expect(screen.getByText('语音输入已取消。')).toBeInTheDocument();
  });

  it('shows unsupported state and leaves text input available', () => {
    renderComposer({ value: '还能打字' });

    fireEvent.click(screen.getByRole('button', { name: '切换到语音输入' }));
    expect(screen.getByText('此浏览器暂不支持语音输入，请继续使用键盘输入。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '按住说话' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: '切换到键盘输入' }));
    expect(screen.getByPlaceholderText('输入要发送给 Claude Code 的内容...')).toHaveValue('还能打字');
  });

  it('shows permission errors and allows retrying after failure', () => {
    enableSpeechRecognition();
    const { props } = renderComposer();

    fireEvent.click(screen.getByRole('button', { name: '切换到语音输入' }));
    const holdButton = screen.getByRole('button', { name: '按住说话' });
    fireEvent.pointerDown(holdButton, { pointerId: 1 });
    act(() => MockSpeechRecognition.instances[0].emitError('not-allowed'));

    expect(screen.getByText('麦克风权限被拒绝，无法使用语音输入。')).toBeInTheDocument();
    expect(props.onChange).not.toHaveBeenCalled();

    fireEvent.pointerDown(screen.getByRole('button', { name: '按住说话' }), { pointerId: 2 });
    expect(MockSpeechRecognition.instances).toHaveLength(2);
  });

  it('keeps normal typing, send, and slash-command suggestions working', () => {
    const { props, rerender } = renderComposer({ commandEntries: slashCommands });

    const textarea = screen.getByPlaceholderText('输入要发送给 Claude Code 的内容...');
    fireEvent.change(textarea, { target: { value: '/d' } });
    expect(props.onChange).toHaveBeenCalledWith('/d');

    rerender(<ChatComposer {...props} value="/d" />);
    expect(screen.getByRole('listbox', { name: 'Slash commands' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByPlaceholderText('输入要发送给 Claude Code 的内容...'), { key: 'Enter' });
    expect(props.onChange).toHaveBeenCalledWith('/deploy ');

    rerender(<ChatComposer {...props} value="hello" />);
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    expect(props.onSubmit).toHaveBeenCalledOnce();
  });

  it('disables voice controls when the composer is disabled', () => {
    enableSpeechRecognition();
    renderComposer({ disabled: true });

    expect(screen.getByRole('button', { name: '切换到语音输入' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled();
  });
});
