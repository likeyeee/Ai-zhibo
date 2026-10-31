import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_PERSONA,
  emptyStats,
  type Comment,
  type CommentReply,
  type CommentSource,
  type LiveSession,
  type Persona,
  type PlatformId,
  type Product,
  type Script,
  type ScriptSegment,
  type LlmProviderId,
  type SessionStats,
} from '@lingbo/shared';

export interface DestinationRecord {
  id: string;
  platform: PlatformId;
  label: string;
  serverUrl: string;
  streamKeyCipher: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Database {
  version: 1;
  persona: Persona;
  products: Product[];
  scripts: Script[];
  sessions: LiveSession[];
  comments: Comment[];
  destinations: DestinationRecord[];
}

export interface ProductInput {
  title: string;
  priceYuan: number;
  imageUrl: string | null;
  sellingPoints: string[];
  faqs: Product['faqs'];
  description: string;
}

export interface NewComment {
  sessionId: string;
  viewerName: string;
  text: string;
  source: CommentSource;
  clientId?: string | null;
}

function emptyDb(): Database {
  return {
    version: 1,
    persona: structuredClone(DEFAULT_PERSONA),
    products: [],
    scripts: [],
    sessions: [],
    comments: [],
    destinations: [],
  };
}

export class JsonStore {
  private data: Database;

  constructor(private readonly file: string) {
    this.data = this.read();
  }

  listProducts(): Product[] {
    return structuredClone(
      [...this.data.products].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    );
  }

  getProduct(id: string): Product | null {
    const product = this.data.products.find((item) => item.id === id);
    return product ? structuredClone(product) : null;
  }

  createProduct(input: ProductInput): Product {
    const now = new Date().toISOString();
    const product: Product = {
      id: crypto.randomUUID(),
      title: input.title,
      priceYuan: roundMoney(input.priceYuan),
      imageUrl: input.imageUrl,
      sellingPoints: input.sellingPoints,
      faqs: input.faqs,
      description: input.description,
      createdAt: now,
      updatedAt: now,
    };
    this.data.products.push(product);
    this.save();
    return structuredClone(product);
  }

  updateProduct(id: string, input: ProductInput): Product | null {
    const product = this.data.products.find((item) => item.id === id);
    if (!product) return null;
    product.title = input.title;
    product.priceYuan = roundMoney(input.priceYuan);
    product.imageUrl = input.imageUrl;
    product.sellingPoints = input.sellingPoints;
    product.faqs = input.faqs;
    product.description = input.description;
    product.updatedAt = new Date().toISOString();
    this.save();
    return structuredClone(product);
  }

  deleteProduct(id: string): boolean {
    const before = this.data.products.length;
    this.data.products = this.data.products.filter((item) => item.id !== id);
    if (this.data.products.length === before) return false;
    for (const session of this.data.sessions) {
      if (session.status !== 'live') continue;
      session.productIds = session.productIds.filter((productId) => productId !== id);
      if (session.currentProductId === id) session.currentProductId = null;
    }
    this.save();
    return true;
  }

  getPersona(): Persona {
    return structuredClone(this.data.persona);
  }

  setPersona(persona: Persona): Persona {
    this.data.persona = structuredClone(persona);
    this.save();
    return this.getPersona();
  }

  listDestinations(): DestinationRecord[] {
    return structuredClone(this.data.destinations);
  }

  getDestination(id: string): DestinationRecord | null {
    const found = this.data.destinations.find((item) => item.id === id);
    return found ? structuredClone(found) : null;
  }

  createDestination(input: Omit<DestinationRecord, 'id' | 'createdAt' | 'updatedAt'>): DestinationRecord {
    const now = new Date().toISOString();
    const record: DestinationRecord = { ...input, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
    this.data.destinations.push(record);
    this.save();
    return structuredClone(record);
  }

  updateDestination(
    id: string,
    input: Omit<DestinationRecord, 'id' | 'createdAt' | 'updatedAt' | 'streamKeyCipher'> & { streamKeyCipher?: string },
  ): DestinationRecord | null {
    const record = this.data.destinations.find((item) => item.id === id);
    if (!record) return null;
    record.platform = input.platform;
    record.label = input.label;
    record.serverUrl = input.serverUrl;
    record.enabled = input.enabled;
    if (input.streamKeyCipher !== undefined) record.streamKeyCipher = input.streamKeyCipher;
    record.updatedAt = new Date().toISOString();
    this.save();
    return structuredClone(record);
  }

  deleteDestination(id: string): boolean {
    const before = this.data.destinations.length;
    this.data.destinations = this.data.destinations.filter((item) => item.id !== id);
    if (this.data.destinations.length === before) return false;
    this.save();
    return true;
  }

  addScript(input: {
    productId: string;
    persona: Persona;
    segments: ScriptSegment[];
    provider: LlmProviderId;
  }): Script {
    const script: Script = {
      id: crypto.randomUUID(),
      productId: input.productId,
      persona: structuredClone(input.persona),
      segments: input.segments,
      provider: input.provider,
      createdAt: new Date().toISOString(),
    };
    this.data.scripts.push(script);
    if (this.data.scripts.length > 100) {
      this.data.scripts.splice(0, this.data.scripts.length - 100);
    }
    this.save();
    return structuredClone(script);
  }

  listSessions(): LiveSession[] {
    return structuredClone(
      [...this.data.sessions].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
  }

  getSession(id: string): LiveSession | null {
    const session = this.data.sessions.find((item) => item.id === id);
    return session ? structuredClone(session) : null;
  }

  getLiveSession(): LiveSession | null {
    const session = this.data.sessions.find((item) => item.status === 'live');
    return session ? structuredClone(session) : null;
  }

  createLiveSession(input: { productIds: string[]; persona: Persona }): LiveSession {
    const now = new Date().toISOString();
    const session: LiveSession = {
      id: crypto.randomUUID(),
      status: 'live',
      productIds: [...input.productIds],
      currentProductId: null,
      persona: structuredClone(input.persona),
      currentCaption: '',
      startedAt: now,
      endedAt: null,
      createdAt: now,
      stats: emptyStats(),
    };
    this.data.sessions.push(session);
    this.save();
    return structuredClone(session);
  }

  endSession(id: string): LiveSession | null {
    return this.patchSession(id, (session) => {
      if (session.status === 'ended') return;
      session.status = 'ended';
      session.endedAt = new Date().toISOString();
    });
  }

  setCurrentProduct(id: string, productId: string): LiveSession | null {
    return this.patchSession(id, (session) => {
      session.currentProductId = productId;
    });
  }

  setCaption(id: string, caption: string): LiveSession | null {
    return this.patchSession(id, (session) => {
      session.currentCaption = caption;
    });
  }

  bumpStat(id: string, key: keyof Omit<SessionStats, 'demoAudience'>, amount = 1): LiveSession | null {
    return this.patchSession(id, (session) => {
      session.stats[key] += amount;
    });
  }

  setDemoAudience(id: string, value: number): LiveSession | null {
    return this.patchSession(id, (session) => {
      session.stats.demoAudience = value;
    });
  }

  listComments(sessionId: string): Comment[] {
    return structuredClone(
      this.data.comments
        .filter((item) => item.sessionId === sessionId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    );
  }

  addComment(input: NewComment): Comment | null {
    const session = this.data.sessions.find((item) => item.id === input.sessionId);
    if (!session || session.status !== 'live') return null;
    if (input.clientId) {
      const existing = this.data.comments.find(
        (item) => item.sessionId === input.sessionId && item.clientId === input.clientId,
      );
      if (existing) return structuredClone(existing);
    }
    const comment: Comment = {
      id: crypto.randomUUID(),
      clientId: input.clientId || null,
      sessionId: input.sessionId,
      viewerName: input.viewerName,
      text: input.text,
      source: input.source,
      createdAt: new Date().toISOString(),
      reply: null,
    };
    this.data.comments.push(comment);
    session.stats.commentCount += 1;
    this.capComments(input.sessionId);
    this.save();
    return structuredClone(comment);
  }

  nextUnanswered(sessionId: string): Comment | null {
    const comment = this.data.comments
      .filter((item) => item.sessionId === sessionId && item.reply === null)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    return comment ? structuredClone(comment) : null;
  }

  setReply(commentId: string, reply: Omit<CommentReply, 'createdAt'>): Comment | null {
    const comment = this.data.comments.find((item) => item.id === commentId);
    if (!comment || comment.reply) return comment ? structuredClone(comment) : null;
    comment.reply = { ...reply, createdAt: new Date().toISOString() };
    const session = this.data.sessions.find((item) => item.id === comment.sessionId);
    if (session) session.stats.replyCount += 1;
    this.save();
    return structuredClone(comment);
  }

  private capComments(sessionId: string) {
    const mine = this.data.comments.filter((item) => item.sessionId === sessionId);
    if (mine.length <= 400) return;
    const remove = new Set(mine.slice(0, mine.length - 400).map((item) => item.id));
    this.data.comments = this.data.comments.filter((item) => !remove.has(item.id));
  }

  private patchSession(id: string, mutate: (session: LiveSession) => void): LiveSession | null {
    const session = this.data.sessions.find((item) => item.id === id);
    if (!session) return null;
    mutate(session);
    this.save();
    return structuredClone(session);
  }

  private read(): Database {
    if (!fs.existsSync(this.file)) return emptyDb();
    const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Database;
    if (!parsed || parsed.version !== 1) return emptyDb();
    parsed.persona = { ...DEFAULT_PERSONA, ...parsed.persona };
    parsed.products ??= [];
    parsed.scripts ??= [];
    parsed.sessions ??= [];
    parsed.comments = (parsed.comments ?? []).map((comment) => ({ ...comment, clientId: comment.clientId ?? null }));
    parsed.destinations ??= [];
    return parsed;
  }

  private save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
