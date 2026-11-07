import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';

import ParagraphOverlay from '@/app/reader/components/paragraph/ParagraphOverlay';
import { eventDispatcher } from '@/utils/event';
import { ViewSettings } from '@/types/book';
import {
  DEFAULT_ANNOTATOR_CONFIG,
  DEFAULT_BOOK_FONT,
  DEFAULT_BOOK_LANGUAGE,
  DEFAULT_BOOK_LAYOUT,
  DEFAULT_BOOK_STYLE,
  DEFAULT_SCREEN_CONFIG,
  DEFAULT_TTS_CONFIG,
  DEFAULT_TRANSLATOR_CONFIG,
  DEFAULT_VIEW_CONFIG,
} from '@/services/constants';
import { getTextSubRange } from '@/services/tts/wordHighlight';
import { buildSentenceTranslationPlan } from '@/app/reader/components/paragraph/paragraphSentences';
import '@/styles/globals.css';

vi.mock('@/hooks/useTranslator', () => ({
  useTranslator: () => ({
    translate: vi.fn(async (texts: string[]) => texts.map((text) => `ID:${text}`)),
    translator: { concurrency: 2 },
    translators: [],
    loading: false,
  }),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: { hasSafeAreaInset: false, isAndroidApp: false } }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: { globalReadSettings: {} } }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getViewSettings: () => ({}),
    setViewSettings: vi.fn(),
    getProgress: () => null,
    getView: () => null,
  }),
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: (selector?: (state: unknown) => unknown) => {
    const state = {
      getBookData: () => ({ isFixedLayout: false }),
      booksData: {
        'browser-book': { book: { title: 'Book', author: 'Author' }, config: { booknotes: [] } },
      },
    };
    return selector ? selector(state) : state;
  },
}));

const viewSettings = {
  ...DEFAULT_BOOK_FONT,
  ...DEFAULT_BOOK_LAYOUT,
  ...DEFAULT_BOOK_LANGUAGE,
  ...DEFAULT_BOOK_STYLE,
  ...DEFAULT_VIEW_CONFIG,
  ...DEFAULT_TTS_CONFIG,
  ...DEFAULT_TRANSLATOR_CONFIG,
  ...DEFAULT_ANNOTATOR_CONFIG,
  ...DEFAULT_SCREEN_CONFIG,
  paragraphMode: { enabled: true, translationEnabled: true },
  translationProvider: 'deepl',
  translateTargetLang: 'ID',
} as ViewSettings;

describe('paragraph sentence translation in a real browser', () => {
  afterEach(() => {
    cleanup();
    document.querySelectorAll('#paragraph-translation-source').forEach((node) => node.remove());
  });

  test('interleaves each sentence with its translation on its own line', async () => {
    const source = document.createElement('p');
    source.id = 'paragraph-translation-source';
    source.textContent = 'Hello world. How are you? Nice day.';
    document.body.appendChild(source);
    const range = document.createRange();
    range.selectNodeContents(source);

    const { container } = render(
      <ParagraphOverlay bookKey='browser-book' viewSettings={viewSettings} />,
    );

    await act(async () => {
      await eventDispatcher.dispatch('paragraph-focus', {
        bookKey: 'browser-book',
        range,
        presentation: { dir: 'ltr', writingMode: 'horizontal-tb', vertical: false, rtl: false },
      });
    });

    const clone = await act(async () => {
      const node = container.querySelector('.paragraph-content');
      expect(node).not.toBeNull();
      return node as HTMLElement;
    });

    // One translation block per sentence, in order, right after its sentence.
    // The batch settles briefly (debounced) before the request goes out.
    const translations = await waitFor(() => {
      const nodes = clone.querySelectorAll<HTMLElement>('.paragraph-translation-target');
      expect(nodes.length).toBe(3);
      return Array.from(nodes);
    });
    expect(Array.from(translations).map((node) => node.textContent)).toEqual([
      'ID:Hello world.',
      'ID:How are you?',
      'ID:Nice day.',
    ]);
    for (const node of translations) {
      // Real layout: block-level, in the target language, marked inert.
      expect(getComputedStyle(node).display).toBe('block');
      expect(node.getAttribute('lang')).toBe('ID');
      expect(node.hasAttribute('cfi-inert')).toBe(true);
    }

    const childTexts = Array.from(clone.childNodes)
      .filter((node) => node.textContent?.trim())
      .map((node) => node.textContent!.trim());
    expect(childTexts).toEqual([
      'Hello world.',
      'ID:Hello world.',
      'How are you?',
      'ID:How are you?',
      'Nice day.',
      'ID:Nice day.',
    ]);

    // Geometry: every translation starts below its own source sentence, and
    // each source sentence starts below the translation before it — the
    // en → id interleaving reads sentence by sentence.
    const base = document.createRange();
    base.selectNodeContents(clone);
    const plan = buildSentenceTranslationPlan(clone)!;
    const topOf = (target: Range | HTMLElement) => target.getBoundingClientRect().top;
    let previousTop = -Infinity;
    for (let i = 0; i < plan.sentences.length; i++) {
      const sentenceRange = getTextSubRange(
        base,
        plan.sentences[i]!.start,
        plan.sentences[i]!.end,
      )!;
      const sentenceTop = topOf(sentenceRange);
      const translationTop = topOf(translations[i]!);
      expect(translationTop).toBeGreaterThan(sentenceTop + 12);
      expect(sentenceTop).toBeGreaterThan(previousTop);
      previousTop = translationTop;
    }
  });
});
