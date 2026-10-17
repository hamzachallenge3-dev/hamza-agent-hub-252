/**
 * Credential store.
 *
 * Secrets live in the process environment or in an AES-256-GCM encrypted file
 * under the data directory — never in source, never in a response body. The
 * store deliberately exposes *presence* and *source*, not values, so status
 * endpoints can be honest about what is configured without leaking anything.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';

const ALGORITHM = 'aes-256-gcm';

function storeDir(): string {
  const dir = path.join(config.dataDir, 'credentials');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function storeFile(): string {
  return path.join(storeDir(), 'store.enc');
}

/**
 * Encryption key. `HAH_CREDENTIAL_KEY` wins; otherwise a 0600 key file is
 * generated on first use so the store is never written in the clear.
 */
function storeKey(): Buffer {
  const fromEnv = process.env.HAH_CREDENTIAL_KEY;
  if (fromEnv) return crypto.createHash('sha256').update(fromEnv).digest();
  const keyFile = path.join(storeDir(), 'store.key');
  if (!fs.existsSync(keyFile)) {
    fs.writeFileSync(keyFile, crypto.randomBytes(32), { mode: 0o600 });
  }
  return crypto.createHash('sha256').update(fs.readFileSync(keyFile)).digest();
}

type Bag = Record<string, string>;

function readBag(): Bag {
  const file = storeFile();
  if (!fs.existsSync(file)) return {};
  try {
    const raw = fs.readFileSync(file);
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const body = raw.subarray(28);
    const decipher = crypto.createDecipheriv(ALGORITHM, storeKey(), iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
    return JSON.parse(plain) as Bag;
  } catch {
    // A store we cannot decrypt is treated as absent rather than crashing the
    // Hub; the operator sees it as "not configured" in the status report.
    return {};
  }
}

function writeBag(bag: Bag): void {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, storeKey(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(bag), 'utf8'), cipher.final()]);
  fs.writeFileSync(storeFile(), Buffer.concat([iv, cipher.getAuthTag(), body]), { mode: 0o600 });
}

/**
 * Resolve a credential by trying each candidate environment variable, then the
 * encrypted store. Returns the value for internal use only.
 */
export function credential(names: string[]): string {
  for (const name of names) {
    const v = process.env[name];
    if (v && v.trim()) return v.trim();
  }
  const bag = readBag();
  for (const name of names) {
    const v = bag[name];
    if (v && v.trim()) return v.trim();
  }
  return '';
}

/** Where a credential came from, with no hint of its value. */
export function credentialSource(names: string[]): 'env' | 'store' | 'absent' {
  for (const name of names) {
    if (process.env[name]?.trim()) return 'env';
  }
  const bag = readBag();
  for (const name of names) {
    if (bag[name]?.trim()) return 'store';
  }
  return 'absent';
}

export function setCredential(name: string, value: string): void {
  const bag = readBag();
  bag[name] = value;
  writeBag(bag);
}

export function deleteCredential(name: string): boolean {
  const bag = readBag();
  if (!(name in bag)) return false;
  delete bag[name];
  writeBag(bag);
  return true;
}

/** Names present in the store. Values are never returned. */
export function storedCredentialNames(): string[] {
  return Object.keys(readBag()).sort();
}
