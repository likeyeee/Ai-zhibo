export interface InboundComment {
  externalId: string | null;
  viewerName: string;
  text: string;
}

const MAX_TEXT = 200;
const MAX_NAME = 20;

export function normalizeInbound(body: unknown): InboundComment[] {
  if (!body || typeof body !== 'object') return [];
  const record = body as Record<string, unknown>;
  const batch = [record.payload, record.data, record.comments].find(Array.isArray);
  const items = Array.isArray(batch) ? batch : [record];
  const comments: InboundComment[] = [];
  for (const item of items) {
    const comment = one(item);
    if (comment) comments.push(comment);
  }
  return comments;
}

function one(value: unknown): InboundComment | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!isCommentEvent(record)) return null;
  const text = clip(readText(record), MAX_TEXT);
  if (!text) return null;
  const viewerName = clip(readName(record), MAX_NAME) || '观众';
  const externalId = clip(readId(record), 80) || null;
  return { externalId, viewerName, text };
}

function isCommentEvent(record: Record<string, unknown>): boolean {
  const kind = record.msg_type_str ?? record.msgType;
  if (typeof kind === 'string' && kind && kind !== 'live_comment') return false;
  const numeric = record.msg_type ?? record.msgType;
  if (typeof numeric === 'number' && numeric !== 2) return false;
  return true;
}

function readText(record: Record<string, unknown>): string {
  return stringField(record.text) || stringField(record.content) || stringField(record.comment);
}

function readName(record: Record<string, unknown>): string {
  const direct = stringField(record.viewerName) || stringField(record.nickname) || stringField(record.userName);
  if (direct) return direct;
  const user = record.userInfo ?? record.user;
  if (user && typeof user === 'object') {
    const info = user as Record<string, unknown>;
    return stringField(info.userName) || stringField(info.nickname) || stringField(info.name);
  }
  return '';
}

function readId(record: Record<string, unknown>): string {
  return stringField(record.externalId) || stringField(record.msg_id) || stringField(record.msgId);
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function clip(value: string, max: number): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
}
