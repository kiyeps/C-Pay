/**
 * Issue #167 — cloud backup KDF strength and backward-compatible restore.
 *
 * Cloud backups encrypt a wallet secret at rest in Supabase. The KDF was
 * 60,000 PBKDF2-SHA256 iterations, an order of magnitude below the local
 * wallet KDF floor of 600,000.
 *
 * All values here are synthetic: a generated keypair and a synthetic recovery
 * password. No real wallet, no production backup, no network.
 */
import { pbkdf2Async } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha256';
import { utf8ToBytes } from '@noble/hashes/utils';

// The service module imports expo-crypto and supabase; stub both so the KDF
// logic can be exercised in isolation.
jest.mock('expo-crypto', () => ({
  getRandomBytesAsync: jest.fn(async (n: number) => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) out[i] = (i * 7 + 13) & 0xff;
    return out;
  }),
  digestStringAsync: jest.fn(async () => '00'),
}));

jest.mock('../../services/supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      upsert: jest.fn(async () => ({ error: null })),
      select: jest.fn(() => ({
        maybeSingle: jest.fn(async () => ({ data: null, error: null })),
      })),
    })),
    auth: {
      getUser: jest.fn(async () => ({ data: { user: { id: 'synthetic-user' } }, error: null })),
    },
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const cloudBackup = require('../../services/cloudWalletBackup');

const SYNTHETIC_SECRET = 'SBZU2GSAQWOUFBDUHZNHVKROTLBQTPFIP7IPHRAMRFXDSDOJVQ4GHPR2';
const SYNTHETIC_PUBLIC_KEY = 'GCRS2OYIWREYBNPFQC5KKAN2RZFHCNAGSC4JS4YEDIRVZTUZIJ3EX7G6';
const SYNTHETIC_PASSWORD = 'SyntheticRecovery-2026';

describe('#167 patched: cloud backup KDF is at least as strong as the local wallet KDF', () => {
  test('a backup row records the iteration count actually used', async () => {
    // Drive the real create path and inspect the row handed to Supabase.
    const captured: any[] = [];
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { supabase } = require('../../services/supabase');
    supabase.from.mockImplementationOnce(() => ({
      upsert: jest.fn(async (row: any) => {
        captured.push(row);
        return { error: null };
      }),
    }));

    await cloudBackup.createCloudWalletBackup(
      { secret: SYNTHETIC_SECRET, publicKey: SYNTHETIC_PUBLIC_KEY } as any,
      SYNTHETIC_PASSWORD
    );

    expect(captured).toHaveLength(1);
    const row = captured[0];
    expect(row.kdf).toBe('pbkdf2-sha256');
    expect(row.kdf_iterations).toBeGreaterThanOrEqual(600_000);
    expect(row.salt).toMatch(/^[0-9a-f]{32}$/);
    expect(row.nonce).toMatch(/^[0-9a-f]{48}$/);
    expect(row.ciphertext.length).toBeGreaterThan(0);
  });

  test('the recorded iteration count matches what actually derives the key', async () => {
    // Derive with the recorded count and confirm the ciphertext decrypts.
    const captured: any[] = [];
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { supabase } = require('../../services/supabase');
    supabase.from.mockImplementationOnce(() => ({
      upsert: jest.fn(async (row: any) => {
        captured.push(row);
        return { error: null };
      }),
    }));

    await cloudBackup.createCloudWalletBackup(
      { secret: SYNTHETIC_SECRET, publicKey: SYNTHETIC_PUBLIC_KEY } as any,
      SYNTHETIC_PASSWORD
    );

    const row = captured[0];
    const key = await pbkdf2Async(
      sha256,
      utf8ToBytes(`cpay-cloud-wallet:${SYNTHETIC_PASSWORD}`),
      hexToBytes(row.salt),
      { c: row.kdf_iterations, dkLen: 32 }
    );

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { xchacha20poly1305 } = require('@noble/ciphers/chacha');
    const cipher = xchacha20poly1305(key, hexToBytes(row.nonce));
    const plain = cipher.decrypt(hexToBytes(row.ciphertext));
    const decoded = new TextDecoder().decode(plain);
    expect(decoded).toBe(SYNTHETIC_SECRET);
  });

  test('a v1 backup with 60k iterations still restores via its stored count', async () => {
    // Build a v1-shaped backup the old way and confirm restore accepts it.
    const salt = new Uint8Array(16).fill(3);
    const nonce = new Uint8Array(24).fill(4);
    const key = await pbkdf2Async(
      sha256,
      utf8ToBytes(`cpay-cloud-wallet:${SYNTHETIC_PASSWORD}`),
      salt,
      { c: 60000, dkLen: 32 }
    );
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { xchacha20poly1305 } = require('@noble/ciphers/chacha');
    const cipher = xchacha20poly1305(key, nonce);
    const ciphertext = cipher.encrypt(utf8ToBytes(SYNTHETIC_SECRET));

    const v1Row = {
      auth_user_id: 'synthetic-user',
      wallet_address: SYNTHETIC_PUBLIC_KEY,
      backup_version: 1,
      cipher: 'xchacha20-poly1305',
      kdf: 'pbkdf2-sha256',
      kdf_iterations: 60000,
      salt: toHex(salt),
      nonce: toHex(nonce),
      ciphertext: toHex(ciphertext),
      updated_at: new Date().toISOString(),
    };

    const restored = await cloudBackup.restoreCloudWalletBackup(SYNTHETIC_PASSWORD, v1Row);
    expect(restored.secret).toBe(SYNTHETIC_SECRET);
  });

  test('a wrong recovery password fails safely instead of returning garbage', async () => {
    const salt = new Uint8Array(16).fill(5);
    const nonce = new Uint8Array(24).fill(6);
    const key = await pbkdf2Async(
      sha256,
      utf8ToBytes(`cpay-cloud-wallet:${SYNTHETIC_PASSWORD}`),
      salt,
      { c: 600000, dkLen: 32 }
    );
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { xchacha20poly1305 } = require('@noble/ciphers/chacha');
    const cipher = xchacha20poly1305(key, nonce);
    const ciphertext = cipher.encrypt(utf8ToBytes(SYNTHETIC_SECRET));

    const row = {
      auth_user_id: 'synthetic-user',
      wallet_address: SYNTHETIC_PUBLIC_KEY,
      backup_version: 1,
      cipher: 'xchacha20-poly1305',
      kdf: 'pbkdf2-sha256',
      kdf_iterations: 600000,
      salt: toHex(salt),
      nonce: toHex(nonce),
      ciphertext: toHex(ciphertext),
      updated_at: new Date().toISOString(),
    };

    await expect(
      cloudBackup.restoreCloudWalletBackup('the-wrong-password', row)
    ).rejects.toThrow();
  });

  test('metadata and the actual KDF agree on the algorithm name', async () => {
    const captured: any[] = [];
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { supabase } = require('../../services/supabase');
    supabase.from.mockImplementationOnce(() => ({
      upsert: jest.fn(async (row: any) => {
        captured.push(row);
        return { error: null };
      }),
    }));

    await cloudBackup.createCloudWalletBackup(
      { secret: SYNTHETIC_SECRET, publicKey: SYNTHETIC_PUBLIC_KEY } as any,
      SYNTHETIC_PASSWORD
    );

    const row = captured[0];
    // The row claims pbkdf2-sha256; the derivation above really used sha256.
    expect(row.kdf).toBe('pbkdf2-sha256');
    expect(row.cipher).toBe('xchacha20-poly1305');
  });
});

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
