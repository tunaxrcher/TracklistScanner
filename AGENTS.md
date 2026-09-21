<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Verification

- Typecheck: `npx --no-install tsc --noEmit`.
- Regression checks: `node --test scripts/verify.mjs`. Requires FFmpeg and ffprobe discoverable by the app and network access (one public Spotify playlist is fetched; set `VERIFY_OFFLINE=1` to skip it). Covers scan file-extension filtering, real sample extraction from MP4/MP3 (plus any file in `VERIFY_MP4`), Spotify link parsing + tracklist reading, and DJ Pool ranking modes. Nothing calls Shazam/ACRCloud/DJ Pool. Generated fixtures are removed after the test.
- Full API smoke (needs `npm run dev` + `.env` with AUTH_SECRET): mint a cookie with `node scripts/mint-test-session.js` and POST multipart `mode=file|url|spotify` to `/api/jobs/scan`, then poll `/api/jobs/{id}`.
- Uploads: `/api/jobs/scan` is deliberately excluded from the `proxy.ts` matcher — the proxy buffers bodies in memory and truncates at 10 MB (`experimental.proxyClientMaxBodySize`). The route enforces the session itself; keep it that way if the matcher changes.
