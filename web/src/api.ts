import type {
  Comment,
  LiveSession,
  OutputSnapshot,
  Persona,
  PlatformId,
  Product,
  RealtimeJoin,
  Script,
  StreamDestination,
  SystemInfo,
} from '@lingbo/shared';

export class ApiError extends Error {
  constructor(
    public code: string,
    public status: number,
    public details?: string,
  ) {
    super(code);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new ApiError('network', 0);
  }
  if (response.status === 204) return undefined as T;
  const data = (await response.json().catch(() => ({}))) as { error?: string; details?: string };
  if (!response.ok) throw new ApiError(data.error ?? 'server_error', response.status, data.details);
  return data as T;
}

function json(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export const api = {
  system: () => request<SystemInfo>('/api/system'),
  settings: () => request<{ persona: Persona }>('/api/settings'),
  saveSettings: (persona: Persona) => request<{ persona: Persona }>('/api/settings', json('PUT', persona)),
  products: () => request<{ products: Product[] }>('/api/products'),
  createProduct: (body: unknown) => request<{ product: Product }>('/api/products', json('POST', body)),
  updateProduct: (id: string, body: unknown) => request<{ product: Product }>(`/api/products/${id}`, json('PUT', body)),
  deleteProduct: (id: string) => request<void>(`/api/products/${id}`, { method: 'DELETE' }),
  seed: () => request<{ created: number }>('/api/products/seed', { method: 'POST' }),
  upload: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<{ url: string }>('/api/uploads', { method: 'POST', body: form });
  },
  preview: (body: unknown) => request<{ script: Script }>('/api/scripts/preview', json('POST', body)),
  sessions: () => request<{ sessions: LiveSession[] }>('/api/sessions'),
  session: (id: string) => request<{ session: LiveSession; product: Product | null }>(`/api/sessions/${id}`),
  start: (body: unknown) => request<{ session: LiveSession }>('/api/sessions', json('POST', body)),
  stop: (id: string) => request<{ session: LiveSession }>(`/api/sessions/${id}/stop`, { method: 'POST' }),
  control: (id: string, body: unknown) => request<{ session: LiveSession }>(`/api/sessions/${id}/control`, json('POST', body)),
  comments: (id: string) => request<{ comments: Comment[] }>(`/api/sessions/${id}/comments`),
  comment: (id: string, body: unknown) => request<{ comment: Comment }>(`/api/sessions/${id}/comments`, json('POST', body)),
  rtc: (id: string, body: { role: 'host' | 'viewer'; identity?: string; name?: string }) =>
    request<{ join: RealtimeJoin }>(`/api/sessions/${id}/rtc`, json('POST', body)),
  destinations: () => request<{ destinations: StreamDestination[] }>('/api/destinations'),
  createDestination: (body: {
    platform: PlatformId;
    label: string;
    serverUrl: string;
    streamKey?: string;
    enabled: boolean;
  }) => request<{ destination: StreamDestination }>('/api/destinations', json('POST', body)),
  updateDestination: (
    id: string,
    body: { platform: PlatformId; label: string; serverUrl: string; streamKey?: string; enabled: boolean },
  ) => request<{ destination: StreamDestination }>(`/api/destinations/${id}`, json('PUT', body)),
  deleteDestination: (id: string) => request<void>(`/api/destinations/${id}`, { method: 'DELETE' }),
  output: () => request<OutputSnapshot>('/api/output'),
  restartOutput: () => request<OutputSnapshot>('/api/output/restart', { method: 'POST' }),
};
