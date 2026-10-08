import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { api } from './api';

let registeredToken: string | null = null;

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

/** Asks for notification permission once and tells the school server where to send pushes. */
export async function registerForPush(): Promise<void> {
  if (Platform.OS === 'web' || !Device.isDevice) return;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'School notifications',
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  const existing = await Notifications.getPermissionsAsync();
  const status = existing.granted ? 'granted' : (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return;

  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return; // Push needs an EAS project id; see apps/mobile/README.md.
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  await api('/notifications/push-tokens', { method: 'POST', body: { token, platform: Platform.OS === 'ios' ? 'ios' : 'android' } });
  registeredToken = token;
}

export async function unregisterPush(): Promise<void> {
  if (!registeredToken) return;
  await api(`/notifications/push-tokens/${encodeURIComponent(registeredToken)}`, { method: 'DELETE' });
  registeredToken = null;
}
