import { isInertText } from '@/services/tts/wordHighlight';

/**
 * Sentence-by-sentence translation for Paragraph Mode.
 *
 * The overlay's clone re-uses the "injected content" conventions of the
 * reader: text under `cfi-inert` (or muted ruby) is not book text and is
 * skipped by every offset computation (selection mapping, annotation painting,
 * TTS highlight). Book-injected translations carry `translation-element-mark`
 * and must never be re-translated as if they were source prose.
 */

export interface SentenceSpan {
  text: string;
  /** Offsets into the paragraph's filtered baseline text. */
  start: number;
  end: number;
}

export interface SentencePlan {
  /** The clone's text with injected content excluded — the offsets' baseline. */
  baseline: string;
  sentences: SentenceSpan[];
}

const CJK_TERMINATORS = new Set(['。', '！', '？', '．']);
// Closing quotes/brackets that attach to the sentence they follow. Straight
// quotes are included as attachers only — they are ambiguous openers
// (apostrophes, nested dialogue) and take no part in quote-depth tracking.
const CLOSING_CHARS = new Set(['"', "'", ')', ']', '”', '’', '」', '』', '）', '»', '›']);
// Unambiguous quote pairs, tracked for depth: a terminator inside an open
// quoted region belongs to the quoted speech, not to the enclosing sentence
// (「行く。」と言った). Straight quotes stay untracked (see above).
const OPEN_QUOTES = new Set(['「', '『', '（', '“', '‘', '《', '〈', '(']);
const TRACKED_CLOSE_QUOTES = new Set(['」', '』', '）', '”', '’', '》', '〉', ')']);

// Common abbreviations that do not end a sentence when followed by a space.
const ABBREVIATIONS = new Set([
  'mr',
  'mrs',
  'ms',
  'dr',
  'prof',
  'st',
  'sr',
  'jr',
  'vs',
  'etc',
  'e.g',
  'i.e',
  'fig',
  'no',
  'vol',
  'ch',
  'pp',
  'al',
  'ltd',
  'inc',
  'co',
]);

const isTerminator = (ch: string) =>
  ch === '.' || ch === '!' || ch === '?' || CJK_TERMINATORS.has(ch);

// Token of letters and dots ending right before the terminator: "Mr", "p.m",
// "J". Empty for digits, punctuation or scripts without letters.
const tokenBefore = (text: string, end: number): string => {
  let start = end;
  while (start > 0) {
    const ch = text[start - 1]!;
    if (!/[A-Za-z.]/.test(ch)) break;
    start--;
  }
  return text.slice(start, end);
};

const isAbbreviationToken = (token: string): boolean => {
  if (!token) return false;
  const lower = token.toLowerCase();
  if (ABBREVIATIONS.has(lower)) return true;
  // Dotted short tokens: initials and style abbreviations — "U.S", "e.g", "a.m".
  if (token.includes('.')) return token.length <= 4 && /^[A-Za-z.]+$/.test(token);
  // A lone uppercase letter is an initial: "J. K. Rowling".
  return /^[A-Z]$/.test(token);
};

/**
 * Split `text` into sentence spans. Terminators stay attached to their
 * sentence, as do closing quotes/brackets. Sentences are never dropped: a
 * paragraph without any terminator comes back as a single span.
 *
 * Three merge guards keep natural sentences whole:
 * - a '.' needs whitespace after it (decimals, domains, "p.m." internals);
 * - an abbreviation/initial token before a '.' keeps the sentence going;
 * - a terminator followed by a lowercase word continues the sentence ("Stop!"
 *   she said) — dialogue tags, "etc. and so on";
 * - a CJK terminator inside an open quoted region continues the sentence —
 *   quoted speech is followed by an attribution (「行く。」と言った).
 */
export const splitIntoSentences = (text: string): SentenceSpan[] => {
  const spans: SentenceSpan[] = [];
  if (!text) return spans;

  const push = (end: number) => {
    if (end > start) spans.push({ text: text.slice(start, end), start, end });
  };
  let start = 0;
  let quoteDepth = 0;
  const feedQuote = (ch: string) => {
    if (OPEN_QUOTES.has(ch)) quoteDepth++;
    else if (TRACKED_CLOSE_QUOTES.has(quoteDepth > 0 ? ch : '')) quoteDepth--;
  };
  const nextNonSpace = (from: number): string | undefined => {
    let j = from;
    while (j < text.length && /\s/.test(text[j]!)) j++;
    return text[j];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (!isTerminator(ch)) {
      feedQuote(ch);
      continue;
    }
    const depthAtTerminator = quoteDepth;

    // Consume the terminator run plus attached closing quotes/brackets.
    let end = i + 1;
    while (end < text.length && (isTerminator(text[end]!) || CLOSING_CHARS.has(text[end]!))) {
      feedQuote(text[end]!);
      end++;
    }

    if (ch === '.') {
      // Whitespace must separate the period from the next word — rules out
      // decimals ("3.14") and domain names ("example.com").
      let j = end;
      while (j < text.length && /\s/.test(text[j]!)) j++;
      if (j === end) continue;
      // Abbreviations and initials keep their sentence going.
      if (j < text.length && isAbbreviationToken(tokenBefore(text, i))) continue;
    }

    // A lowercase word after the terminator continues the sentence: dialogue
    // tags ("Stop!" she said) and mid-sentence pauses (etc. and so on).
    const next = nextNonSpace(end);
    if (next && /[a-z]/.test(next)) continue;

    // Quoted CJK speech keeps its attribution: 「行く。」と言った。
    if (depthAtTerminator > 0 && CJK_TERMINATORS.has(ch)) continue;

    push(end);
    start = end;
  }
  if (start < text.length) push(text.length);
  return spans;
};

const isInjectedNode = (node: Node): boolean => {
  if (isInertText(node)) return true;
  const parent = node.parentElement;
  // `translation-element-mark` marks book-page translations, but the sanitizer
  // strips that attribute when the overlay clones the paragraph — the
  // `translation-target` class is what survives there.
  return !!parent && parent.closest('[translation-element-mark], .translation-target') !== null;
};

/** Filtered text-node walk shared by the baseline and bookmark builders. */
const forEachBaselineTextNode = (root: Node, visit: (node: Text) => void): void => {
  if (root.nodeType === Node.TEXT_NODE) {
    if (!isInjectedNode(root)) visit(root as Text);
    return;
  }
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!isInjectedNode(node)) visit(node as Text);
  }
};

/**
 * Baseline text of a paragraph clone plus its sentence spans. Injected content
 * (cfi-inert glosses, book translation wrappers, previously inserted sentence
 * translations) is excluded, so the spans describe exactly the source prose.
 */
export const buildSentenceTranslationPlan = (root: Node): SentencePlan | null => {
  let baseline = '';
  forEachBaselineTextNode(root, (node) => {
    baseline += node.data;
  });
  if (!baseline) return null;
  return { baseline, sentences: splitIntoSentences(baseline) };
};

export interface TextPosition {
  node: Text;
  /** Insertion offset within `node` (0..node.length). */
  offset: number;
}

/**
 * Bookmark for the baseline position `offset`: the text node containing it and
 * the local offset where new content can be inserted (the node is split there).
 * Returns null when the offset is outside the baseline.
 */
export const getTextPositionAt = (root: Node, offset: number): TextPosition | null => {
  if (offset < 0) return null;
  let pos = 0;
  let result: TextPosition | null = null;
  forEachBaselineTextNode(root, (node) => {
    if (result) return;
    const length = node.data.length;
    if (offset <= pos + length) {
      result = { node, offset: offset - pos };
    }
    pos += length;
  });
  return result;
};
