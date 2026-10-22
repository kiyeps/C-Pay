/**
 * Outbound fetch deadline helper.
 *
 * The relayer performs several outbound calls with no deadline: the low-balance
 * alert webhook, the Supabase `/auth/v1/user` probe, and every Supabase REST
 * request. A peer that accepts the connection and then never responds holds the
 * caller indefinitely, which on the alert path means a stuck request per check
 * rather than a bounded one.
 *
 * Two details this module is careful about:
 *
 * 1. The deadline must stay live until the response BODY has been consumed,
 *    not just until headers arrive. A peer that sends headers and then stalls
 *    the body would otherwise hang `response.text()` forever. `fetchWithBody`
 *    owns that: it reads the body inside the deadline window.
 *
 * 2. Every listener and timer is detached in `cleanup()`, on all exit paths.
 *    A leaked abort listener on a long-lived caller signal accumulates one
 *    closure per call.
 *
 * Uses `AbortSignal.timeout` when the runtime provides it, otherwise falls back
 * to an `AbortController` whose timer is always cleared. A caller-supplied
 * signal is composed rather than replaced, so caller cancellation still wins.
 *
 * Response bodies and secrets are never read here except by `fetchWithBody`,
 * which returns the parsed result and nothing else.
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
 * the timer and detaches every listener so a completed request leaks nothing.
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

  // Fallback for runtimes without AbortSignal.timeout. The listener is captured
  // so cleanup can detach it; without this, a long-lived caller signal
  // accumulates one closure per call.
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`Outbound request exceeded ${timeoutMs}ms`));
  }, timeoutMs);

  let onCaller = null;
  if (callerSignal) {
    onCaller = () => controller.abort(callerSignal.reason);
    if (callerSignal.aborted) onCaller();
    else callerSignal.addEventListener('abort', onCaller, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      if (onCaller && callerSignal) {
        callerSignal.removeEventListener('abort', onCaller);
      }
    },
  };
}

/**
 * Fetch with a deadline that stays live through body consumption.
 *
 * `response.text()` runs inside the deadline window, so a peer that sends
 * headers and then stalls the body is bounded too. Caller cancellation is
 * preserved and the timer is always cleared, including on success and failure.
 */
async function fetchWithDeadline(url, options = {}, timeoutMs = configuredTimeoutMs) {
  const callerSignal = options.signal;
  const { signal, cleanup } = createDeadlineSignal(timeoutMs, callerSignal);
  try {
    const response = await fetch(url, { ...options, signal });
    // Read the body inside the deadline window.
    const text = await response.text();
    return { response, text };
  } finally {
    cleanup();
  }
}

/**
 * Fetch and parse JSON with a deadline through body consumption.
 * Returns `{ status, ok, body }` without leaking the raw response.
 */
async function fetchJsonWithDeadline(url, options = {}, timeoutMs = configuredTimeoutMs) {
  const { response, text } = await fetchWithDeadline(url, options, timeoutMs);
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  return { status: response.status, ok: response.ok, body };
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  configuredTimeoutMs,
  createDeadlineSignal,
  fetchWithDeadline,
  fetchJsonWithDeadline,
};
