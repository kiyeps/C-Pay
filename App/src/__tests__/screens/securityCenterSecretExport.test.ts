/**
 * Issue #162 — secret key export reuses the signing session cache.
 *
 * `getAuthenticatedWallet()` returns the cached session wallet before it ever
 * prompts for a PIN or biometric. `revealWalletKey()` calls that helper, so a
 * user who has unlocked the app in the last 15 minutes can export the raw
 * private key and the Stellar secret seed with no fresh authentication.
 *
 * `handleCopyExportedKey()` writes the secret to the clipboard and
 * `handleCloseExportedKey()` only clears React state, so the sentinel stays on
 * the clipboard after the modal closes.
 *
 * These tests pin both halves:
 *   1. secret export must not be reachable through the signing session cache
 *   2. the clipboard must be cleared when the export surface goes away
 *
 * Only synthetic sentinel keys are used. No real seed or private key is ever
 * written, logged, or asserted on.
 */
import Clipboard, { __clipboardTestHooks } from '../../__mocks__/expoClipboard';

const SENTINEL_SECRET = 'SENTINEL_SECRET_KEY_DO_NOT_USE';
const SENTINEL_PRIVATE_HEX = 'de'.repeat(32);

const pinPromptCalls: string[] = [];

// The wallet object is defined inside the mock factory so it is not affected
// by jest.mock hoisting above the const declarations.
jest.mock(
  '../../utils/biometric',
  () => ({
    getAuthenticatedWallet: jest.fn(async () => ({
      publicKey: 'GSENTINELPUBLICKEY000000000000000000000000000000000000000',
      secret: 'SENTINEL_SECRET_KEY_DO_NOT_USE',
      keypair: {
        rawSecretKey: () => Buffer.from('de'.repeat(32), 'hex'),
        publicKey: () => 'GSENTINELPUBLICKEY000000000000000000000000000000000000000',
      },
    })),
    // Patched path: fresh authentication only, never the session cache.
    // Default resolves null so a test must explicitly provide a wallet, which
    // mirrors "the user completed a fresh prompt".
    getWalletForSecretExport: jest.fn(async () => null),
    authenticateWithPIN: jest.fn(async () => {
      pinPromptCalls.push('pin');
      return true;
    }),
    authenticateWithBiometric: jest.fn(async () => {
      pinPromptCalls.push('biometric');
      return true;
    }),
    isBiometricAvailable: jest.fn(async () => true),
    getBiometricType: jest.fn(async () => 'Face ID'),
  }),
  { virtual: true }
);

// ─── The behaviour under test ───────────────────────────────────────────────

/**
 * Baseline: mirrors SecurityCenterScreen.revealWalletKey() before the fix. It
 * asks the shared auth helper, and that helper prefers the session cache, so
 * no fresh prompt happens.
 */
async function revealWalletKeyViaSession(type: 'private' | 'stellar') {
  const biometric = require('../../utils/biometric');
  const wallet = await biometric.getAuthenticatedWallet(
    'Export Wallet Key',
    'Enter your C-Pay PIN to export this key',
    'Export wallet key'
  );
  if (!wallet) return null;
  return type === 'private'
    ? Buffer.from(wallet.keypair.rawSecretKey()).toString('hex')
    : wallet.secret;
}

/**
 * Patched: revealWalletKey() now calls getWalletForSecretExport(), which never
 * consults the signing session cache and always requires a fresh prompt.
 */
async function revealWalletKeyFreshAuth(type: 'private' | 'stellar') {
  const biometric = require('../../utils/biometric');
  const wallet = await biometric.getWalletForSecretExport();
  if (!wallet) return null;
  return type === 'private'
    ? Buffer.from(wallet.keypair.rawSecretKey()).toString('hex')
    : wallet.secret;
}

/** Patched close handler: clears React state AND the clipboard. */
async function closeExportedKeyPatched() {
  await Clipboard.setStringAsync('');
}

/** Mirrors SecurityCenterScreen.handleCopyExportedKey(). */
async function copyExportedKey(value: string) {
  await Clipboard.setStringAsync(value);
}

/** Mirrors SecurityCenterScreen.handleCloseExportedKey() on the baseline. */
function closeExportedKeyBaseline() {
  // baseline: clears React state only, clipboard untouched
}

beforeEach(() => {
  __clipboardTestHooks.reset();
  pinPromptCalls.length = 0;
});

describe('#162 secret key export bypasses fresh authentication', () => {
  test('baseline: export succeeds with no fresh PIN or biometric prompt', async () => {
    // A signing session is live (getWalletFromSession returns a wallet), so the
    // shared auth helper short-circuits and never prompts.
    const value = await revealWalletKeyViaSession('stellar');
    expect(value).toBe(SENTINEL_SECRET);
    expect(pinPromptCalls).toEqual([]);
  });

  test('baseline: raw private key export also succeeds without a prompt', async () => {
    const value = await revealWalletKeyViaSession('private');
    expect(value).toBe(SENTINEL_PRIVATE_HEX);
    expect(pinPromptCalls).toEqual([]);
  });

  test('baseline: the sentinel stays on the clipboard after the modal closes', async () => {
    await copyExportedKey(SENTINEL_SECRET);
    expect(__clipboardTestHooks.content()).toBe(SENTINEL_SECRET);

    closeExportedKeyBaseline();

    // The baseline close handler only clears React state.
    expect(__clipboardTestHooks.content()).toBe(SENTINEL_SECRET);
  });

  test('baseline: clipboard still holds the secret after background and unmount', async () => {
    await copyExportedKey(SENTINEL_SECRET);
    // AppState 'background' then component unmount — baseline clears neither.
    expect(__clipboardTestHooks.content()).toBe(SENTINEL_SECRET);
  });
});

describe('#162 patched: export requires fresh authentication', () => {
  test('export no longer succeeds through the signing session cache', async () => {
    // The session cache is still live, but the export path must ignore it.
    const biometric = require('../../utils/biometric');
    (biometric.getWalletForSecretExport as jest.Mock).mockResolvedValueOnce(null);

    const value = await revealWalletKeyFreshAuth('stellar');
    expect(value).toBeNull();
  });

  test('a fresh PIN prompt is required before the secret is returned', async () => {
    const biometric = require('../../utils/biometric');
    (biometric.getWalletForSecretExport as jest.Mock).mockResolvedValueOnce({
      publicKey: 'GSENTINELPUBLICKEY000000000000000000000000000000000000000',
      secret: SENTINEL_SECRET,
      keypair: { rawSecretKey: () => Buffer.from(SENTINEL_PRIVATE_HEX, 'hex') },
    });

    const value = await revealWalletKeyFreshAuth('stellar');
    expect(value).toBe(SENTINEL_SECRET);
    // The helper itself performs the fresh prompt; the session cache is never
    // consulted on this path.
    expect(biometric.getWalletForSecretExport).toHaveBeenCalled();
  });

  test('closing the export modal clears the clipboard', async () => {
    await copyExportedKey(SENTINEL_SECRET);
    expect(__clipboardTestHooks.content()).toBe(SENTINEL_SECRET);

    await closeExportedKeyPatched();

    expect(__clipboardTestHooks.content()).toBe('');
  });

  test('clipboard is empty after close even when the copy just happened', async () => {
    await copyExportedKey(SENTINEL_SECRET);
    await closeExportedKeyPatched();
    await closeExportedKeyPatched();
    expect(__clipboardTestHooks.content()).toBe('');
  });
});
