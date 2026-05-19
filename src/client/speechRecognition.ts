export type SpeechRecognitionCallbacks = {
  onStart?(): void;
  onInterimResult?(text: string): void;
  onFinalResult?(text: string): void;
  onError?(error: SpeechRecognitionFailure): void;
  onEnd?(): void;
};

export type SpeechRecognitionFailure = {
  code: string;
  message: string;
};

export type SpeechRecognitionSession = {
  start(): void;
  stop(): void;
  abort(): void;
};

type SpeechRecognitionOptions = {
  language?: string;
  win?: SpeechRecognitionWindow;
};

type SpeechRecognitionWindow = Window & typeof globalThis & {
  SpeechRecognition?: BrowserSpeechRecognitionConstructor;
  webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
};

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

type BrowserSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: ((event: Event) => void) | null;
  onresult: ((event: BrowserSpeechRecognitionResultEvent) => void) | null;
  onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null;
  onend: ((event: Event) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

type BrowserSpeechRecognitionResultEvent = Event & {
  resultIndex: number;
  results: BrowserSpeechRecognitionResultList;
};

type BrowserSpeechRecognitionErrorEvent = Event & {
  error: string;
  message?: string;
};

type BrowserSpeechRecognitionResultList = {
  length: number;
  [index: number]: BrowserSpeechRecognitionResult;
};

type BrowserSpeechRecognitionResult = {
  isFinal: boolean;
  length: number;
  [index: number]: BrowserSpeechRecognitionAlternative;
};

type BrowserSpeechRecognitionAlternative = {
  transcript: string;
  confidence?: number;
};

export function isSpeechRecognitionSupported(win: SpeechRecognitionWindow = window as SpeechRecognitionWindow): boolean {
  return Boolean(getSpeechRecognitionConstructor(win));
}

export function createSpeechRecognitionSession(callbacks: SpeechRecognitionCallbacks, options: SpeechRecognitionOptions = {}): SpeechRecognitionSession | null {
  const win = options.win ?? (window as SpeechRecognitionWindow);
  const Recognition = getSpeechRecognitionConstructor(win);
  if (!Recognition) return null;

  const recognition = new Recognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = options.language ?? win.navigator.language;
  recognition.onstart = () => callbacks.onStart?.();
  recognition.onresult = (event) => {
    const { finalText, interimText } = collectSpeechResults(event);
    if (interimText) callbacks.onInterimResult?.(interimText);
    if (finalText) callbacks.onFinalResult?.(finalText);
  };
  recognition.onerror = (event) => {
    callbacks.onError?.({ code: event.error, message: event.message || speechRecognitionErrorMessage(event.error) });
  };
  recognition.onend = () => callbacks.onEnd?.();

  return {
    start: () => recognition.start(),
    stop: () => recognition.stop(),
    abort: () => recognition.abort(),
  };
}

export function speechRecognitionErrorMessage(code: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return '麦克风权限被拒绝，无法使用语音输入。';
    case 'audio-capture':
      return '没有检测到可用麦克风。';
    case 'network':
      return '语音识别网络异常，请稍后重试。';
    case 'no-speech':
      return '没有识别到语音，请按住后再说话。';
    case 'aborted':
      return '语音输入已取消。';
    case 'language-not-supported':
      return '当前语言不支持语音识别。';
    default:
      return '语音识别失败，请重试。';
  }
}

function getSpeechRecognitionConstructor(win: SpeechRecognitionWindow): BrowserSpeechRecognitionConstructor | undefined {
  return win.SpeechRecognition ?? win.webkitSpeechRecognition;
}

function collectSpeechResults(event: BrowserSpeechRecognitionResultEvent): { finalText: string; interimText: string } {
  const finalParts: string[] = [];
  const interimParts: string[] = [];

  for (let index = event.resultIndex; index < event.results.length; index += 1) {
    const result = event.results[index];
    const transcript = result[0]?.transcript?.trim();
    if (!transcript) continue;
    if (result.isFinal) finalParts.push(transcript);
    else interimParts.push(transcript);
  }

  return {
    finalText: finalParts.join(' ').trim(),
    interimText: interimParts.join(' ').trim(),
  };
}
