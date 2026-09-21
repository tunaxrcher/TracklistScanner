# Tracklist Scanner

Find out **which songs are inside** a URL, a local audio/video file (MP3, WAV, FLAC, M4A, MP4, …), or a whole folder — *without* downloading an MP3 first. Recognition uses **Shazam (primary)** with **ACRCloud (fallback)**. Once a tracklist is found, each song can be pulled straight from **DJ Pool Records** or **YouTube** (converted to MP3 320).

Three tabs:

- **Scan** — URL / Audio File / Folder, recognized by sampling the audio.
- **Scan for Spotify (URL)** — paste a Spotify playlist, album or track link; the tracklist is read straight from Spotify (no recognition) and then gets the same DJ Pool / YouTube tools. Without `SPOTIFY_CLIENT_ID`/`SECRET` the public embed page is used, which exposes the first 100 tracks of a playlist.
- **Download for DJ** — turns any YouTube URL into a DJ-ready WAV or MP3 320 file.

## Requirements

| Dependency | Purpose | Install (Windows) |
|---|---|---|
| Node.js ≥ 20 | app runtime | https://nodejs.org |
| yt-dlp | fetch URL audio for scanning | `winget install yt-dlp.yt-dlp` |
| FFmpeg + ffprobe | sampling, duration probing | `winget install Gyan.FFmpeg` |

macOS: `brew install yt-dlp ffmpeg` · Linux: `sudo apt install yt-dlp ffmpeg`

The app auto-detects binaries on `PATH`; you can override with `YTDLP_PATH` / `FFMPEG_PATH` / `FFPROBE_PATH` in `.env.local`.

## Setup

```bash
npm install
copy .env.example .env.local   # then fill in ACRCloud keys (optional)
npm run dev
```

Open http://localhost:3000.

ACRCloud is optional — without keys the scanner just uses Shazam. Secrets live only in `.env.local` and are never exposed to the frontend.

For the **Download from DJ Pool Records** feature, add your account to `.env.local`:

```env
DJPOOL_EMAIL=you@example.com
DJPOOL_PASSWORD=your-password
```

Without these the feature is disabled (the button shows a "not configured" notice).

## Google sign-in (login gate)

The app requires a Google login once these are set in `.env.local`:

```env
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
AUTH_SECRET=any-long-random-string
ALLOWED_EMAILS=you@gmail.com,friend@gmail.com   # empty = any Google account
APP_URL=https://your-domain.example             # needed behind a reverse proxy
```

Create the OAuth client at [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials) (type **Web application**) and add `{APP_URL}/api/auth/callback` as an authorized redirect URI. Without `GOOGLE_CLIENT_ID`/`SECRET` the app stays locked (the login page shows a "not configured" error). For local single-user development you can set `AUTH_OPEN_MODE=true` to skip sign-in entirely — everyone then shares one account, so never enable it on a server.

The login page has a bottom player bar: drop an MP3 at `public/lobby.mp3` to give it music.

## Database (MySQL + Prisma)

Recent scans (including their saved tracklists) are stored **per Google account** in MySQL through [Prisma](https://www.prisma.io/) (schema in `prisma/schema.prisma`), so history follows the user across devices. Start the bundled container, point the app at it, and apply migrations:

```bash
docker compose up -d          # starts MySQL 8.4 (edit passwords in docker-compose.yml first)
npx prisma migrate deploy     # applies prisma/migrations to the database
```

```env
# in .env — the Prisma CLI reads .env, not .env.local (Next.js reads both)
DATABASE_URL=mysql://musicapp:change-me@127.0.0.1:3306/musicapp
```

Without `DATABASE_URL` the app still works — history just falls back to browser localStorage (per device, not per account), and any existing localStorage history is imported into the account automatically the first time the DB comes online. Device-level preferences (scan settings, source choice) intentionally stay in localStorage.

Day-to-day Prisma workflow:

```bash
npm run db:migrate     # after editing prisma/schema.prisma: creates + applies a migration (dev)
                       # needs shadow-DB rights once per container:
                       #   docker exec music-mysql mysql -uroot -p<root-pw> -e "GRANT ALL PRIVILEGES ON *.* TO 'musicapp'@'%';"
npm run db:deploy      # on the server: applies pending migrations (used on deploy)
# `npm install` regenerates the Prisma client automatically (postinstall).
```

When deploying to the droplet: `git pull && npm install && npm run db:deploy && npm run build && pm2 restart <app>`.

## How TRACKLIST works

```text
URL ─┐
File ─┼─► AudioSource ─► Scanner ─► Recognition (Shazam → ACRCloud) ─► Tracklist
Folder ┘
```

- Every source implements one `AudioSource` interface (`getDuration()` / `getSample()`), so a single Scanner + a single recognition engine serve URL, file, and folder scans. A folder is just many `LocalFileAudioSource`s fed through the same scanner.
- **URL scans** fetch the best audio stream into a temp folder (original codec, no MP3 conversion), sample it, then delete it.
- **Sampling**: every *Scan Interval* seconds (default 30) a *Sample Duration* clip (default 10 s) is cut with FFmpeg and recognized. **Smart Scan** widens the gap up to 3× while the same song keeps playing and snaps back to the base interval when the song changes.
- **Duplicate detection** merges consecutive detections of the same song within *Merge Same Song Within* (default 120 s). **Clean Tracklist** additionally normalizes titles/artists and removes repeated songs across the whole list.
- Results stream into the UI live (SSE) — no waiting for the full scan.

## Jobs, progress & cancel

Long work never blocks an HTTP request:

```text
POST /api/jobs/scan          → { jobId }        (multipart: mode, url | files, settings)
POST /api/jobs/djpool        → { jobId }        (json: tracks[], preferences — bundle/zip)
POST /api/djpool/download    → audio stream     (json: title+artist | downloadUrl — one track)
POST /api/djpool/search      → { candidates }   (json: title, artist — availability + picker)
GET  /api/djpool/stream?u=   → inline audio     (in-browser preview player)
GET  /api/jobs/{id}          → job snapshot
GET  /api/jobs/{id}/events   → SSE live progress
POST /api/jobs/{id}/cancel   → stop yt-dlp/FFmpeg, cleanup temp
GET  /api/jobs/{id}/file     → finished bundle (single track, or .zip)
GET  /api/health             → dependency check
```

Job statuses: `queued · preparing · downloading · sampling · recognizing · matching · processing · completed · failed · cancelled`.

## How DJ Pool download works

After a scan finishes, **Match & Download All** sends the cleaned tracklist to a `djpool` job:

```text
Tracklist ─► login (cached session + WP nonce) ─► search files index ─► score/rank ─► download best ─► zip
```

- One authenticated session is reused across the whole job (and refreshed automatically if the nonce/cookies expire).
- For each track the members-only file index is searched with `<first artist> <title without (…) tags>`; if that finds nothing usable, a title-only search follows. Every query is logged on the server as `[djpool search] … q="…"` and shown in the version picker ("Searched: …").
- Candidates are then ranked. The **Ranking** chip in the tracklist toolbar (next to Sources) picks the rule; changing it re-probes the list:
  - **Default** — same-song matches first (full title + ≥ half the artist tokens), then version tags decide (Clean/Dirty preference, avoid acapella / instrumental / intro-outro / remix; `Acap` / `Inst` abbreviations are recognized).
  - **DJ Pool sort** — exactly the order the pool's own search returns, nothing filtered. Get / Download All only auto-pick when the first hit is the same song.
  - **Intro Dirty first** — `(Intro Dirty)` edits first, then Dirty, then Intro (intro edits are not penalized).
  - **Clean first** — clean versions first.
- Only a verified same-song match is auto-downloaded; loose title collisions stay in the picker for manual choice.
- The version picker shows the first 12 usable hits (from 40 pool results); **Show more versions** makes one extra request for up to 60 (from 100 pool results).
- Tracks with no confident match are reported as **Not found** instead of grabbing the wrong file.
- Requests are paced sequentially to stay polite to the site.

The whole feature lives in the tracklist itself (a numbered multi-column list):

- When a scan finishes (or is stopped early) the app **auto-probes** every row against DJ Pool, so each row immediately shows **Not found** or a ready **Get** button (no click needed).
- Hover a cover and press **play** to preview the matched file in the bottom player bar (streamed inline via `/api/djpool/stream`). The version picker also has per-version preview buttons.
- Click **Get** to download that single track straight to your browser (best match auto-picked, reusing the probe result), or the **▾** caret to open a version picker (Clean/Dirty/remix/etc. with scores and sizes) and choose manually.
- **Download All** in the toolbar runs the bundle job across every row, shows per-row progress, and finishes with a one-click **Download ZIP**.

Temp files live in `temp/jobs/{jobId}/` and are removed automatically when a job finishes or is cancelled (unless **Keep Temporary Files** is on). Finished downloads are stored in `downloads/{jobId}/`.

## Security notes

- ACRCloud and DJ Pool secrets are read server-side from `.env.local` only.
- URLs are validated (http/https, public host) before reaching yt-dlp; Spotify links are parsed to `{type, id}` and only `open.spotify.com` / `api.spotify.com` are ever contacted.
- `/api/jobs/scan` is excluded from the auth proxy matcher because the proxy buffers request bodies in memory and truncates them at 10 MB; the route verifies the session itself before touching the upload.
- DJ Pool downloaded file names are sanitized before being written or zipped.
- All child processes are spawned with argument arrays (`spawn`), never concatenated shell strings.
- Uploaded file names are sanitized before touching the filesystem.

## Export

TXT / CSV / JSON with toggles for timestamps, artist, filename, and duplicate removal — generated client-side from the scan result.
