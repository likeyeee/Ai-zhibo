export const HOST_IDS = ['lin', 'heng', 'ran', 'chen'] as const;

export type HostId = (typeof HOST_IDS)[number];

export interface HostFace {
  eyeY: number;
  eyeLeftX: number;
  eyeRightX: number;
  eyeW: number;
  mouthX: number;
  mouthY: number;
  mouthW: number;
  lid: string;
}

export interface HostProfile {
  id: HostId;
  name: string;
  voice: string;
  tone: 'enthusiastic' | 'professional' | 'gentle' | 'humorous';
  speechRate: number;
  portrait: string;
  motion: number;
  face: HostFace;
}

export const STUDIO_BACKGROUND = '/hosts/studio.jpg';

export const HOSTS: readonly HostProfile[] = [
  {
    id: 'lin',
    name: '小林',
    voice: 'warm-female',
    tone: 'enthusiastic',
    speechRate: 1,
    portrait: '/hosts/lin.jpg',
    motion: 1,
    face: { eyeY: 0.4, eyeLeftX: 0.385, eyeRightX: 0.615, eyeW: 0.078, mouthX: 0.5, mouthY: 0.5, mouthW: 0.13, lid: '#e4b39a' },
  },
  {
    id: 'heng',
    name: '周衡',
    voice: 'calm-male',
    tone: 'professional',
    speechRate: 0.85,
    portrait: '/hosts/heng.jpg',
    motion: 0.62,
    face: { eyeY: 0.358, eyeLeftX: 0.378, eyeRightX: 0.598, eyeW: 0.068, mouthX: 0.5, mouthY: 0.415, mouthW: 0.1, lid: '#c49a78' },
  },
  {
    id: 'ran',
    name: '阿燃',
    voice: 'bright-female',
    tone: 'enthusiastic',
    speechRate: 1.2,
    portrait: '/hosts/ran.jpg',
    motion: 1.35,
    face: { eyeY: 0.378, eyeLeftX: 0.43, eyeRightX: 0.655, eyeW: 0.07, mouthX: 0.548, mouthY: 0.472, mouthW: 0.125, lid: '#d7aa92' },
  },
  {
    id: 'chen',
    name: '陈姐',
    voice: 'mature-female',
    tone: 'gentle',
    speechRate: 0.85,
    portrait: '/hosts/chen.jpg',
    motion: 0.7,
    face: { eyeY: 0.348, eyeLeftX: 0.368, eyeRightX: 0.628, eyeW: 0.08, mouthX: 0.5, mouthY: 0.442, mouthW: 0.12, lid: '#d4b09a' },
  },
];

export function coerceHostId(id: string | null | undefined): HostId {
  return HOST_IDS.includes(id as HostId) ? (id as HostId) : 'lin';
}

export function hostById(id: string | null | undefined): HostProfile {
  return HOSTS.find((host) => host.id === coerceHostId(id)) ?? HOSTS[0]!;
}
