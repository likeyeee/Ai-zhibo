import type { Comment, LiveEvent, LiveSession, Product, Script, SpeechPurpose } from '@lingbo/shared';

export interface SpeechCue {
  token: number;
  text: string;
  durationMs: number;
  audioUrl: string | null;
  avatarVideoUrl: string | null;
  purpose: SpeechPurpose;
}

export interface RoomState {
  session: LiveSession | null;
  product: Product | null;
  comments: Comment[];
  connections: number;
  speech: SpeechCue | null;
  script: Script | null;
}

export function emptyRoom(): RoomState {
  return { session: null, product: null, comments: [], connections: 0, speech: null, script: null };
}

export function applyLiveEvent(state: RoomState, event: LiveEvent): RoomState {
  switch (event.type) {
    case 'snapshot':
      return {
        ...state,
        session: event.session,
        product: event.product,
        comments: event.comments,
        connections: event.connections,
      };
    case 'speech':
      return {
        ...state,
        speech: {
          token: (state.speech?.token ?? 0) + 1,
          text: event.text,
          durationMs: event.durationMs,
          audioUrl: event.audioUrl,
          avatarVideoUrl: event.avatarVideoUrl,
          purpose: event.purpose,
        },
        session: state.session ? { ...state.session, currentCaption: event.text } : state.session,
      };
    case 'product':
      return {
        ...state,
        product: event.product,
        session: state.session ? { ...state.session, currentProductId: event.product.id } : state.session,
      };
    case 'comment':
    case 'reply':
      return { ...state, comments: upsert(state.comments, event.comment) };
    case 'stats':
      return state.session ? { ...state, session: { ...state.session, stats: event.stats } } : state;
    case 'status':
      return { ...state, session: event.session };
    case 'script':
      return { ...state, script: event.script };
    case 'presence':
      return { ...state, connections: event.connections };
    default:
      return state;
  }
}

export function optimisticComment(input: {
  sessionId: string;
  clientId: string;
  name: string;
  text: string;
}): Comment {
  return {
    id: input.clientId,
    clientId: input.clientId,
    sessionId: input.sessionId,
    viewerName: input.name || '观众',
    text: input.text,
    source: 'viewer',
    createdAt: new Date().toISOString(),
    reply: null,
  };
}

function upsert(list: Comment[], comment: Comment): Comment[] {
  const index = list.findIndex((item) => sameComment(item, comment));
  const next =
    index === -1
      ? [...list, comment]
      : list.map((item, itemIndex) => (itemIndex === index ? mergeComment(item, comment) : item));
  return next.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function sameComment(left: Comment, right: Comment): boolean {
  if (left.id === right.id) return true;
  if (left.clientId && right.clientId && left.clientId === right.clientId) return true;
  if (left.clientId && left.clientId === right.id) return true;
  if (right.clientId && right.clientId === left.id) return true;
  return false;
}

function mergeComment(previous: Comment, incoming: Comment): Comment {
  return {
    ...previous,
    ...incoming,
    id: preferId(incoming, previous),
    clientId: incoming.clientId ?? previous.clientId,
    reply: incoming.reply ?? previous.reply,
  };
}

function preferId(incoming: Comment, previous: Comment): string {
  if (isServerId(incoming)) return incoming.id;
  if (isServerId(previous)) return previous.id;
  return incoming.id;
}

function isServerId(comment: Comment): boolean {
  return !comment.clientId || comment.id !== comment.clientId;
}
