/**
 * expo-screen-capture mock for Jest.
 *
 * Native capture blocking needs a real device; this mock records the
 * prevent/allow calls so the lifecycle can be asserted.
 */
const calls: string[] = [];

const ScreenCapture = {
  preventScreenCaptureAsync: jest.fn(async (key?: string) => {
    calls.push(`prevent:${key ?? ''}`);
  }),
  allowScreenCaptureAsync: jest.fn(async (key?: string) => {
    calls.push(`allow:${key ?? ''}`);
  }),
  __calls: calls,
  __reset: () => {
    calls.length = 0;
  },
};

export default ScreenCapture;
