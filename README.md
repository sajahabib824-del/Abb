# Hand Particle Saturn — Final

Updated version with:
- improved low-light detection by preprocessing camera frames (auto brightness/contrast)
- watermark "by Abb"
- Edit button so anyone can change the text shown by the two-finger gesture
- dynamic font sizing: short text appears large, long text smaller
- adaptive performance tuning

## Files
- `index.html`
- `app.js`
- `README.md`
- `.gitignore`

## How to run
Serve via HTTPS or localhost:
- `python -m http.server 8000` (for local testing)
- use `ngrok http 8000` for mobile testing via secure tunnel
- deploy to GitHub Pages / Vercel / Netlify

## Notes
- Tap "Tap to start camera" first on mobile (iOS requires user gesture)
- If detection still misses in extreme darkness, increase ambient light or point another light at your hand
- Change default text via `?text=HELLO` or the Edit button in UI