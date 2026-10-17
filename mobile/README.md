# MyVoteMatters mobile app (Android + iOS)

A Capacitor shell around the live web app at
https://my-vote-matters-three.vercel.app. The app loads the live site, so every
web deploy reaches phone users at once with no app update. Without internet it
shows `www/offline.html`.

The native shells add two things a plain WebView lacks (see `native/mvm-shim.js`):
**Print** buttons open the phone's print / save-as-PDF dialog, and **CSV
downloads** open the share sheet so the file can be saved or sent.

## Android APK

Every push that touches `mobile/` runs `.github/workflows/mobile-app.yml`, which
builds `MyVoteMatters.apk` and publishes it on the repo's **mobile-latest**
release. Open that release on an Android phone, download the APK and install it.

Local build (needs JDK 21 and the Android SDK):

```bash
cd mobile
npm ci
npm run apk:debug   # -> android/app/build/outputs/apk/debug/app-debug.apk
```

Test APKs are signed with the shared debug key in `android/app/` so each new one
installs over the last. For the Play Store, create a private upload key and build
an `.aab` (`./gradlew bundleRelease`); never commit that key.

## iOS

The Xcode project is in `ios/App`. Building an installable app needs a Mac with
Xcode and an Apple Developer account ($99/year):

```bash
cd mobile
npm ci
npx cap sync ios
npx cap open ios    # in Xcode: pick your Team under Signing, then Product > Archive
```

From the archive, upload to TestFlight / App Store Connect. CI only checks that
the project compiles for the simulator.

## Changing icons or splash

Edit the SVGs in `assets/`, render them to PNG at the same size, then run
`npm run assets`.
