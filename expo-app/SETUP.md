# Phone Capture — Expo Go Setup

Single-screen Expo Go app that captures a photo, slaps emoji stickers on a heuristic face box, flattens it, POSTs base64 to the FastAPI webhook, then spins up a Tavus video bartering agent pre-briefed with the quote.

**Stack:** Expo SDK 54 · React 19.1 · React Native 0.81.5 · expo-camera 17 · react-native-view-shot 4 · expo-web-browser 15 · Tavus v2 API · New Architecture enabled by default.

## Prerequisites

- Node 18+ and `npm`
- **Expo Go for SDK 54** on your phone (App Store / Play Store — make sure it's current; SDK 54 dropped older Expo Go builds)
- Phone and laptop on the **same Wi-Fi network**

## One-time install

```bash
cd expo-app
npm install
```

## Run the pipeline

**Terminal 1 — start the FastAPI server (bind to 0.0.0.0 so the phone can reach it):**

```bash
cd ..
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

**Terminal 2 — start the Expo dev server:**

```bash
cd expo-app
npm start
```

Scan the QR code in Expo Go (iOS: Camera app; Android: Expo Go's QR scanner).

## Configuration

Top of `App.js` holds two blocks of constants:

```js
// FastAPI webhook — point at your dev machine's LAN IP
const SERVER_URL = 'http://100.71.89.140:8000/webhook/capture';

// Tavus bartering agent
const TAVUS_API_KEY   = 'fb61610e988746888737827a23841606';
const TAVUS_REPLICA_ID = 'rf8f3aa4b33e';
const TAVUS_PERSONA_ID = 'p591fbffa1d3';
```

If your laptop's IP changes:

```bash
ipconfig getifaddr en0          # Wi-Fi on macOS
# update SERVER_URL in App.js to that IP
```

> Hackathon creds are inline in `App.js` for demo speed. Don't ship this — move the key to a server-side proxy before any public release.

## What to expect

1. Tap shutter → "Watermarking…" overlay (~200ms)
2. "Sending…" overlay (~150ms over LAN)
3. "Calling bartender…" while Tavus spins up the conversation (~1–2s)
4. ✅ "Quoted $X · 🤝 Talk to bartender · Take another" screen
5. Tap **Talk to bartender** → opens the Tavus conversation in an in-app browser (Daily.co video call with the Gen Z barter persona, pre-briefed with the quote + breakdown)
6. Tap **Take another** (or shutter again) to reset

Bottom of screen shows live timing breakdown: `cap Xms · comp Yms · send Zms · total Tms`.

Server prints `[STRIPE STUB] Charge $... for demo@example.com (job-…)` on every successful POST, and writes an invoice PDF to `../invoices/<job_id>.pdf`.

## Sanity-check the server without the app

```bash
curl -X POST http://100.71.89.140:8000/webhook/capture \
  -H "Content-Type: application/json" \
  -d '{
    "job_id": "test-001",
    "customer": {"name": "Test", "email": "t@t.com"},
    "images": [{"id": "i1", "data": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="}]
  }'
```

## Sanity-check Tavus without the app

```bash
curl -X POST https://tavusapi.com/v2/conversations \
  -H "x-api-key: fb61610e988746888737827a23841606" \
  -H "Content-Type: application/json" \
  -d '{
    "replica_id": "rf8f3aa4b33e",
    "persona_id": "p591fbffa1d3",
    "conversation_name": "manual-smoke-test",
    "conversational_context": "Quoted $250 for wedding photos."
  }'
```

Response includes a `conversation_url` (Daily.co room). Open it in any browser to confirm the persona joins.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Cannot find module 'babel-preset-expo'` | Make sure `babel-preset-expo` is in `devDependencies` (it is — `npm install` to restore) |
| "Network request failed" in app | Server not on `0.0.0.0`, or phone on different Wi-Fi, or wrong `SERVER_URL` IP |
| Expo Go: "Project incompatible" | Update Expo Go to the latest (SDK 54) build, or run `npx expo install --fix` to re-pin packages |
| Sticker positions look off | Heuristic placement; we don't have face detection in Expo Go (see comment in `App.js`) |
| Bundler `EMFILE: too many open files` | `brew install watchman` then restart `npm start` |
| Tavus error red text on screen | Photo POST still succeeded (invoice generated). Check API key / replica / persona IDs at top of `App.js`. Bartender button is skipped if Tavus 4xx/5xx |
| Tavus browser opens but blank | Daily.co needs camera + mic permission grants in the in-app browser — accept them |
| Slow capture | Drop camera `quality: 0.7 → 0.5` or view-shot `quality: 0.8 → 0.5` in `App.js` |

## Pipeline architecture

```
[Camera shutter tap]
   ↓ takePictureAsync (skipProcessing, q=0.7)
[file:// JPG on device]
   ↓ render <Image> + <Text> stickers in offscreen <View>
[layered RN view tree]
   ↓ captureRef (jpg, q=0.8, result:'base64')
[base64 string, no data: prefix]
   ↓ fetch POST application/json
[FastAPI /webhook/capture]
   ↓ value, invoice PDF, fake Stripe
[response → quote total + breakdown]
   ↓ POST tavusapi.com/v2/conversations
     (replica + persona + conversational_context = "Quoted $X, top items: …")
[Tavus conversation_url (Daily.co room)]
   ↓ tap "Talk to bartender" → WebBrowser.openBrowserAsync
[Live video haggle with Raj Barter persona]
```
