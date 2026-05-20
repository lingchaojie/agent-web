import { describe, expect, it } from 'vitest';
import { classifyTerminalFrame, classifyTerminalStreamFrame, stripTerminalControlSequences } from '../../src/shared/terminalText';

describe('terminal frame classification', () => {
  it('classifies ANSI redraw and spinner frames as transient activity', () => {
    const raw = '[?25l\r[2K✶ Herding… (10s · ↓ 10 tokens)[39m\r[2K';

    expect(classifyTerminalFrame(raw)).toEqual({ kind: 'activity', text: 'working' });
  });

  it('classifies token counters, hook status, and thought timing tails as transient activity', () => {
    expect(classifyTerminalFrame('██30k/272k (11%, auto@218k)')).toEqual({ kind: 'activity', text: 'working' });
    expect(classifyTerminalFrame('running stop hook · 5s · ↓ 26 tokens')).toEqual({ kind: 'activity', text: 'working' });
    expect(classifyTerminalFrame('thought for 3s)')).toEqual({ kind: 'activity', text: 'working' });
    expect(classifyTerminalFrame('ought for 3s)')).toEqual({ kind: 'activity', text: 'working' });
  });

  it('classifies welcome chrome and broken wrapped status fragments as empty', () => {
    const raw = [
      '│ TipsForgetThingsStarted │',
      '│ WelcomeBack! │',
      '│ AskClaudetocreateanewapporclorea... │',
      '* Orbiting...',
      'r',
      'bin',
      '*2thinking with xhigh effort',
      '10 tokens)',
    ].join('\n');

    expect(classifyTerminalFrame(raw)).toEqual({ kind: 'empty', text: '' });
  });

  it('classifies stable assistant replies as transcript', () => {
    expect(classifyTerminalFrame('你好！我可以继续帮你处理这个问题。')).toEqual({
      kind: 'transcript',
      text: '你好！我可以继续帮你处理这个问题。',
    });
    expect(classifyTerminalFrame('OK')).toEqual({
      kind: 'transcript',
      text: 'OK',
    });
    expect(classifyTerminalFrame('```ts\nconst value = 1;\n```')).toEqual({
      kind: 'transcript',
      text: '```ts\nconst value = 1;\n```',
    });
  });

  it('classifies tool output and permission prompts as transcript', () => {
    expect(classifyTerminalFrame('● Bash(npm test)\n ⎿  71 passed')).toEqual({
      kind: 'transcript',
      text: '● Bash(npm test)\n⎿ 71 passed',
    });
    expect(classifyTerminalFrame('Claude wants to run Bash command: npm test\nDo you want to allow this?')).toEqual({
      kind: 'transcript',
      text: 'Claude wants to run Bash command: npm test\nDo you want to allow this?',
    });
  });

  it('classifies terminal frames into stream-compatible durable and transient updates', () => {
    expect(classifyTerminalStreamFrame('Claude wants to run Bash\n1. Allow once\n2. Deny')).toMatchObject({
      kind: 'block',
      blockKind: 'interaction',
      status: 'final',
      text: 'Claude wants to run Bash\n1. Allow once\n2. Deny',
      interaction: expect.objectContaining({ kind: 'choice' }),
    });
    expect(classifyTerminalStreamFrame('\rAssistant is typing')).toEqual({ kind: 'block-update', text: 'Assistant is typing' });
    expect(classifyTerminalStreamFrame('[?25l\r[2K✶ Herding… (10s · ↓ 10 tokens)[39m\r[2K')).toEqual({ kind: 'activity', activity: 'working' });
  });

  it('does not classify Claude startup permission status as an interaction prompt', () => {
    const raw = [
      '你好！我可以帮你看代码、修 bug、实现功能、跑测试或解释项目。',
      'Opus 4.7 xhigh Context: [██          ] 28k/250k (11%)',
      '▸▸ bypass permissions on (shift+tab to cycle)',
    ].join('\n');

    expect(classifyTerminalStreamFrame(raw)).toEqual({ kind: 'activity', activity: 'working' });
  });
});

describe('terminal output cleanup', () => {
  it('drops transient Claude Code thinking frames', () => {
    expect(stripTerminalControlSequences('\r✶ Nebulizing…\r\r\n\r\n\r\n')).toBe('');
    expect(stripTerminalControlSequences('\r10s · ↓ 10 tokens)\r\r\n')).toBe('');
    expect(stripTerminalControlSequences('\r✻Brewed for 10s\r❯ \r\r\n')).toBe('');
  });

  it('keeps assistant content and removes terminal chrome', () => {
    const raw = '\r●你好！有什么需要我继续处理的吗？\r✶ Nebulizing… (4s · ↓ 4 tokens)\r\r❯ \r────────────────────────────────────────────────────────────────\rModel: Opus 4.7 | Thinking: xhigh\rGPT Usage: 5h 14% reset 1h03m\r';

    expect(stripTerminalControlSequences(raw)).toBe('你好！有什么需要我继续处理的吗？');
  });

  it('drops Claude Code welcome and workspace trust chrome', () => {
    const raw = [
      'Accessing workspace:',
      '/home/alvin/test_claude',
      'Quick safety check:',
      'Yes, I trust this folder✔',
      '╭─── Claude Code v2.1.142 ───╮',
      '│ Welcome to Claude Code │',
      '╰────────────────────────╯',
      '1 MCP server failed · /mcp',
    ].join('\n');

    expect(stripTerminalControlSequences(raw)).toBe('');
  });

  it('drops startup panels and split thinking fragments from the main transcript', () => {
    const raw = [
      '78',
      '│ TipsForgetThingsStarted │',
      '│ WelcomeBack! │',
      '│ AskClaudetocreateanewapporclorea... │',
      "│ What'snew │",
      '│ Addedplugindependencyforcement: clau... │',
      '│ Opus4.7 | Context with xthxh APIUsageBilling | release-notesmore │',
      '* Hering...',
      'ing',
      'H',
      'T',
      'erin',
      '*4',
      '5',
      '7',
      '*9',
      '10 tokens)',
    ].join('\n');

    expect(stripTerminalControlSequences(raw)).toBe('');
  });

  it('drops repeated xhigh effort status lines from the transcript', () => {
    const raw = [
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

    expect(stripTerminalControlSequences(raw)).toBe('');
  });

  it('keeps reply text while removing inline status redraws', () => {
    const raw = '✻ Smooshing… (1s ·thinking with xhigh effort ✢…thinking with xhigh effort gthinking with xhigh effort ✽4 ↓ 1 tokens thought for 4s) 你好 ✶ Smooshing… (5s · ↓ 1 tokens · thought for 4s) Smooshing…3 tokens · thought for 4s) running stop hook · 5s · ↓ 26 tokens · thought for 4s) ✽51 ✻Smooshing…101 tokens · thought for 4s) ✶26 ✢66';

    expect(stripTerminalControlSequences(raw)).toBe('你好');
  });

  it('drops empty timing fragments left after status cleanup', () => {
    expect(stripTerminalControlSequences('(4s · )')).toBe('');
  });

  it('keeps reply text while removing Undulating status redraws', () => {
    const raw = 'anthinking with xhigh effort ✻10s · still ) still still ↓ 你好 Undulating…76 Undulating…38 ██30k/272k (11%, auto@218k) Undulating…13 Undulating…9 Undulating…3 Undulating…3';

    expect(stripTerminalControlSequences(raw)).toBe('你好');
  });

  it('keeps reply text while removing arbitrary English status redraws', () => {
    const raw = '* Whatchamacalliting… ✢(2s · ) ↓ 你好 * Whatchamacalliting… (5s · ↓ ✽Whhamacalliting… ✻Whatchamacalliting…76 ✢Whatchamacalliting…9 ✶Whatchamacalliting…3 Whatchamacalliting…7 Whatchamacalliting… ✶Whatchamacalliting… Whatchamacalliting… Whatchamacalliting… 10s · ↓ Whatchamacalliting… Whatchamacalliting… Whatchamacalliting… ✶Whatchamacalliting… ✻Crunched for 12s';

    expect(stripTerminalControlSequences(raw)).toBe('你好');
  });

  it('keeps reply text while removing accented status redraws', () => {
    const raw = '✶ Sautéing… ✻auéi ✶ég ✢é aé ↓ thought for 5s) 你好 ✻ Sautéing… ( running sp hook· ✶Sautéing…38 Sautéing…13 ✽Sautéing…12 ✶Sautéing…20 ✢Sautéing… ✻Sautéing… Sautéing… Sautéing… Sautéing… Sautéing… Sautéing… Sautéing…';

    expect(stripTerminalControlSequences(raw)).toBe('你好');
  });
});
