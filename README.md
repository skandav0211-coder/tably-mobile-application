# Tably Mobile Application

Standalone Expo SDK 52 / React Native application. It contains the customer login and registration flow, POS, local-first billing, MPIN lock, subscriptions, and device registration.

## Run locally

```sh
npm ci
cp .env.example .env.local
# Change EXPO_PUBLIC_API_BASE in .env.local if using a different HTTPS backend.
npx expo start
```

The app reads only `EXPO_PUBLIC_API_BASE`, which must be the backend's HTTPS origin without a trailing slash. Expo development displays a configuration error if it is missing or invalid. Never put secrets in `EXPO_PUBLIC_*` variables; they are embedded in the app.

The app requires a live connection at startup to validate the subscription and sync this device's pending bills before opening. If the connection drops while the app is open, creating a new bill and changing a bill's status also require a live server check. Existing local bills remain stored and retry syncing at the next successful startup.

Menu imports accept `.csv`, `.xlsx`, and `.xls` files. Include `Item` (or `Name`) and `Price` columns; `Category`, `SKU`, `Size`, and `Tax` are optional. Rows with the same item and category are grouped, and size prices become variants. The import preview checks the existing catalogue by SKU first and then item name/category, and lets you skip or update each duplicate.

## Build and tests

```sh
npx tsc --noEmit
npm test
npx expo export --platform android
```

The engine integration tests start the real backend in-process. To run them after cloning the repositories separately, place the backend clone beside this folder as `tably-backend`, install its dependencies, and run tests from this directory. Or set `TABLY_BACKEND_PATH` to the backend repository path before `npm test`.

## EAS release builds

The app uses Expo SDK 52 with a custom native development client for Bluetooth printing, TCP printer connections, and SQLCipher. Use the EAS profiles:

```sh
npm ci
npx expo-doctor
npx tsc --noEmit

# Install EAS CLI and authenticate once, if needed.
npm install --global eas-cli
eas login

# Development client (internal distribution)
eas build --platform android --profile development

# Installable Android APK for testing
eas build --platform android --profile preview

# Production Android App Bundle
eas build --platform android --profile production
```

`eas.json` points preview and production builds at the deployed Railway API. To change it, update the `EXPO_PUBLIC_API_BASE` values in those profiles, or override the variable in the EAS environment. For local Expo development, edit `.env.local`; do not commit it. The Android package and iOS bundle identifier are both `com.tably.app`; the visible app name remains **Tably**.

The development profile also uses the deployed API by default. Change its `EXPO_PUBLIC_API_BASE` in `eas.json` if the development client should target another HTTPS backend.
