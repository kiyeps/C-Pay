/**
 * Screen-capture lifecycle for revealed secrets.
 *
 * While a private key or Stellar seed is on screen, screenshots and screen
 * recording must be blocked. This module owns the prevent/allow pair so the
 * behaviour is testable without mounting the screen, and so a late-resolving
 * enable can never leave capture permanently blocked.
 *
 * Native capture blocking is platform behaviour: it needs an Android
 * device/emulator or an iOS simulator/device to prove. These tests only prove
 * the module calls the right API at the right time and tolerates failure.
 */
import * as ScreenCapture from 'expo-screen-capture';

export const SECRET_CAPTURE_KEY = 'cpay-secret-export';

/**
 * Block screenshots and recording. Returns `{ ok: true }` when the native
 * module accepted the request, `{ ok: false }` when it refused or is
 * unavailable, so the caller can show an explicit warning rather than assume
 * protection is active.
 */
export async function enableSecretCaptureProtection(): Promise<{ ok: boolean }> {
  try {
    await ScreenCapture.preventScreenCaptureAsync(SECRET_CAPTURE_KEY);
    return { ok: true };
  } catch {
    // Deliberately swallowed: the caller decides how to warn the user.
    return { ok: false };
  }
}

/**
 * Release capture protection. Always attempted, even when the enable never
 * resolved, and safe to call when protection was never enabled. A failure is
 * swallowed so it cannot break a close or unmount path.
 */
export async function releaseSecretCaptureProtection(): Promise<void> {
  try {
    await ScreenCapture.allowScreenCaptureAsync(SECRET_CAPTURE_KEY);
  } catch {
    // Deliberately swallowed: a failed release must not crash the caller.
  }
}
