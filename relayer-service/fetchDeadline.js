/**
 * Outbound fetch deadline helper.
 *
 * The relayer performs several outbound calls with no deadline: the low-balance
 * alert webhook, the Supabase `/auth/v1/user` probe, and every Supabase REST
 * request. A peer that accepts the connection and then never responds holds the
 * caller indefinitely, which on the alert path means a stuck request per check
 * rather than a bounded one.
 *
 * Uses `AbortSignal.timeout` when the runtime provides it, otherwise falls back
 * to an `AbortController` whose timer is always cleared. A caller-supplied
 * signal is preserved: if the caller already cancelled, or cancels while we
 * wait, that cancellation still wins.
 *
 * Response bodies and secrets are never read here; only the signal is built.
 */

const DEFAULT_TIMEOUT_MS = 5000;

function readTimeoutMs() {
  const raw = process.env.OUTBOUND_FETCH_TIMEOUT_MS;
  if (!raw) return DEFAULT_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TIMEOUT_MS;
  return parsed;
}

const configuredTimeoutMs = readTimeoutMs();

/**
 * Build a signal that aborts after `timeoutMs`, composed with any caller
 * signal so caller cancellation is never lost.
 *
 * Returns `{ signal, cleanup }`. `cleanup()` must always be called — it clears
 * the timer and detaches the listener so a completed request does not leak.
 */
function createDeadlineSignal(timeoutMs = configuredTimeoutMs, callerSignal) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    if (!callerSignal) {
      return {
        signal: timeoutSignal,
        cleanup: () => {
          // AbortSignal.timeout has no explicit clear; nothing to release.
        },
      };
    }
    // Compose: abort when either the deadline or the caller fires.
    const controller = new AbortController();
    const onTimeout = () => controller.abort(timeoutSignal.reason);
    const onCaller = () => controller.abort(callerSignal.reason);
    if (timeoutSignal.aborted) onTimeout();
    else timeoutSignal.addEventListener('abort', onTimeout, { once: true });
    if (callerSignal.aborted) onCaller();
    else callerSignal.addEventListener('abort', onCaller, { once: true });
    return {
      signal: controller.signal,
      cleanup: () => {
        timeoutSignal.removeEventListener('abort', onTimeout);
        callerSignal.removeEventListener('abort', onCaller);
      },
    };
  }

  // Fallback for runtimes without AbortSignal.timeout.
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`Outbound request exceeded ${timeoutMs}ms`));
  }, timeoutMs);
  if (callerSignal) {
    const onCaller = () => controller.abort(callerSignal.reason);
    if (callerSignal.aborted) onCaller();
    else callerSignal.addEventListener('abort', onCaller, { once: true });
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
    },
  };
}

/**
 * Fetch with a deadline. Caller cancellation is preserved and the timer is
 * always cleared, including on success and on failure.
 */
async function fetchWithDeadline(url, options = {}, timeoutMs = configuredTimeoutMs) {
  const callerSignal = options.signal;
  const { signal, cleanup } = createDeadlineSignal(timeoutMs, callerSignal);
  try {
    return await fetch(url, { ...options, signal });
  } finally {
    cleanup();
  }
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  configuredTimeoutMs,
  createDeadlineSignal,
  fetchWithDeadline,
};
