# Local rPPG PWA

This is a static, installable Android-friendly web app. After its first HTTPS load, its HTML, JavaScript, Face Landmarker model, and MediaPipe WebAssembly runtime are cached on the device. Camera frames, landmarks, signal processing, and optional CSV logs stay in the phone browser.

## Deploy and install

1. Publish the **contents of this `webapp` folder** to any HTTPS static host, such as GitHub Pages, Cloudflare Pages, or Netlify.
2. Open that HTTPS address in Chrome on Android. Allow the camera permission.
3. In Chrome's menu, choose **Install app** (or **Add to Home screen**).
4. Wait for the `Ready` badge once before going offline. The app shell and model are then available offline.

Opening the files directly from Android storage will not work: browser camera access requires HTTPS (or browser `localhost`). No backend, database, analytics, or video upload is used.

## Use

- Use the front camera and remain still in even, frontal lighting.
- Allow at least ten seconds for calibration.
- **Start local log** retains per-frame timestamped data in browser memory.
- **Download CSV** saves that log to the device.

This is for education/research/wellness visualization only. It is not a medical device and does not measure blood pressure.
