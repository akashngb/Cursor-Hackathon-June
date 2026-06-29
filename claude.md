I'm building the phone-capture portion of a hackathon project. Context: a wedding photographer takes photos, we auto-watermark them with funny stickers (cat/dog ears, nose, etc.) placed using face detection, then send the result to a teammate's server as base64 to get priced and routed to a bartering agent. My job is ONLY this capture+watermark+send piece.

HARD CONSTRAINTS:
- This MUST run in Expo Go (managed workflow, no custom dev client, no EAS native builds, no `npx expo run`). Any library requiring native linking/config plugins that aren't already bundled in Expo Go is NOT allowed. Assume I will literally scan a QR code in Expo Go and it has to work.
- Ultra-fast latency. No AI image generation/editing for the watermark itself. Face detection for ear/sticker placement should be a simple bounding-box approach, not heavy ML landmark inference.
- Final image must be sent to the server as base64 (not multipart/form file upload).

STEP 1 — READ THE REPO FIRST:
Before writing any code, inspect the current state of this repo:
- package.json (check Expo SDK version — this matters a lot for what's available)
- app.json / app.config.js
- Any README, docs, or server code that defines the existing endpoint contract: URL, HTTP method, expected request body shape, the field name for the base64 image, auth headers, and response shape.
- Any existing screens/components already scaffolded for this.
Tell me what you find, especially the Expo SDK version and the endpoint contract, before proceeding.

STEP 2 — FIGURE OUT THE FACE DETECTION APPROACH:
Given the Expo Go constraint, research and tell me what's actually viable right now:
- Check if the installed Expo SDK version still bundles any face-detection capability usable in Expo Go without native linking (historically `expo-face-detector` existed pre-SDK 48 but was deprecated/removed — check what's actually true for our SDK version).
- If no usable native-free face detector exists, propose a pure-JS fallback (e.g. a lightweight bounding-box heuristic, or a JS-only detection lib that runs without GL/native backends) that's fast enough not to kill latency.
- If genuinely nothing reasonable works fully offline inside Expo Go, propose the leanest possible fallback (e.g. placing stickers at a fixed relative position/jitter so the demo still looks intentional) — but only as last resort, and tell me clearly that's what you're doing and why.
Pick ONE approach and proceed — don't leave this in limbo.

STEP 3 — BUILD:
- Single-screen Expo Go app: camera view (expo-camera), big shutter button.
- On capture: run the chosen face-bbox detection, overlay watermark stickers (cat ears, dog ears, nose, and a couple random goofy extras) positioned relative to detected face(s) — random selection per capture for variety.
- Composite the overlay onto the photo into a single flattened image entirely on-device (e.g. via react-native-view-shot or a Skia-based composite — pick whichever is faster/lighter and Expo Go compatible).
- Convert the final composited image to a base64 string.
- POST it to the existing teammate endpoint you found in Step 1, matching their exact request contract (field names, headers, etc.). Don't guess the contract — use what you read from the repo.
- Show a quick loading/sent state in the UI so it's demo-able (e.g. thumbnail flash + "sent" checkmark).

STEP 4 — PERFORMANCE SANITY CHECK:
After building, tell me the rough end-to-end latency breakdown (capture → detect → composite → base64 encode → send) so I know where the bottleneck is if it's not "ultrafast."

Ask me anything you need clarified on the endpoint contract if the repo doesn't make it obvious — don't guess and silently break the integration with my teammate's server.