import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const modules = new Map();
const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;

function loadTs(file) {
  const filename = path.resolve(root, file);
  if (modules.has(filename)) return modules.get(filename).exports;
  const loaded = { exports: {} };
  modules.set(filename, loaded);
  const localRequire = (name) => {
    if (name.startsWith("@/")) return loadTs(`${name.slice(2)}.ts`);
    if (name.startsWith(".")) return loadTs(path.resolve(path.dirname(filename), `${name}.ts`));
    return require(name);
  };
  new Function("require", "module", "exports", compile(readFileSync(filename, "utf8")))(localRequire, loaded, loaded.exports);
  return loaded.exports;
}

const { isSupportedAudioFile } = loadTs("lib/server/validate.ts");

test("Scan accepts MP4 and preserves existing file types", () => {
  const source = ts.createSourceFile("TracklistPanel.tsx", readFileSync(path.join(root, "components/TracklistPanel.tsx"), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = source.statements.filter((statement) =>
    (ts.isVariableStatement(statement) && statement.declarationList.declarations.some((declaration) => ["AUDIO_EXTENSIONS", "ACCEPT"].includes(declaration.name.getText(source)))) ||
    (ts.isFunctionDeclaration(statement) && statement.name?.text === "isAudioFile"),
  );
  assert.equal(declarations.length, 3);
  const { accept, isAudioFile } = runInNewContext(compile(declarations.map((statement) => statement.getText(source)).join("\n")) + "\n({ accept: ACCEPT, isAudioFile })");
  for (const extension of ["mp4", "mp3", "m4a", "aac", "wav", "flac", "ogg", "opus", "webm"]) {
    assert.ok(accept.split(",").includes(`.${extension}`), `${extension} must be selectable`);
    for (const name of [`track.${extension}`, `track.${extension.toUpperCase()}`]) {
      assert.equal(isAudioFile(name), true, `UI: ${name}`);
      assert.equal(isSupportedAudioFile(name), true, `server: ${name}`);
    }
  }
  for (const name of ["track.mp4.exe", "track.txt", "track", ""]) {
    assert.equal(isAudioFile(name), false, `UI rejects ${name}`);
    assert.equal(isSupportedAudioFile(name), false, `server rejects ${name}`);
  }
});

test("LocalFileAudioSource extracts scan samples from MP4 and existing MP3", async () => {
  const { resolveFfmpeg, resolveFfprobe } = loadTs("lib/server/bin.ts");
  const { LocalFileAudioSource } = loadTs("lib/server/audio/LocalFileAudioSource.ts");
  const ffmpeg = resolveFfmpeg();
  const ffprobe = resolveFfprobe();
  const dir = mkdtempSync(path.join(root, "scripts", ".verify-mp4-"));
  const execute = (bin, args) => execFileSync(bin, args, { encoding: "utf8", windowsHide: true, timeout: 30000 });
  try {
    const fixtures = [
      { name: "video.MP4", args: ["-f", "lavfi", "-i", "color=c=black:s=64x64:r=10", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100", "-c:v", "mpeg4", "-c:a", "aac"] },
      { name: "audio.mp4", args: ["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100", "-c:a", "aac"] },
      { name: "audio.mp3", args: ["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100", "-c:a", "libmp3lame"] },
    ];
    for (const fixture of fixtures) {
      const input = path.join(dir, fixture.name);
      execute(ffmpeg, ["-hide_banner", "-loglevel", "error", ...fixture.args, "-t", "3", input]);
      const source = new LocalFileAudioSource(input, fixture.name, dir);
      await source.prepare({});
      const duration = await source.getDuration();
      assert.ok(duration >= 2.9 && duration < 3.5, `${fixture.name}: duration ${duration}`);
      const sample = await source.getSample(0.5, 1, {});
      const metadata = JSON.parse(execute(ffprobe, ["-v", "error", "-show_streams", "-show_format", "-of", "json", sample]));
      assert.equal(metadata.streams.length, 1);
      assert.equal(metadata.streams[0].codec_type, "audio");
      assert.equal(metadata.streams[0].codec_name, "pcm_s16le");
      assert.equal(metadata.streams[0].channels, 1);
      assert.equal(metadata.streams[0].sample_rate, "16000");
      assert.ok(Math.abs(Number(metadata.format.duration) - 1) < 0.1);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Real-world MP4 (a downloaded video): probe + sample must succeed end to end.
// Set VERIFY_MP4 to any local .mp4 to run this against your own file.
const realMp4 = process.env.VERIFY_MP4 ?? "C:/Users/ADMIN/Downloads/videoplayback.mp4";
test("LocalFileAudioSource reads a real downloaded MP4", { skip: !existsSync(realMp4) && "no sample MP4" }, async () => {
  const { LocalFileAudioSource } = loadTs("lib/server/audio/LocalFileAudioSource.ts");
  const dir = mkdtempSync(path.join(root, "scripts", ".verify-real-"));
  try {
    const source = new LocalFileAudioSource(realMp4, path.basename(realMp4), dir);
    await source.prepare({});
    const duration = await source.getDuration();
    assert.ok(duration > 10, `duration ${duration}`);
    // Sample from the middle, the way the scanner does.
    const sample = await source.getSample(Math.floor(duration / 2), 12, {});
    assert.ok(statSync(sample).size > 16000 * 2 * 11, "12s of mono 16-bit 16kHz PCM expected");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Spotify links parse and canonicalize", () => {
  const { parseSpotifyUrl, canonicalSpotifyUrl, spotifyEmbedUrl } = loadTs("lib/spotify.ts");
  const { canonicalMediaUrl } = loadTs("lib/mediaUrl.ts");
  const id = "5pk7cWIp56YkrwyWU7eMTr";
  for (const raw of [
    `https://open.spotify.com/playlist/${id}?si=zyr8qZnxQd2Oz0eAbWKtLA`,
    `https://open.spotify.com/intl-th/playlist/${id}`,
    `https://open.spotify.com/embed/playlist/${id}`,
    `spotify:playlist:${id}`,
  ]) {
    assert.deepEqual(parseSpotifyUrl(raw), { type: "playlist", id }, raw);
    assert.equal(canonicalMediaUrl(raw), `https://open.spotify.com/playlist/${id}`);
  }
  assert.deepEqual(parseSpotifyUrl(`https://open.spotify.com/album/${id}`), { type: "album", id });
  assert.deepEqual(parseSpotifyUrl(`https://open.spotify.com/track/${id}`), { type: "track", id });
  assert.equal(canonicalSpotifyUrl({ type: "track", id }), `https://open.spotify.com/track/${id}`);
  assert.equal(spotifyEmbedUrl(`https://open.spotify.com/track/${id}`), `https://open.spotify.com/embed/track/${id}`);
  for (const bad of ["https://open.spotify.com/artist/" + id, "https://open.spotify.com/playlist/short", "https://youtube.com/watch?v=abc", "not a url", ""]) {
    assert.equal(parseSpotifyUrl(bad), null, bad);
  }
  // YouTube canonicalization is untouched.
  assert.equal(canonicalMediaUrl("https://youtu.be/dQw4w9WgXcQ?si=x"), "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
});

test("Spotify tracklist is read from a public playlist link", { skip: process.env.VERIFY_OFFLINE && "offline" }, async () => {
  const { fetchSpotifyTracklist } = loadTs("lib/server/spotify.ts");
  const list = await fetchSpotifyTracklist("https://open.spotify.com/playlist/5pk7cWIp56YkrwyWU7eMTr?si=zyr8qZnxQd2Oz0eAbWKtLA");
  assert.equal(list.ref.type, "playlist");
  assert.ok(list.title.length > 0);
  assert.ok(list.tracks.length >= 50, `got ${list.tracks.length} tracks`);
  for (const t of list.tracks.slice(0, 10)) {
    assert.ok(t.title && t.artist, JSON.stringify(t));
    assert.ok(t.durationMs > 0);
  }
  await assert.rejects(fetchSpotifyTracklist("https://open.spotify.com/playlist/0000000000000000000000"), /Spotify/);
});

test("DJ Pool ranking modes order candidates as documented", () => {
  const { rankCandidates } = loadTs("lib/server/djpool/matcher.ts");
  const { DEFAULT_DJPOOL_PREFERENCES } = loadTs("lib/types.ts");
  const file = (name) => ({ name, ext: "mp3", size: "9 MB", mime: "audio/mpeg", download: `https://djpoolrecords.com/${encodeURIComponent(name)}` });
  // Order below is "what the pool returned".
  const files = [
    file("Other Artist - See You Again (Clean) 100"),
    file("Wiz Khalifa - See You Again (Intro Dirty) 80"),
    file("Wiz Khalifa - See You Again (Clean) 80"),
    file("Wiz Khalifa - See You Again (Dirty) 80"),
    file("Wiz Khalifa - See You Again (Acapella) 80"),
  ];
  const rank = (rankingMode) => rankCandidates("See You Again", "Wiz Khalifa", files, { ...DEFAULT_DJPOOL_PREFERENCES, rankingMode }, 10);

  const byDefault = rank("default");
  assert.equal(byDefault.matched, true);
  assert.notEqual(byDefault.candidates[0].name, files[0].name, "title collision must not win");
  assert.ok(!/Intro|Acapella/.test(byDefault.candidates[0].name), byDefault.candidates[0].name);
  // Same-song files first (acapella last among them), the title collision after all of them.
  assert.equal(byDefault.candidates[3].name, files[4].name, "acapella ranks last of the real matches");
  assert.equal(byDefault.candidates.at(-1).name, files[0].name, "other artist stays for the picker only");

  const pool = rank("pool");
  assert.deepEqual(pool.candidates.map((c) => c.name), files.map((f) => f.name), "pool mode keeps pool order");
  assert.equal(pool.matched, false, "first pool hit is another artist, so nothing is auto-picked");

  assert.equal(rank("introDirty").candidates[0].name, files[1].name);
  assert.equal(rank("clean").candidates[0].name, files[2].name);
  assert.equal(rank("introDirty").candidates[3].name, files[4].name, "acapella still last of the real matches");

  // Unknown / legacy settings without rankingMode behave like default.
  const legacy = rankCandidates("See You Again", "Wiz Khalifa", files, { ...DEFAULT_DJPOOL_PREFERENCES, rankingMode: undefined }, 10);
  assert.deepEqual(legacy.candidates.map((c) => c.name), byDefault.candidates.map((c) => c.name));
});
