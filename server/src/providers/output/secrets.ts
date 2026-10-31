import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export class SecretBox {
  constructor(private readonly key: Buffer) {}

  seal(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString('base64url');
  }

  open(payload: string): string | null {
    try {
      const raw = Buffer.from(payload, 'base64url');
      if (raw.length < 29) return null;
      const iv = raw.subarray(0, 12);
      const tag = raw.subarray(12, 28);
      const encrypted = raw.subarray(28);
      const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    } catch {
      return null;
    }
  }
}

export function loadSecretKey(dataDir: string, envSecret: string): Buffer {
  if (envSecret) return scryptSync(envSecret, 'lingbo-output-v1', 32);
  const file = path.join(dataDir, 'output.key');
  if (fs.existsSync(file)) return fs.readFileSync(file);
  const key = randomBytes(32);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, key, { mode: 0o600 });
  return key;
}

export function streamKeyHint(plain: string): string {
  if (!plain) return '';
  return `••••${plain.slice(-4)}`;
}
