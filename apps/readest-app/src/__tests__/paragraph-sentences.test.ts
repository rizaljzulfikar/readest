import { describe, expect, it } from 'vitest';

import {
  buildSentenceTranslationPlan,
  getTextPositionAt,
  splitIntoSentences,
} from '@/app/reader/components/paragraph/paragraphSentences';

const spanTexts = (text: string) => splitIntoSentences(text).map((span) => span.text);

describe('splitIntoSentences', () => {
  it('splits three English sentences and keeps offsets aligned', () => {
    const text = 'Hello world. How are you? Nice!';
    const spans = splitIntoSentences(text);
    expect(spans.map((span) => span.text)).toEqual(['Hello world.', ' How are you?', ' Nice!']);
    expect(spans.map((span) => [span.start, span.end])).toEqual([
      [0, 12],
      [12, 25],
      [25, 31],
    ]);
    for (const span of spans) {
      expect(text.slice(span.start, span.end)).toBe(span.text);
    }
  });

  it('keeps a paragraph without terminators as one sentence', () => {
    expect(spanTexts('just a fragment')).toEqual(['just a fragment']);
  });

  it('returns nothing for empty text', () => {
    expect(splitIntoSentences('')).toEqual([]);
  });

  it('does not split decimals', () => {
    expect(spanTexts('Pi is 3.14 exactly. Yes.')).toEqual(['Pi is 3.14 exactly.', ' Yes.']);
  });

  it('does not split common abbreviations and initials', () => {
    expect(spanTexts('Mr. Smith met Dr. Adams at 5 p.m. They talked.')).toEqual([
      'Mr. Smith met Dr. Adams at 5 p.m. They talked.',
    ]);
    expect(spanTexts('J. K. Rowling wrote it. Truly.')).toEqual([
      'J. K. Rowling wrote it.',
      ' Truly.',
    ]);
  });

  it('attaches closing quotes to the sentence', () => {
    expect(spanTexts(`"Stop!" she said. Then left.`)).toEqual([`"Stop!" she said.`, ' Then left.']);
  });

  it('splits CJK sentences at 。！？', () => {
    expect(spanTexts('你好。再见！真的？是的。')).toEqual(['你好。', '再见！', '真的？', '是的。']);
  });

  it('attaches CJK closing brackets to the sentence', () => {
    expect(spanTexts('彼は「行く。」と言った。それから帰った。')).toEqual([
      '彼は「行く。」と言った。',
      'それから帰った。',
    ]);
  });

  it('handles mixed Latin and CJK', () => {
    expect(spanTexts('He said hello. 她说再见！')).toEqual(['He said hello.', ' 她说再见！']);
  });

  it('splits "?! runs once', () => {
    expect(spanTexts('What?! Really?! Stop.')).toEqual(['What?!', ' Really?!', ' Stop.']);
  });

  it('trims whitespace-only text into no sentences', () => {
    expect(splitIntoSentences('   ').every((span) => !span.text.trim())).toBe(true);
  });
});

describe('buildSentenceTranslationPlan', () => {
  it('skips cfi-inert and book-translation nodes in the baseline', () => {
    const div = document.createElement('div');
    div.innerHTML =
      'First sentence. <font class="translation-target" translation-element-mark="1">Pertama.</font> Second one. <span cfi-inert>gloss</span> Third.';
    document.body.appendChild(div);
    try {
      const plan = buildSentenceTranslationPlan(div);
      expect(plan?.baseline).toBe('First sentence.  Second one.  Third.');
      expect(plan?.sentences.map((span) => span.text.trim())).toEqual([
        'First sentence.',
        'Second one.',
        'Third.',
      ]);
    } finally {
      div.remove();
    }
  });

  it('computes insertion bookmarks on the filtered baseline', () => {
    const div = document.createElement('div');
    div.innerHTML = 'One two. <b>Three four.</b>';
    document.body.appendChild(div);
    try {
      const plan = buildSentenceTranslationPlan(div);
      expect(plan?.sentences).toHaveLength(2);
      const end = plan!.sentences[0]!.end;
      const position = getTextPositionAt(div, end);
      expect(position).not.toBeNull();
      // The bookmark sits inside the first text node, right after the period.
      expect(position!.node.textContent).toContain('One two.');
      expect(position!.offset).toBe(end);
      // Splitting at the bookmark and inserting keeps the baseline intact.
      const wrapper = document.createElement('font');
      wrapper.setAttribute('cfi-inert', '');
      const secondHalf = position!.node.splitText(position!.offset);
      position!.node.parentNode!.insertBefore(wrapper, secondHalf);
      const after = buildSentenceTranslationPlan(div);
      expect(after?.baseline).toBe(plan!.baseline);
    } finally {
      div.remove();
    }
  });

  it('returns a bookmark at the very end of the paragraph', () => {
    const div = document.createElement('div');
    div.innerHTML = 'Only sentence.';
    document.body.appendChild(div);
    try {
      const plan = buildSentenceTranslationPlan(div)!;
      const lastEnd = plan.sentences[plan.sentences.length - 1]!.end;
      const position = getTextPositionAt(div, lastEnd);
      expect(position).not.toBeNull();
      expect(position!.offset).toBe(position!.node.textContent!.length);
    } finally {
      div.remove();
    }
  });
});
