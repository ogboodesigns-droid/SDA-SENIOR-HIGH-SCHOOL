# SDA SHS mobile app

Expo SDK 57 + Expo Router + TypeScript. Android first; the same code builds for iOS.

## Run on a phone during development

1. Start the API (see the root README) on a computer on the same Wi-Fi network as the phone.
2. Create `apps/mobile/.env`:
   ```bash
   EXPO_PUBLIC_API_URL=http://<your-computer's-LAN-IP>:4000
   ```
3. From the repository root: `pnpm build:shared && pnpm dev:mobile`, then scan the QR code with **Expo Go** (Android) or the Camera app (iOS).

`pnpm --filter @sda-shs/mobile web` gives a browser preview for quick UI checks. On the web, tokens are kept in memory only, so a page reload signs you out.

## Push notifications

Push uses Expo's push service and needs an EAS project:

```bash
npm i -g eas-cli
cd apps/mobile
eas init                  # adds extra.eas.projectId to app.json
```

Then set `EXPO_PUSH_ENABLED=true` (and optionally `EXPO_ACCESS_TOKEN`) on the API. Android push also needs FCM credentials uploaded with `eas credentials`. Without a project id, the app skips push registration and in-app notifications still work.

## Building for release

```bash
eas build --platform android --profile production   # AAB for the Play Store
eas build --platform android --profile preview      # APK for direct installation
```

Before release: add the official school logo as the app icon and adaptive icon in `app.json`, and set `EXPO_PUBLIC_API_URL` to the HTTPS production API.

## Structure

```text
src/app/            screens (Expo Router)
  (tabs)/           Home, Academics, Updates, Calendar, Profile
  assignments/      list and detail (with submission)
  announcements/    detail with read-aloud
src/components/     shared UI
src/lib/            API client, auth/session, push, formatting, theme
```
