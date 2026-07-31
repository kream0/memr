/**
 * Fitting handoff text to the store's ceiling without losing work silently.
 *
 * A handoff is written at the end of a session, when context is already tight.
 * Rejecting it costs a full round trip to rewrite it, which is the friction this
 * module exists to remove. The contract:
 *
 *   - up to MAX_BELIEF_TEXT_LENGTH: stored as written, no output;
 *   - up to MAX_HANDOFF_TEXT_LENGTH: stored IN FULL, with a notice on stderr.
 *     Nothing is lost, so nothing needs deciding;
 *   - beyond that: trimmed to fit and stored, with a warning naming exactly how
 *     many characters went and which sections they came from.
 *
 * Trimming is never silent and never blind. Handoffs carry a STATE / NEXT /
 * BLOCKERS structure whose parts are not equally valuable: losing half of
 * BLOCKERS is worse than a shorter STATE, because BLOCKERS is what the next
 * session cannot rediscover on its own. So sections are shortened in increasing
 * order of value, each at a word boundary, and every section keeps its label and
 * a readable amount of body. Cutting the tail off the string instead — the
 * obvious implementation — is exactly the failure mode to avoid: it deletes
 * BLOCKERS first.
 */
import { MAX_BELIEF_TEXT_LENGTH, MAX_HANDOFF_TEXT_LENGTH, beliefTextLength } from '../storage/sqlite.js';

/**
 * Appended to a section that was shortened, so the truncation is visible in the
 * stored text itself and not only in the warning that scrolled past.
 *
 * ASCII on purpose: the bundler emits a `// @bun` pragma that makes the runtime
 * read dist/index.js as latin-1, so a non-ASCII ellipsis would reach the
 * terminal double-encoded.
 */
const TRIM_MARKER = ' ...';

/** A shortened section keeps at least this much body before others are touched. */
const MIN_BODY = 48;

/** Section labels, in increasing order of what they cost to lose. */
const SECTION_PRIORITY: ReadonlyArray<{ test: RegExp; priority: number }> = [
  { test: /^STATE/i, priority: 1 },
  { test: /^NEXT/i, priority: 2 },
  { test: /^BLOCK/i, priority: 3 },
];

/** Matches a section label anywhere in the text: handoffs are written both as
 *  one line ("STATE: x. NEXT: y") and as several. */
const LABEL_SCAN = /\b(STATE|NEXT|BLOCKERS?)\s*:/gi;

interface Section {
  /** Label as written, e.g. "STATE:". Empty for text before the first label. */
  label: string;
  body: string;
  /** Trailing whitespace, kept out of the body so trimming cannot weld two
   *  sections together. */
  tail: string;
  priority: number;
  /** Characters of body removed. Excludes the marker, which is added text. */
  dropped: number;
}

export interface FittedHandoff {
  /** Text to store. Guaranteed to satisfy the handoff CHECK. */
  text: string;
  originalLength: number;
  /** Characters of the original that are not in `text`. 0 when nothing was cut. */
  droppedChars: number;
  /** Set when the text is past the ordinary belief limit but stored in full. */
  overSoftLimit: boolean;
  /** Human-readable lines for stderr. Empty when the text fit with room to spare. */
  warnings: string[];
}

function priorityOf(label: string): number {
  for (const { test, priority } of SECTION_PRIORITY) {
    if (test.test(label)) return priority;
  }
  // Text before the first label: preamble, trimmed before any labelled section.
  return 0;
}

/** Splits body from the whitespace that follows it. */
function splitTail(raw: string): { body: string; tail: string } {
  const match = raw.match(/\s+$/);
  if (!match) return { body: raw, tail: '' };
  return { body: raw.slice(0, match.index), tail: match[0] };
}

function parseSections(text: string): Section[] {
  const marks: Array<{ start: number; label: string }> = [];
  LABEL_SCAN.lastIndex = 0;
  for (let m = LABEL_SCAN.exec(text); m !== null; m = LABEL_SCAN.exec(text)) {
    marks.push({ start: m.index, label: m[0] });
  }

  if (marks.length === 0) {
    const { body, tail } = splitTail(text);
    return [{ label: '', body, tail, priority: 0, dropped: 0 }];
  }

  const sections: Section[] = [];

  // Anything before the first label is a preamble; it holds no promised
  // structure, so it is the first thing shortened.
  if (marks[0]!.start > 0) {
    const { body, tail } = splitTail(text.slice(0, marks[0]!.start));
    sections.push({ label: '', body, tail, priority: 0, dropped: 0 });
  }

  for (let i = 0; i < marks.length; i++) {
    const mark = marks[i]!;
    const end = i + 1 < marks.length ? marks[i + 1]!.start : text.length;
    const raw = text.slice(mark.start + mark.label.length, end);
    const { body, tail } = splitTail(raw);
    sections.push({ label: mark.label, body, tail, priority: priorityOf(mark.label), dropped: 0 });
  }

  return sections;
}

function assemble(sections: Section[]): string {
  return sections.map((s) => s.label + s.body + s.tail).join('');
}

/** Code-point-safe hard cut, for text with no whitespace to cut at. */
function hardCut(text: string, max: number): string {
  if (max <= 0) return '';
  return [...text].slice(0, max).join('');
}

/** Cuts to at most `max` chars, backing up to the last word boundary. */
function cutAtWord(text: string, max: number): string {
  if (max <= 0) return '';
  if (text.length <= max) return text;

  const window = text.slice(0, max);
  for (let i = window.length - 1; i >= 0; i--) {
    if (/\s/.test(window[i]!)) {
      const cut = window.slice(0, i).trimEnd();
      // Only honour the boundary if it leaves something to read; a label whose
      // first word is longer than its budget would otherwise empty the section.
      if (cut.length > 0) return cut;
      break;
    }
  }
  return hardCut(window, max).trimEnd();
}

/**
 * Shortens `sections` in place until the assembled text fits `max`, taking
 * characters from the least valuable sections first.
 *
 * `floor` is the body length below which a section is left alone. The caller
 * runs this once with a floor, so every section stays readable, then again
 * without one if the text is still too long.
 */
function shrink(sections: Section[], max: number, floor: number): void {
  const order = [...sections].sort((a, b) => a.priority - b.priority);

  for (const section of order) {
    const overflow = assemble(sections).length - max;
    if (overflow <= 0) return;

    // A section trimmed by an earlier pass already carries a marker. Measure the
    // real body, or the marker would be counted as text the user lost.
    const raw = section.body.endsWith(TRIM_MARKER)
      ? section.body.slice(0, -TRIM_MARKER.length)
      : section.body;
    if (raw.length <= floor) continue;

    // Room the body may keep. The marker is added text, so it comes out of the
    // same budget.
    const target = Math.max(floor, section.body.length - overflow) - TRIM_MARKER.length;
    const kept = cutAtWord(raw, target);
    if (kept.length >= raw.length) continue;

    section.dropped += raw.length - kept.length;
    section.body = kept + TRIM_MARKER;

    // A trimmed section that ran straight into the next label needs a separator
    // put back, or the marker welds onto it.
    if (section.tail === '' && sections.indexOf(section) < sections.length - 1) {
      section.tail = ' ';
    }
  }
}

function describeDrops(sections: Section[]): string {
  const cut = sections.filter((s) => s.dropped > 0);
  if (cut.length === 0) return '';
  return cut.map((s) => `${s.label.replace(/\s*:$/, '') || 'preamble'} (-${s.dropped})`).join(', ');
}

/**
 * Prepares handoff text for storage. Never throws and never returns text the
 * store will reject: the returned text always satisfies the handoff CHECK, so
 * the caller's write cannot fail on length after this.
 */
export function fitHandoffText(text: string): FittedHandoff {
  const originalLength = beliefTextLength(text);

  if (originalLength <= MAX_BELIEF_TEXT_LENGTH) {
    return { text, originalLength, droppedChars: 0, overSoftLimit: false, warnings: [] };
  }

  if (originalLength <= MAX_HANDOFF_TEXT_LENGTH) {
    return {
      text,
      originalLength,
      droppedChars: 0,
      overSoftLimit: true,
      warnings: [
        `Notice: handoff is ${originalLength} characters, past the ${MAX_BELIEF_TEXT_LENGTH}-character ` +
          `guideline for beliefs. Stored in full, nothing was cut ` +
          `(handoffs may run to ${MAX_HANDOFF_TEXT_LENGTH}).`,
      ],
    };
  }

  const sections = parseSections(text);

  // Pass 1 keeps every section readable. Pass 2 only runs if that was not
  // enough, and gives up the floor rather than the structure.
  shrink(sections, MAX_HANDOFF_TEXT_LENGTH, MIN_BODY);
  if (assemble(sections).length > MAX_HANDOFF_TEXT_LENGTH) {
    shrink(sections, MAX_HANDOFF_TEXT_LENGTH, 0);
  }

  // Backstop: whatever happened above, the store must accept what we return.
  let fitted = assemble(sections);
  let unattributed = 0;
  if (beliefTextLength(fitted) > MAX_HANDOFF_TEXT_LENGTH) {
    const before = beliefTextLength(fitted);
    fitted = hardCut(fitted, MAX_HANDOFF_TEXT_LENGTH);
    unattributed = before - beliefTextLength(fitted);
  }

  // Characters of the user's text that are gone — NOT the change in length.
  // The two differ by the markers this function adds, and reporting the net
  // would contradict the per-section breakdown below.
  const droppedChars = sections.reduce((n, s) => n + s.dropped, 0) + unattributed;
  const breakdown = describeDrops(sections);

  return {
    text: fitted,
    originalLength,
    droppedChars,
    overSoftLimit: true,
    warnings: [
      `WARNING: handoff is ${originalLength} characters, over the ` +
        `${MAX_HANDOFF_TEXT_LENGTH}-character limit. It was TRIMMED to fit and stored; ` +
        `${droppedChars} characters were dropped.`,
      breakdown
        ? `  Trimmed at word boundaries, least important section first: ${breakdown}.`
        : `  Trimmed at a word boundary.`,
      `  Re-run with a shorter handoff if anything dropped still matters.`,
    ],
  };
}
