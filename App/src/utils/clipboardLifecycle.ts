/**
 * Clipboard lifecycle for revealed secrets.
 *
 * A revealed private key or Stellar seed is the most sensitive string the app
 * ever puts on the clipboard. Anything that can read the clipboard now holds a
 * wallet seed, so the copy must be short-lived.
 *
 * This module owns the timer so the behaviour can be tested without mounting
 * the whole screen: schedule a clear, cancel it early (modal closed, app
 * backgrounded, component unmounted), and never let a failed clear propagate.
 */
import Clipboard from 'expo-clipboard';

const DEFAULT_CLEAR_MS = 45_000;

let pendingTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Clear the clipboard now and drop any pending clear.
 *
 * Best-effort by design: some platforms do not expose a reliable way to clear
 * the clipboard, and a failure here must never break a close, background, or
 * unmount path.
 */
export async function cancelClipboardClear(): Promise<void> {
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  try {
    await Clipboard.setStringAsync('');
  } catch {
    // Deliberately swallowed: failing to clear must not crash the caller.
  }
}

/**
 * Schedule a clipboard clear `delayMs` from now. A previous timer is replaced,
 * so repeated copies never stack multiple pending clears.
 */
export function scheduleClipboardClear(delayMs: number = DEFAULT_CLEAR_MS): void {
  if (pendingTimer) {
    clearTimeout(pendingTimer);
  }
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    Clipboard.setStringAsync('').catch(() => {
      // Deliberately swallowed: a late clear failure is not actionable.
    });
  }, delayMs);
}

/** True when a clear is still pending. Exposed for diagnostics and tests. */
export function hasPendingClipboardClear(): boolean {
  return pendingTimer !== null;
}
