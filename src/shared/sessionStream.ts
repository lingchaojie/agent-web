import type { ConversationBlock, SessionStreamEvent, SessionStreamState } from './types';

export function emptySessionStreamState(): SessionStreamState {
  return {
    session: null,
    blocks: [],
    latestSequence: 0,
  };
}

export function applySessionStreamEvent(state: SessionStreamState, event: SessionStreamEvent): SessionStreamState {
  if (event.type === 'error') return state;
  if (event.type !== 'snapshot' && event.sequence <= state.latestSequence) return state;

  if (event.type === 'snapshot') {
    return {
      session: event.session,
      blocks: [...event.blocks].sort((a, b) => a.sequence - b.sequence),
      render: event.render,
      latestSequence: event.sequence,
    };
  }

  if (event.type === 'block-added') {
    if (state.blocks.some((block) => block.id === event.block.id)) {
      return { ...state, latestSequence: event.sequence };
    }
    return {
      ...state,
      blocks: [...state.blocks, event.block].sort((a, b) => a.sequence - b.sequence),
      latestSequence: event.sequence,
    };
  }

  if (event.type === 'block-updated') {
    return {
      ...state,
      blocks: state.blocks.map((block) => (block.id === event.blockId ? { ...block, ...event.patch } : block)),
      latestSequence: event.sequence,
    };
  }

  if (event.type === 'block-finalized') {
    return {
      ...state,
      blocks: state.blocks.map((block) => (block.id === event.blockId ? finalizeBlock(block) : block)),
      latestSequence: event.sequence,
    };
  }

  if (event.type === 'activity-changed') {
    return {
      ...state,
      session: state.session ? { ...state.session, activity: event.activity, activityLabel: event.activityLabel, latestSequence: event.sequence } : state.session,
      latestSequence: event.sequence,
    };
  }

  if (event.type === 'render-changed') {
    return {
      ...state,
      render: event.render,
      latestSequence: event.sequence,
    };
  }

  return {
    ...state,
    session: state.session ? { ...state.session, ...event.patch, latestSequence: event.sequence } : state.session,
    latestSequence: event.sequence,
  };
}

function finalizeBlock(block: ConversationBlock): ConversationBlock {
  return { ...block, status: 'final' };
}
