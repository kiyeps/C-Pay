/**
 * Manual mock for utils/biometric.
 *
 * A jest.mock() factory in the test file breaks module resolution for
 * SecurityCenterScreen in this Jest setup, so the mock lives here and is
 * activated with jest.mock('../../utils/biometric') (no factory).
 */
const biometric = {
  getWalletForSecretExport: jest.fn(async () => null),
  getAuthenticatedWallet: jest.fn(async () => null),
  getBiometricType: jest.fn(async () => 'Biometric'),
  isBiometricEnabled: jest.fn(async () => false),
  saveBiometricPreference: jest.fn(async () => undefined),
  authenticateWithBiometric: jest.fn(async () => false),
};

export default biometric;
export const getWalletForSecretExport = biometric.getWalletForSecretExport;
export const getAuthenticatedWallet = biometric.getAuthenticatedWallet;
export const getBiometricType = biometric.getBiometricType;
export const isBiometricEnabled = biometric.isBiometricEnabled;
export const saveBiometricPreference = biometric.saveBiometricPreference;
export const authenticateWithBiometric = biometric.authenticateWithBiometric;
