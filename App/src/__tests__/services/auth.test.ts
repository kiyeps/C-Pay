import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../../services/supabase';
import { signOut } from '../../services/auth';

jest.mock('../../services/transactionMonitor', () => ({
  stopTransactionPolling: jest.fn(),
}));

import { stopTransactionPolling } from '../../services/transactionMonitor';

describe('signOut', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
  });

  it('revokes the Supabase session and clears app caches without removing the wallet', async () => {
    await AsyncStorage.multiSet([
      ['transactions', 'cached transactions'],
      ['display_name', 'Test User'],
      ['cpay_id', 'test@cpay123'],
      ['profile_photo', 'photo-url'],
      ['wallet_address', 'GTEST'],
    ]);

    await signOut();

    expect(supabase.auth.signOut).toHaveBeenCalledTimes(1);
    expect(stopTransactionPolling).toHaveBeenCalledTimes(1);
    expect(supabase.removeAllChannels).toHaveBeenCalledTimes(1);
    expect(await AsyncStorage.getItem('transactions')).toBeNull();
    expect(await AsyncStorage.getItem('display_name')).toBeNull();
    expect(await AsyncStorage.getItem('cpay_id')).toBeNull();
    expect(await AsyncStorage.getItem('profile_photo')).toBeNull();
    expect(await AsyncStorage.getItem('wallet_address')).toBe('GTEST');
  });
});