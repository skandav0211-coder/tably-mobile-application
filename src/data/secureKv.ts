import * as SecureStore from 'expo-secure-store';
import type { KV } from '../core/store';

/** Tokens, entitlement window and the DB key live in the Android Keystore-backed secure store. */
export const secureKv: KV = {
  get: (k) => SecureStore.getItemAsync(k),
  set: (k, v) => SecureStore.setItemAsync(k, v),
  del: (k) => SecureStore.deleteItemAsync(k),
};
