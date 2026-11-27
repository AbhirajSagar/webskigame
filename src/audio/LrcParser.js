/**
 * LrcParser
 * Parses standard .lrc lyric files including multiple timestamps per line,
 * 2/3-digit fractional seconds, and [offset:+/-ms] / metadata tags.
 */

const TIME_TAG_RE = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const META_TAG_RE = /^\[([a-zA-Z]+):([^\]]*)\]$/;

/**
 * @param {string} rawText
 * @returns {{
 *   metadata: Record<string, string>,
 *   offsetMs: number,
 *   lines: Array<{ time: number, text: string }>
 * }}
 */
export function parseLrc(rawText) {
  const metadata = {};
  let offsetMs = 0;
  const entries = [];

  if (typeof rawText !== 'string' || !rawText.trim()) {
    return { metadata, offsetMs, lines: [] };
  }

  const rawLines = rawText.replace(/\r\n?/g, '\n').split('\n');

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    TIME_TAG_RE.lastIndex = 0;
    const matches = [...trimmed.matchAll(TIME_TAG_RE)];

    if (matches.length === 0) {
      const metaMatch = trimmed.match(META_TAG_RE);
      if (metaMatch) {
        const key = metaMatch[1].toLowerCase();
        const val = metaMatch[2].trim();
        metadata[key] = val;
        if (key === 'offset') {
          const parsedOffset = Number(val);
          if (Number.isFinite(parsedOffset)) {
            offsetMs = parsedOffset;
          }
        }
      }
      continue;
    }

    const lyricText = trimmed.replace(TIME_TAG_RE, '').trim();
    for (const m of matches) {
      const minutes = Number(m[1]);
      const seconds = Number(m[2]);
      const fracStr = m[3] || '';
      let fracSec = 0;
      if (fracStr.length === 1) fracSec = Number(fracStr) / 10;
      else if (fracStr.length === 2) fracSec = Number(fracStr) / 100;
      else if (fracStr.length === 3) fracSec = Number(fracStr) / 1000;

      const time = Math.max(0, minutes * 60 + seconds + fracSec);
      entries.push({ time, text: lyricText });
    }
  }

  // Apply LRC [offset] tag (positive offset shifts lyrics earlier in standard LRC)
  const offsetSec = offsetMs / 1000;
  for (const entry of entries) {
    entry.time = Math.max(0, entry.time - offsetSec);
  }

  entries.sort((a, b) => a.time - b.time);

  // Deduplicate identical timestamps keeping the non-empty text if both exist
  const lines = [];
  for (const entry of entries) {
    const prev = lines[lines.length - 1];
    if (prev && Math.abs(prev.time - entry.time) < 0.001) {
      if (entry.text) prev.text = entry.text;
    } else {
      lines.push(entry);
    }
  }

  return { metadata, offsetMs, lines };
}

/**
 * Binary-searches the active lyric index for a given playback time in seconds.
 * @param {Array<{ time: number, text: string }>} lines
 * @param {number} currentTimeSec
 * @returns {{ index: number, current: { time: number, text: string } | null, next: { time: number, text: string } | null }}
 */
export function findActiveLyric(lines, currentTimeSec) {
  if (!Array.isArray(lines) || lines.length === 0 || currentTimeSec < lines[0].time) {
    return {
      index: -1,
      current: null,
      next: lines?.[0]?.text ? lines[0] : null,
    };
  }

  let lo = 0;
  let hi = lines.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].time <= currentTimeSec) {
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  const index = hi;
  const current = lines[index] || null;
  let next = null;
  for (let i = index + 1; i < lines.length; i++) {
    if (lines[i].text) {
      next = lines[i];
      break;
    }
  }

  return { index, current, next };
}
