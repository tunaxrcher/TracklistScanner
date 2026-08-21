import type { DjPoolCandidate, DjPoolPreferences } from "@/lib/types";
import { normalizeText, primaryArtist } from "@/lib/tracklist";
import { searchPoolFiles, type PoolFile } from "@/lib/server/djpool/client";

/**
 * Build the search query for a detected track: primary artist + title with all
 * parenthetical decorations stripped. Meilisearch (behind the pool) is typo and
 * order tolerant, so a clean "artist title" performs best.
 */
export function buildQuery(title: string, artist: string): string {
  const cleanTitle = title
    .replace(/\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\b(feat|ft|prod)\.?\s.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  const artistPart = artist.split(/,|&|×|\/|\bfeat\.?\s|\bft\.?\s|\bwith\s/i)[0].trim();
  return `${artistPart} ${cleanTitle}`.replace(/\s+/g, " ").trim();
}

function tokens(text: string): string[] {
  return normalizeText(text).split(" ").filter(Boolean);
}

/** Extract parenthetical tag groups, e.g. "(Clean)" "(Intro Edit)". */
function tagText(name: string): string {
  const groups = [...name.matchAll(/\(([^)]*)\)/g)].map((m) => m[1]).join(" ");
  return groups.toLowerCase();
}

/** Candidate name with tags + trailing bpm removed → "artist - title". */
function baseName(name: string): string {
  return name
    .replace(/\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\b\d{2,3}\b\s*$/, "")
    .trim();
}

interface Flags {
  clean: boolean;
  dirty: boolean;
  acapella: boolean;
  instrumental: boolean;
  intro: boolean;
  outro: boolean;
  remix: boolean;
  transition: boolean;
  shortEdit: boolean;
  karaoke: boolean;
  spedSlowed: boolean;
}

function flags(name: string): Flags {
  const t = tagText(name);
  const full = name.toLowerCase();
  return {
    clean: /\bclean\b/.test(t),
    dirty: /\bdirty\b|\bexplicit\b/.test(t),
    // Pools abbreviate heavily: "Acap", "Acapella", "Accapella", "Studio Acap".
    acapella: /\bacap(p?ella)?\b|\baccapella\b/.test(full),
    // "Inst", "Instr", "Diy Inst", "Instrumental".
    instrumental: /\binst(r|rumental)?\b|instrumental/.test(full),
    intro: /\bintro\b/.test(full),
    outro: /\boutro\b/.test(full),
    remix: /remix|rework|flip|bootleg|mashup|refix|re-?drum|redrum|vip mix/.test(full),
    transition: /transition|segue|quick ?hit|starter|\bacap(p?ella)?\s*(in|out)\b/.test(full),
    shortEdit: /\b(short|quick)\b.*\bedit\b|\bedit short\b/.test(full),
    karaoke: /\bkaraoke\b/.test(full),
    spedSlowed: /\bsped ?up\b|\bslowed\b|\bnightcore\b/.test(full),
  };
}

interface Coverage {
  /** Fraction of the track's title tokens present in the candidate name. */
  title: number;
  /** Fraction of the primary artist's tokens present in the candidate name. */
  artist: number;
  /** Whether the track has any usable artist tokens at all. */
  hasArtist: boolean;
  /** Weighted blend used for ordering (title matters more). */
  combined: number;
}

// Tokens too common in pool file names to say anything about the artist
// ("Tomi Dj" must not match "Dj Underblasth" just because both contain "dj").
const GENERIC_ARTIST_TOKENS = new Set(["dj", "mc", "the"]);

/** How well the candidate's base name covers the track's title/artist tokens. */
function coverage(title: string, artist: string, candidate: string): Coverage {
  const candTokens = new Set(tokens(baseName(candidate)));
  const titleTokens = tokens(title);
  const allArtistTokens = tokens(primaryArtist(artist));
  const distinctive = allArtistTokens.filter((t) => !GENERIC_ARTIST_TOKENS.has(t));
  // Only fall back to the generic tokens when the artist name has nothing else.
  const artistTokens = distinctive.length > 0 ? distinctive : allArtistTokens;

  const cover = (list: string[]) => {
    if (list.length === 0) return 1;
    const hit = list.filter((tok) => candTokens.has(tok)).length;
    return hit / list.length;
  };

  const titleCover = cover(titleTokens);
  const artistCover = cover(artistTokens);
  return {
    title: titleCover,
    artist: artistCover,
    hasArtist: artistTokens.length > 0,
    combined: titleCover * 0.7 + artistCover * 0.3,
  };
}

/**
 * A candidate we would auto-download must be the SAME SONG, not just a title
 * collision: full title coverage AND at least half the artist tokens (many
 * songs share a title — "One Kiss", "Closer" — but artists rarely collide).
 */
function isStrongMatch(cov: Coverage): boolean {
  return cov.title >= 0.99 && (!cov.hasArtist || cov.artist >= 0.5);
}

/**
 * Score a single candidate for a detected track. Higher is better. Relevance
 * dominates so we never grab the wrong song; version tags fine-tune which
 * variant of the right song to pick.
 */
export function scoreCandidate(
  title: string,
  artist: string,
  file: PoolFile,
  prefs: DjPoolPreferences,
): { score: number; reasons: string[] } {
  const cov = coverage(title, artist, file.name);
  const reasons: string[] = [];
  let score = cov.combined * 100;

  const f = flags(file.name);
  const titleWantsRemix = /remix|rework|flip|bootleg|mashup|refix/i.test(title);

  // Version preference (clean/dirty).
  if (prefs.versionPreference === "clean") {
    if (f.clean) { score += 18; reasons.push("clean"); }
    else if (f.dirty) { score -= 12; }
  } else if (prefs.versionPreference === "dirty") {
    if (f.dirty) { score += 18; reasons.push("dirty"); }
    else if (f.clean) { score -= 12; }
  } else {
    // "either": a labelled clean/dirty full version is still better than a
    // special edit, so give a small nudge.
    if (f.clean || f.dirty) { score += 6; }
  }

  if (prefs.avoidAcapella && f.acapella) { score -= 60; reasons.push("acapella"); }
  if (prefs.avoidInstrumental && f.instrumental) { score -= 60; reasons.push("instrumental"); }
  if (prefs.avoidIntroOutro && (f.intro || f.outro)) { score -= 22; reasons.push("intro/outro"); }
  if (f.transition) { score -= 50; reasons.push("transition"); }
  if (f.shortEdit) { score -= 15; reasons.push("short edit"); }
  if (f.karaoke) { score -= 60; reasons.push("karaoke"); }
  if (f.spedSlowed) { score -= 35; reasons.push("sped/slowed"); }

  if (f.remix && !titleWantsRemix && prefs.avoidRemix) { score -= 35; reasons.push("remix"); }
  if (f.remix && titleWantsRemix) { score += 10; reasons.push("remix wanted"); }

  // Prefer the plain, untagged full version (only clean/dirty tags present).
  if (!f.acapella && !f.instrumental && !f.intro && !f.outro && !f.transition && !f.remix && !f.shortEdit && !f.karaoke && !f.spedSlowed) {
    score += 8;
    reasons.push("full");
  }

  return { score: Math.round(score), reasons };
}

/**
 * Rank pool files for a track.
 *
 * Strong matches (same song for sure) are ordered before loose ones, so
 * `candidates[0]` is always safe to auto-download when `matched` is true.
 * Loose candidates (title collisions, partial matches) are kept in the list
 * for the manual "Choose a version" picker but never auto-picked.
 */
export function rankCandidates(
  title: string,
  artist: string,
  files: PoolFile[],
  prefs: DjPoolPreferences,
  keep = 6,
): { candidates: DjPoolCandidate[]; matched: boolean } {
  const scored = files
    .map((file) => {
      const { score, reasons } = scoreCandidate(title, artist, file, prefs);
      const cov = coverage(title, artist, file.name);
      return { file, score, reasons, strong: isStrongMatch(cov), combined: cov.combined };
    })
    // Drop candidates that clearly are not the same song.
    .filter((c) => c.combined >= 0.5)
    .sort((a, b) => Number(b.strong) - Number(a.strong) || b.score - a.score);

  const candidates: DjPoolCandidate[] = scored.slice(0, keep).map((c) => ({
    name: c.file.name,
    ext: c.file.ext,
    size: c.file.size,
    mime: c.file.mime,
    download: c.file.download,
    stream: c.file.stream,
    score: c.score,
    reasons: c.reasons,
  }));

  return { candidates, matched: scored.length > 0 && scored[0].strong };
}

/**
 * Search + rank in one step, with a title-only fallback.
 *
 * The pool's Meilisearch drops terms from the END of the query until
 * something matches, so an "artist title" query whose artist is unknown to
 * the pool either returns nothing or returns junk that only matched the
 * artist words (which ranking then filters out). When ranking the primary
 * search yields no usable candidate, a second title-only search surfaces
 * same-title files for the manual picker.
 */
export async function findCandidates(
  title: string,
  artist: string,
  prefs: DjPoolPreferences,
  keep = 6,
): Promise<{ query: string; candidates: DjPoolCandidate[]; matched: boolean }> {
  const primary = buildQuery(title, artist);
  let ranked: { candidates: DjPoolCandidate[]; matched: boolean } = { candidates: [], matched: false };
  if (primary) {
    const files = await searchPoolFiles(primary, 40, 0);
    ranked = rankCandidates(title, artist, files, prefs, keep);
  }

  const titleOnly = buildQuery(title, "");
  if (ranked.candidates.length === 0 && titleOnly && titleOnly !== primary) {
    const files = await searchPoolFiles(titleOnly, 40, 0);
    ranked = rankCandidates(title, artist, files, prefs, keep);
  }

  return { query: primary || titleOnly, ...ranked };
}
