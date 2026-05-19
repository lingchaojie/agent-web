import type { KeyboardEvent, PointerEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { HistorySession, SlashCommandEntry } from '../../shared/types';
import { createSpeechRecognitionSession, isSpeechRecognitionSupported, type SpeechRecognitionFailure, type SpeechRecognitionSession } from '../speechRecognition';
import { detectSlashCommandQuery, firstEnabledMatchIndex, isEnabled, matchSlashCommands, nextActiveMatchIndex } from '../slashCommands';

type ChatComposerProps = {
  value: string;
  disabled: boolean;
  commandEntries: SlashCommandEntry[];
  resumeCandidates: HistorySession[];
  onChange(value: string): void;
  onSubmit(): void;
  onOpenHistorySession?(session: HistorySession): void;
};

type ComposerMode = 'text' | 'voice';
type VoiceState = 'idle' | 'listening' | 'transcribing' | 'unavailable' | 'error';

export default function ChatComposer({ value, disabled, commandEntries, resumeCandidates, onChange, onSubmit, onOpenHistorySession }: ChatComposerProps) {
  const query = detectSlashCommandQuery(value);
  const matches = useMemo(() => query ? matchSlashCommands(commandEntries, query.query) : [], [commandEntries, query?.query]);
  const speechAvailable = useMemo(() => isSpeechRecognitionSupported(), []);
  const [activeIndex, setActiveIndex] = useState(0);
  const [resumeOpen, setResumeOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [mode, setMode] = useState<ComposerMode>('text');
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [voiceMessage, setVoiceMessage] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const valueRef = useRef(value);
  const speechSessionRef = useRef<SpeechRecognitionSession | null>(null);
  const activeHoldRef = useRef(false);
  const finishingHoldRef = useRef(false);
  const cancelledHoldRef = useRef(false);
  const failedHoldRef = useRef(false);
  const holdFinalPartsRef = useRef<string[]>([]);
  const enabledIndex = firstEnabledMatchIndex(matches);
  const selectedIndex = matches[activeIndex] && isSelectable(matches[activeIndex].entry) ? activeIndex : enabledIndex;
  const open = Boolean(mode === 'text' && query && matches.length > 0 && !resumeOpen);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => () => {
    speechSessionRef.current?.abort();
  }, []);

  useEffect(() => {
    if (disabled && activeHoldRef.current) cancelVoiceHold();
  }, [disabled]);

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      onChange(value);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = nextActiveMatchIndex(matches, selectedIndex, event.key === 'ArrowDown' ? 1 : -1);
      if (next >= 0) setActiveIndex(next);
      return;
    }
    if (event.key === 'Tab' || event.key === 'Enter') {
      const selected = selectedIndex >= 0 ? matches[selectedIndex] : matches[0] ?? null;
      if (!selected) return;
      event.preventDefault();
      acceptCommand(selected.entry);
    }
  }

  function acceptCommand(entry: SlashCommandEntry) {
    if (entry.behavior === 'unsupported' || entry.support === 'unsupported') {
      setNotice('此命令当前不能在 Web 客户端执行。');
      return;
    }
    setNotice('');
    if (entry.name === '/resume' && entry.behavior === 'app-owned') {
      setResumeOpen(true);
      return;
    }
    if (entry.behavior === 'prompt-insert') onChange(`${entry.name} `);
  }

  function acceptResumeCandidate(candidate: HistorySession) {
    onOpenHistorySession?.(candidate);
    setResumeOpen(false);
    onChange('');
  }

  function handleSubmit(event: { preventDefault(): void }) {
    event.preventDefault();
    const exactMatch = matches.find((match) => match.entry.name === value.trim());
    if (exactMatch?.entry.behavior === 'unsupported' || exactMatch?.entry.support === 'unsupported') {
      acceptCommand(exactMatch.entry);
      return;
    }
    onSubmit();
  }

  function switchMode(nextMode: ComposerMode) {
    if (mode === nextMode) return;
    if (nextMode === 'text') {
      cancelVoiceHold('');
      setMode('text');
      setVoiceState('idle');
      setVoiceMessage('');
      setInterimTranscript('');
      return;
    }
    setNotice('');
    setResumeOpen(false);
    setMode('voice');
    setInterimTranscript('');
    if (!speechAvailable) {
      setVoiceState('unavailable');
      setVoiceMessage('此浏览器暂不支持语音输入，请继续使用键盘输入。');
    } else {
      setVoiceState('idle');
      setVoiceMessage('按住按钮开始说话，松开后文字会进入输入框。');
    }
  }

  function startVoiceHold() {
    if (disabled) return;
    if (!speechAvailable) {
      setVoiceState('unavailable');
      setVoiceMessage('此浏览器暂不支持语音输入，请继续使用键盘输入。');
      return;
    }
    if (activeHoldRef.current || speechSessionRef.current) return;

    activeHoldRef.current = true;
    finishingHoldRef.current = false;
    cancelledHoldRef.current = false;
    failedHoldRef.current = false;
    holdFinalPartsRef.current = [];
    setInterimTranscript('');
    setVoiceMessage('正在听，请按住继续说话。');
    setVoiceState('listening');

    const session = createSpeechRecognitionSession({
      onStart: () => {
        setVoiceState('listening');
        setVoiceMessage('正在听，请按住继续说话。');
      },
      onInterimResult: (text) => {
        setInterimTranscript(text);
        setVoiceState('listening');
      },
      onFinalResult: (text) => {
        holdFinalPartsRef.current.push(text);
        setInterimTranscript('');
        if (finishingHoldRef.current) setVoiceState('transcribing');
      },
      onError: handleVoiceError,
      onEnd: handleVoiceEnd,
    });

    if (!session) {
      activeHoldRef.current = false;
      setVoiceState('unavailable');
      setVoiceMessage('此浏览器暂不支持语音输入，请继续使用键盘输入。');
      return;
    }

    speechSessionRef.current = session;
    try {
      session.start();
    } catch {
      failedHoldRef.current = true;
      activeHoldRef.current = false;
      speechSessionRef.current = null;
      holdFinalPartsRef.current = [];
      setInterimTranscript('');
      setVoiceState('error');
      setVoiceMessage('语音输入启动失败，请检查麦克风权限后重试。');
    }
  }

  function finishVoiceHold() {
    if (!activeHoldRef.current || !speechSessionRef.current || cancelledHoldRef.current) return;
    finishingHoldRef.current = true;
    setVoiceState('transcribing');
    setVoiceMessage('正在转文字…');
    speechSessionRef.current.stop();
  }

  function cancelVoiceHold(message = '语音输入已取消。') {
    if (!activeHoldRef.current && !speechSessionRef.current) return;
    cancelledHoldRef.current = true;
    activeHoldRef.current = false;
    finishingHoldRef.current = false;
    holdFinalPartsRef.current = [];
    setInterimTranscript('');
    setVoiceState('idle');
    setVoiceMessage(message);
    speechSessionRef.current?.abort();
    speechSessionRef.current = null;
  }

  function handleVoiceError(error: SpeechRecognitionFailure) {
    if (cancelledHoldRef.current && error.code === 'aborted') return;
    failedHoldRef.current = true;
    activeHoldRef.current = false;
    finishingHoldRef.current = false;
    speechSessionRef.current = null;
    holdFinalPartsRef.current = [];
    setInterimTranscript('');
    setVoiceState('error');
    setVoiceMessage(error.message);
  }

  function handleVoiceEnd() {
    speechSessionRef.current = null;
    activeHoldRef.current = false;
    finishingHoldRef.current = false;

    if (cancelledHoldRef.current) {
      cancelledHoldRef.current = false;
      holdFinalPartsRef.current = [];
      setInterimTranscript('');
      return;
    }

    if (failedHoldRef.current) {
      failedHoldRef.current = false;
      holdFinalPartsRef.current = [];
      setInterimTranscript('');
      return;
    }

    const finalText = holdFinalPartsRef.current.join(' ').trim();
    holdFinalPartsRef.current = [];
    setInterimTranscript('');

    if (!finalText) {
      setVoiceState('idle');
      setVoiceMessage('没有识别到语音，请按住后再说话。');
      return;
    }

    const nextValue = appendTranscript(valueRef.current, finalText);
    valueRef.current = nextValue;
    onChange(nextValue);
    setMode('text');
    setVoiceState('idle');
    setVoiceMessage('已转入输入框，可检查后发送。');
  }

  function handleVoicePointerDown(event: PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // ignored
    }
    startVoiceHold();
  }

  function handleVoicePointerUp(event: PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // ignored
    }
    finishVoiceHold();
  }

  function handleVoicePointerCancel(event: PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    cancelVoiceHold();
  }

  function handleVoiceButtonKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if ((event.key !== ' ' && event.key !== 'Enter') || event.repeat) return;
    event.preventDefault();
    startVoiceHold();
  }

  function handleVoiceButtonKeyUp(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    event.preventDefault();
    finishVoiceHold();
  }

  return (
    <form className="composer" data-input-mode={mode} onSubmit={handleSubmit}>
      {open ? (
        <div className="slash-command-popover" role="listbox" aria-label="Slash commands">
          {matches.map((match, index) => (
            <button
              key={match.entry.name}
              className="slash-command-option"
              type="button"
              role="option"
              aria-selected={index === selectedIndex}
              disabled={!isSelectable(match.entry)}
              onClick={() => acceptCommand(match.entry)}
            >
              <span className="slash-command-main">
                <span className="slash-command-name">{match.entry.title}</span>
                <span className="slash-command-description">{match.entry.description}</span>
              </span>
              <span className="slash-command-scope">{match.entry.scope}</span>
            </button>
          ))}
        </div>
      ) : null}
      {notice ? <p className="slash-command-notice" role="status">{notice}</p> : null}
      {resumeOpen ? (
        <div className="slash-command-popover" role="listbox" aria-label="Resume sessions">
          {resumeCandidates.length === 0 ? <p className="slash-command-empty">当前项目没有可恢复的历史会话。</p> : null}
          {resumeCandidates.map((candidate) => (
            <button
              key={candidate.sessionId}
              className="slash-command-option"
              type="button"
              role="option"
              aria-selected="false"
              onClick={() => acceptResumeCandidate(candidate)}
            >
              <span className="slash-command-main">
                <span className="slash-command-name">{candidate.title}</span>
                <span className="slash-command-description">{candidate.lastMessage || '暂无预览。'}</span>
              </span>
              <span className="slash-command-scope">{candidate.appSession ? 'open' : 'resume'}</span>
            </button>
          ))}
        </div>
      ) : null}

      <button
        className="secondary-button composer-mode-button"
        type="button"
        disabled={disabled}
        aria-label={mode === 'text' ? '切换到语音输入' : '切换到键盘输入'}
        onClick={() => switchMode(mode === 'text' ? 'voice' : 'text')}
      >
        {mode === 'text' ? '语音' : '键盘'}
      </button>

      {mode === 'text' ? (
        <textarea
          value={value}
          onChange={(event) => {
            setActiveIndex(0);
            onChange(event.target.value);
          }}
          onKeyDown={handleKeyDown}
          placeholder="输入要发送给 Claude Code 的内容..."
          rows={3}
          disabled={disabled}
        />
      ) : (
        <div className="voice-input-panel" data-voice-state={voiceState}>
          <button
            className="voice-hold-button"
            type="button"
            disabled={disabled || !speechAvailable}
            aria-label="按住说话"
            onPointerDown={handleVoicePointerDown}
            onPointerUp={handleVoicePointerUp}
            onPointerCancel={handleVoicePointerCancel}
            onPointerLeave={() => {
              if (activeHoldRef.current) cancelVoiceHold();
            }}
            onKeyDown={handleVoiceButtonKeyDown}
            onKeyUp={handleVoiceButtonKeyUp}
          >
            {voiceButtonLabel(voiceState, speechAvailable)}
          </button>
          {activeHoldRef.current ? (
            <button className="secondary-button compact voice-cancel-button" type="button" onClick={() => cancelVoiceHold()}>
              取消本次
            </button>
          ) : null}
          {interimTranscript ? <p className="voice-interim">正在识别：{interimTranscript}</p> : null}
          {voiceMessage ? <p className="voice-status" role="status">{voiceMessage}</p> : null}
          {value ? <p className="voice-existing-text">当前输入：{value}</p> : null}
        </div>
      )}

      <button className="primary-button" type="submit" disabled={disabled || !value.trim()}>
        发送
      </button>
    </form>
  );
}

function isSelectable(entry: SlashCommandEntry): boolean {
  return isEnabled(entry) || entry.behavior === 'unsupported' || entry.support === 'unsupported';
}

function appendTranscript(current: string, transcript: string): string {
  const text = transcript.trim();
  if (!text) return current;
  if (!current.trim()) return text;
  return `${current}${/\s$/.test(current) ? '' : ' '}${text}`;
}

function voiceButtonLabel(state: VoiceState, speechAvailable: boolean): string {
  if (!speechAvailable || state === 'unavailable') return '语音不可用';
  if (state === 'listening') return '松开结束，移出取消';
  if (state === 'transcribing') return '正在转文字…';
  if (state === 'error') return '按住重试';
  return '按住说话';
}
