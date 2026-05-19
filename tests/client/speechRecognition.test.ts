import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSpeechRecognitionSession, isSpeechRecognitionSupported } from '../../src/client/speechRecognition';

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
type MockWindow = Window & typeof globalThis & {
  SpeechRecognition?: typeof MockSpeechRecognition;
  webkitSpeechRecognition?: typeof MockSpeechRecognition;
};

function mockWindow(overrides: Partial<MockWindow> = {}): MockWindow {
  return {
    navigator: { language: 'zh-CN' },
    ...overrides,
  } as MockWindow;
}

function toResultList(results: MockResult[]): BrowserLikeResultList {
  const list = { length: results.length } as BrowserLikeResultList;
  results.forEach((result, index) => {
    list[index] = { isFinal: result.isFinal, length: 1, 0: { transcript: result.transcript, confidence: 0.9 } };
  });
  return list;
}

describe('speech recognition adapter', () => {
  beforeEach(() => {
    MockSpeechRecognition.instances = [];
  });

  it('detects unprefixed and webkit speech recognition support', () => {
    expect(isSpeechRecognitionSupported(mockWindow())).toBe(false);
    expect(isSpeechRecognitionSupported(mockWindow({ SpeechRecognition: MockSpeechRecognition }))).toBe(true);
    expect(isSpeechRecognitionSupported(mockWindow({ webkitSpeechRecognition: MockSpeechRecognition }))).toBe(true);
  });

  it('configures continuous dictation, interim results, and navigator language', () => {
    const session = createSpeechRecognitionSession({}, { win: mockWindow({ SpeechRecognition: MockSpeechRecognition }) });

    expect(session).not.toBeNull();
    const recognition = MockSpeechRecognition.instances[0];
    expect(recognition.continuous).toBe(true);
    expect(recognition.interimResults).toBe(true);
    expect(recognition.lang).toBe('zh-CN');
  });

  it('allows language override without creating audio blobs', () => {
    const session = createSpeechRecognitionSession({}, { win: mockWindow({ SpeechRecognition: MockSpeechRecognition }), language: 'en-US' });

    expect(session).not.toBeNull();
    expect(MockSpeechRecognition.instances[0].lang).toBe('en-US');
  });

  it('emits start, interim result, final result, and end callbacks', () => {
    const onStart = vi.fn();
    const onInterimResult = vi.fn();
    const onFinalResult = vi.fn();
    const onEnd = vi.fn();
    const session = createSpeechRecognitionSession(
      { onStart, onInterimResult, onFinalResult, onEnd },
      { win: mockWindow({ SpeechRecognition: MockSpeechRecognition }) },
    );

    session?.start();
    MockSpeechRecognition.instances[0].emitResult([
      { transcript: '  正在说 ', isFinal: false },
      { transcript: ' 完成了 ', isFinal: true },
    ]);
    session?.stop();

    expect(onStart).toHaveBeenCalledOnce();
    expect(onInterimResult).toHaveBeenCalledWith('正在说');
    expect(onFinalResult).toHaveBeenCalledWith('完成了');
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it('starts collecting results at the event resultIndex', () => {
    const onFinalResult = vi.fn();
    const session = createSpeechRecognitionSession(
      { onFinalResult },
      { win: mockWindow({ SpeechRecognition: MockSpeechRecognition }) },
    );

    session?.start();
    MockSpeechRecognition.instances[0].emitResult([
      { transcript: '旧结果', isFinal: true },
      { transcript: '新结果', isFinal: true },
    ], 1);

    expect(onFinalResult).toHaveBeenCalledWith('新结果');
  });

  it('exposes abort and error callbacks', () => {
    const onError = vi.fn();
    const onEnd = vi.fn();
    const session = createSpeechRecognitionSession(
      { onError, onEnd },
      { win: mockWindow({ SpeechRecognition: MockSpeechRecognition }) },
    );

    session?.start();
    MockSpeechRecognition.instances[0].emitError('not-allowed');
    session?.abort();

    expect(onError).toHaveBeenCalledWith({ code: 'not-allowed', message: '麦克风权限被拒绝，无法使用语音输入。' });
    expect(MockSpeechRecognition.instances[0].abort).toHaveBeenCalledOnce();
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it('returns null when speech recognition is unsupported', () => {
    expect(createSpeechRecognitionSession({}, { win: mockWindow() })).toBeNull();
  });
});
