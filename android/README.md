# Deck Lotus for Android

Native Kotlin + Jetpack Compose. Right now it's just the scanner: lay cards
under the camera and they're identified as soon as they're still, with no
button. Inventory sync and the rest of the app come later.

## Modules

| Module    | What it is |
|-----------|------------|
| `core`    | Plain Kotlin, shared by the phone and the indexer: the card fingerprint (`CardHasher`), the index file (`CardIndex`), OCR helpers and the identification logic (`Identifier`). |
| `indexer` | Desktop tool. Downloads Scryfall's card list and images, fingerprints every paper printing, and writes `card-index.bin`. Also evaluates accuracy. |
| `app`     | The Android app: CameraX frames, then OpenCV card detection and straightening, then fingerprint plus ML Kit OCR, then the session list. |

## How a scan works

1. Every camera frame (1080p) is searched for a card-shaped quadrilateral.
2. Once the card has been still for 3 frames, it's warped flat to 976×1362.
3. Two DCT fingerprints are taken (art box plus whole card, 192 bits) in
   both orientations and compared against every printing in the index. That's
   about 110k entries, brute force, in a couple of ms.
4. ML Kit reads only the name bar and the bottom-left collector line
   (`123/280 R`, `NEO • EN`). The collector line separates reprints that share
   art; the name is the fallback when the picture match is unsure.
5. The same card lying there isn't counted again. Once no card has been seen
   for a few frames, the scanner re-arms, so repeat copies count.

## Release builds

Every merge to `main` that touches `android/`, and a weekly run on Mondays for newly
released cards, builds a signed release APK (`.github/workflows/android.yml`). It's
published to the `android-latest` GitHub release, always at the same URL:

    https://github.com/madeofpendletonwool/deck-lotus/releases/download/android-latest/deck-lotus.apk

Each build has a higher `versionCode`, so it installs over the last one. The release key is
in the repo's Actions secrets (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`). Keep a backup of the keystore: a phone won't
update an app signed with a different key. Builds made without it (debug, or a local
release build) are signed with the debug key and won't install over a CI build without
uninstalling first.

The workflow reuses the last release's `card-index.bin` (`indexer build --reuse FILE`), so
only cards new since then are downloaded and fingerprinted. Run the workflow by hand with
**full_index** to fingerprint everything again, for example after changing `CardHasher`.

## Build the card index

The app needs `card-index.bin` (about 6 MB, holds every paper printing):

```sh
cd android
./gradlew :indexer:installDist
./indexer/build/install/indexer/bin/indexer build          # about 15 min the first time, then cached
```

That writes `app/src/main/assets/card-index.bin`, which gets bundled into the
APK. To try a new index without reinstalling, push it instead. The pushed copy
wins over the bundled one:

```sh
adb push app/src/main/assets/card-index.bin /sdcard/Android/data/com.collinpendleton.decklotus.debug/files/card-index.bin
```

Cached downloads live in `indexer-cache/` (gitignored). `--reuse app/src/main/assets/card-index.bin`
rebuilds from an existing index in seconds, fetching only printings it doesn't have.

## Measure accuracy

```sh
./indexer/build/install/indexer/bin/indexer eval --index app/src/main/assets/card-index.bin --samples 500
```

This takes Scryfall's larger images, roughs them up like a phone camera would
(corner error, blur, glare, lighting, noise), and reports how often the picture
match alone gets the right card and printing. Use it before and after touching
`CardHasher` or `Identifier.Thresholds`. Changing the hash means bumping
`CardHasher.VERSION` and rebuilding the index.

Real failures beat synthetic ones: in the app, turn on **Debug** and tap
**Save frame** after a miss. Frames land in
`/sdcard/Android/data/com.collinpendleton.decklotus.debug/files/captures/`.

## Run it

```sh
./gradlew :app:installDebug
```

Scanning tips: a plain mid-tone or coloured mat (not black, not white), even
light, and the phone 20–30 cm above the cards. The **Light** button turns on
the torch. Sleeve glare is the main thing that hurts recognition.
