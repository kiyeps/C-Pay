/**
 * expo-clipboard mock for tests.
 *
 * Tracks every write so a test can assert what the clipboard still holds after
 * the export modal is closed, backgrounded, or unmounted. Real clipboard
 * contents are never used — tests only ever write a synthetic sentinel.
 */
const state = {
  content: null as string | null,
  writes: [] as Array<{ value: string; at: number }>,
};

const Clipboard = {
  async setStringAsync(value: string): Promise<boolean> {
    state.content = value;
    state.writes.push({ value, at: Date.now() });
    return true;
  },
  async getStringAsync(): Promise<string> {
    return state.content ?? '';
  },
  async hasStringAsync(): Promise<boolean> {
    return state.content !== null && state.content !== '';
  },
};

/** Test-only helpers. Not part of the real expo-clipboard surface. */
export const __clipboardTestHooks = {
  reset() {
    state.content = null;
    state.writes = [];
  },
  content() {
    return state.content;
  },
  writes() {
    return state.writes.slice();
  },
};

export default Clipboard;
