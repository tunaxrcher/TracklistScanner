import type { DjPoolCandidate, DjPoolPreferences } from "@/lib/types";
import { normalizeText, primaryArtist } from "@/lib/tracklist";
import type { PoolFile } from "@/lib/server/djpool/client";

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
  };
}

/**
 * Relevance 0..1: how well the candidate's base name covers the query tokens.
 * The title tokens are weighted more than the artist (some pool files omit or
 * abbreviate the artist).
 */
function relevance(title: string, artist: string, candidate: string): number {
  const base = baseName(candidate);
  const candTokens = new Set(tokens(base));
  const titleTokens = tokens(title);
  const artistTokens = tokens(primaryArtist(artist));

  const cover = (list: string[]) => {
    if (list.length === 0) return 1;
    const hit = list.filter((tok) => candTokens.has(tok)).length;
    return hit / list.length;
  };

  const titleCover = cover(titleTokens);
  const artistCover = cover(artistTokens);
  return titleCover * 0.7 + artistCover * 0.3;
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
  const rel = relevance(title, artist, file.name);
  const reasons: string[] = [];
  let score = rel * 100;

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

  if (f.remix && !titleWantsRemix && prefs.avoidRemix) { score -= 35; reasons.push("remix"); }
  if (f.remix && titleWantsRemix) { score += 10; reasons.push("remix wanted"); }

  // Prefer the plain, untagged full version (only clean/dirty tags present).
  if (!f.acapella && !f.instrumental && !f.intro && !f.outro && !f.transition && !f.remix && !f.shortEdit) {
    score += 8;
    reasons.push("full");
  }

  return { score: Math.round(score), reasons };
}

/**
 * Rank pool files for a track. Returns candidates sorted best-first (with a
 * relevance floor so obviously-wrong songs are dropped), plus whether a
 * confident match was found.
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
      const rel = relevance(title, artist, file.name);
      return { file, score, reasons, rel };
    })
    // Drop candidates that clearly are not the same song.
    .filter((c) => c.rel >= 0.5)
    .sort((a, b) => b.score - a.score);

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

  return { candidates, matched: candidates.length > 0 };
}
