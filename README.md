# Tably Mobile Application

Standalone Expo SDK 52 / React Native application. It contains the customer login and registration flow, POS, local-first billing, MPIN lock, subscriptions, and device registration.

## Run locally

```sh
npm ci
cp .env.example .env
# Set EXPO_PUBLIC_API_BASE to the backend URL reachable from this device.
npx expo start
```

Use `http://10.0.2.2:3000/` for the Android emulator or your computer's LAN IP for a physical device. Release builds must use the backend's HTTPS origin.

## Build and tests

```sh
npx tsc --noEmit
npm test
npx expo export --platform android
```

The engine integration tests start the real backend in-process. To run them after cloning the repositories separately, place the backend clone beside this folder as `Tably backend`, install its dependencies, and run tests from this directory. Or set `TABLY_BACKEND_PATH` to the backend repository path before `npm test`.

For Android device builds, use `npx expo run:android` (native printer and SQLCipher features need a development build) or `eas build -p android`.
