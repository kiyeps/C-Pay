/**
 * Issue #162 — reveal ordering, proven at the controller level.
 *
 * The defect is that the secret could render unmasked BEFORE capture
 * protection was enabled. `revealSecretWithCaptureProtection()` is the
 * production path the screen now uses, so the ordering is proven on real
 * production code rather than a reimplementation.
 *
 * Native screenshot blocking is platform behaviour and is NOT proven here —
 * only that the controller refuses to return the secret until the native call
 * succeeds.
 */
jest.mock('expo-screen-capture', () => ({
  preventScreenCaptureAsync: jest.fn(async () => undefined),
  allowScreenCaptureAsync: jest.fn(async () => undefined),
}));

import * as ScreenCapture from 'expo-screen-capture';
import {
  revealSecretWithCaptureProtection,
  releaseSecretCapture,
} from '../../utils/secretExportController';

const SYNTHETIC_SECRET = 'SBZU2GSAQWOUFBDUHZNHVKROTLBQTPFIP7IPHRAMRFXDSDOJVQ4GHPR2';

const source = async () => SYNTHETIC_SECRET;

describe('#162 patched: the secret is never returned before capture protection succeeds', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('a successful enable returns the secret', async () => {
    (ScreenCapture.preventScreenCaptureAsync as jest.Mock).mockResolvedValue(undefined);

    const outcome = await revealSecretWithCaptureProtection(source);

    expect(outcome.status).toBe('revealed');
    if (outcome.status === 'revealed') {
      expect(outcome.value).toBe(SYNTHETIC_SECRET);
    }
    expect(ScreenCapture.preventScreenCaptureAsync).toHaveBeenCalledWith('cpay-secret-export');
  });

  test('a failed enable never returns the secret', async () => {
    (ScreenCapture.preventScreenCaptureAsync as jest.Mock).mockRejectedValue(
      new Error('unsupported platform')
    );

    const outcome = await revealSecretWithCaptureProtection(source);

    expect(outcome.status).toBe('blocked');
    expect(outcome).not.toHaveProperty('value');
  });

  test('a slow enable does not return the secret while it is still pending', async () => {
    let resolvePrevent: () => void = () => {};
    (ScreenCapture.preventScreenCaptureAsync as jest.Mock).mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolvePrevent = resolve;
      })
    );

    const pending = revealSecretWithCaptureProtection(source);

    // The native call has not resolved yet, so the promise must not have
    // settled with a value.
    let settled = false;
    let sawValue = false;
    void pending.then((r: any) => {
      settled = true;
      if (r.status === 'revealed') sawValue = true;
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(settled).toBe(false);
    expect(sawValue).toBe(false);

    resolvePrevent();
    const outcome = await pending;
    expect(outcome.status).toBe('revealed');
  });

  test('a failed source is blocked before protection is even attempted', async () => {
    const outcome = await revealSecretWithCaptureProtection(async () => null);

    expect(outcome.status).toBe('blocked');
    if (outcome.status === 'blocked') {
      expect(outcome.reason).toBe('auth-failed');
    }
    expect(ScreenCapture.preventScreenCaptureAsync).not.toHaveBeenCalled();
  });

  test('release is safe when protection was never enabled', async () => {
    await expect(releaseSecretCapture()).resolves.toBeUndefined();
  });

  test('a failed release does not throw', async () => {
    (ScreenCapture.allowScreenCaptureAsync as jest.Mock).mockRejectedValueOnce(new Error('nope'));
    await expect(releaseSecretCapture()).resolves.toBeUndefined();
  });

  test('repeated reveals each enable protection exactly once', async () => {
    (ScreenCapture.preventScreenCaptureAsync as jest.Mock).mockResolvedValue(undefined);

    await revealSecretWithCaptureProtection(source);
    await revealSecretWithCaptureProtection(source);

    expect((ScreenCapture.preventScreenCaptureAsync as jest.Mock).mock.calls.length).toBe(2);
  });
});
