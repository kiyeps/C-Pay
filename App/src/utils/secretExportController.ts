/**
 * Secret-export reveal controller.
 *
 * The ordering rule this module owns: a secret is never handed to the UI
 * unmasked until screen-capture protection has actually been enabled. The
 * screen calls `revealSecretWithCaptureProtection()` and renders only what it
 * returns.
 *
 * Extracted from SecurityCenterScreen so the ordering is testable without
 * mounting the screen, which this Jest setup cannot resolve. Native capture
 * blocking itself is platform behaviour and is NOT proven here.
 */
import {
  enableSecretCaptureProtection,
  releaseSecretCaptureProtection,
} from './secretCaptureLifecycle';

export type RevealOutcome =
  | { status: 'revealed'; value: string }
  | { status: 'blocked'; reason: 'capture-protection-unavailable' }
  | { status: 'blocked'; reason: 'auth-failed' };

export type SecretSource = () => Promise<string | null>;

/**
 * Resolve the secret, enable capture protection, and only then hand the value
 * back for display. If protection cannot be enabled the secret is never
 * returned, so the caller has nothing unmasked to render.
 */
export async function revealSecretWithCaptureProtection(
  source: SecretSource
): Promise<RevealOutcome> {
  const value = await source();
  if (!value) {
    return { status: 'blocked', reason: 'auth-failed' };
  }

  const protection = await enableSecretCaptureProtection();
  if (!protection.ok) {
    // Deliberately do not return the value: the caller must keep it masked.
    return { status: 'blocked', reason: 'capture-protection-unavailable' };
  }

  return { status: 'revealed', value };
}

/**
 * Release capture protection. Always safe to call, including when protection
 * was never enabled, and never throws.
 */
export async function releaseSecretCapture(): Promise<void> {
  await releaseSecretCaptureProtection();
}
