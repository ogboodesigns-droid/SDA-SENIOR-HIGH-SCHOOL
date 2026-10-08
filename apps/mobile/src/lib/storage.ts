import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Tokens go in the device keystore (Android Keystore / iOS Keychain).
 * The web build exists only for development previews and keeps them in memory.
 */
const memory = new Map<string, string>();

export async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') return memory.get(key) ?? null;
  return SecureStore.getItemAsync(key);
}

export async function setItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') return void memory.set(key, value);
  await SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
}

export async function removeItem(key: string): Promise<void> {
  if (Platform.OS === 'web') return void memory.delete(key);
  await SecureStore.deleteItemAsync(key);
}
