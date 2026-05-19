import type { KeyboardEvent } from 'react';
import { useMemo, useState } from 'react';
import type { HistorySession, SlashCommandEntry } from '../../shared/types';
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

export default function ChatComposer({ value, disabled, commandEntries, resumeCandidates, onChange, onSubmit, onOpenHistorySession }: ChatComposerProps) {
  const query = detectSlashCommandQuery(value);
  const matches = useMemo(() => query ? matchSlashCommands(commandEntries, query.query) : [], [commandEntries, query?.query]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [resumeOpen, setResumeOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const enabledIndex = firstEnabledMatchIndex(matches);
  const selectedIndex = matches[activeIndex] && isSelectable(matches[activeIndex].entry) ? activeIndex : enabledIndex;
  const open = Boolean(query && matches.length > 0 && !resumeOpen);

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

  return (
    <form className="composer" onSubmit={handleSubmit}>
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
      <button className="primary-button" type="submit" disabled={disabled || !value.trim()}>
        发送
      </button>
    </form>
  );
}

function isSelectable(entry: SlashCommandEntry): boolean {
  return isEnabled(entry) || entry.behavior === 'unsupported' || entry.support === 'unsupported';
}
