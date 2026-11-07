import { act, cleanup, render, waitFor as waitForWithOptions } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ParagraphOverlay from '@/app/reader/components/paragraph/ParagraphOverlay';
import { eventDispatcher } from '@/utils/event';
import { rangeTextExcludingInert } from '@/services/tts/wordHighlight';

const mockTranslate = vi.fn(async (texts: string[]) => texts.map((text) => `ID:${text}`));

vi.mock('@/hooks/useTranslator', () => ({
  useTranslator: () => ({
    translate: mockTranslate,
    translator: { concurrency: 2 },
    translators: [],
    loading: false,
  }),
}));

const currentViewSettings: Record<string, unknown> = {
  paragraphMode: { enabled: true, translationEnabled: true },
  translationProvider: 'deepl',
  translateTargetLang: 'ID',
  translationColor: '',
};

const mockGetView = vi.fn((): unknown => null);
const mockGetProgress = vi.fn(() => null);

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: (selector?: (state: unknown) => unknown) => {
    const state = {
      getBookData: () => ({ isFixedLayout: false }),
      booksData: {
        'overlay-book': { book: { title: 'Book', author: 'Author' }, config: { booknotes: [] } },
      },
    };
    return selector ? selector(state) : state;
  },
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: { hasSafeAreaInset: false, isAndroidApp: false } }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: { globalReadSettings: {} } }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getViewSettings: () => currentViewSettings,
    setViewSettings: vi.fn(),
    getProgress: mockGetProgress,
    getView: mockGetView,
  }),
}));

const waitFor = <T,>(callback: () => T | Promise<T>) =>
  waitForWithOptions(callback, { interval: 1 });

const createDoc = (body: string): Document =>
  new DOMParser().parseFromString(`<html><body>${body}</body></html>`, 'text/html');

const focusParagraph = async (bookKey: string, body: string) => {
  const doc = createDoc(body);
  const paragraph = doc.querySelector('p')!;
  const range = doc.createRange();
  range.selectNodeContents(paragraph);
  await act(async () => {
    await eventDispatcher.dispatch('paragraph-focus', {
      bookKey,
      range,
      presentation: {
        dir: 'ltr',
        writingMode: 'horizontal-tb',
        vertical: false,
        rtl: false,
      },
    });
  });
  return { doc, range };
};

describe('paragraph sentence translation', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('inserts one translation block after every sentence', async () => {
    const { container } = render(
      <ParagraphOverlay bookKey='overlay-book' viewSettings={currentViewSettings as never} />,
    );
    await focusParagraph('overlay-book', '<p>Hello world. How are you? Nice day.</p>');

    const targets = await waitFor(() => {
      const nodes = container.querySelectorAll<HTMLElement>('.paragraph-translation-target');
      expect(nodes.length).toBe(3);
      return Array.from(nodes);
    });

    expect(targets.map((node) => node.textContent)).toEqual([
      'ID:Hello world.',
      'ID:How are you?',
      'ID:Nice day.',
    ]);
    // Translated sentences arrive as one batched call.
    expect(mockTranslate).toHaveBeenCalledTimes(1);
    expect(mockTranslate.mock.calls[0]![0]).toEqual(['Hello world.', 'How are you?', 'Nice day.']);

    // Injection conventions: not book text for offset computations, target
    // language marked for bidi and styling.
    for (const node of targets) {
      expect(node.hasAttribute('cfi-inert')).toBe(true);
      expect(node.getAttribute('lang')).toBe('ID');
    }
  });

  it('keeps translations out of the inert-skipping baseline', async () => {
    const { container } = render(
      <ParagraphOverlay bookKey='overlay-book' viewSettings={currentViewSettings as never} />,
    );
    const { range } = await focusParagraph(
      'overlay-book',
      '<p>Hello world. How are you? Nice day.</p>',
    );
    await waitFor(() => {
      expect(container.querySelectorAll('.paragraph-translation-target').length).toBe(3);
    });

    const clone = container.querySelector('.paragraph-content')!;
    const base = (clone.ownerDocument as Document).createRange();
    base.selectNodeContents(clone);
    expect(rangeTextExcludingInert(base)).toBe(range.toString());
  });

  it('renders interleaved source and translation text in order', async () => {
    const { container } = render(
      <ParagraphOverlay bookKey='overlay-book' viewSettings={currentViewSettings as never} />,
    );
    await focusParagraph('overlay-book', '<p>Hello world. How are you? Nice day.</p>');
    await waitFor(() => {
      expect(container.querySelectorAll('.paragraph-translation-target').length).toBe(3);
    });

    const clone = container.querySelector('.paragraph-content')!;
    const nodes = Array.from(clone.childNodes).filter((node) => node.textContent?.trim());
    const texts = nodes.map((node) =>
      node.nodeType === Node.TEXT_NODE ? node.textContent!.trim() : node.textContent!.trim(),
    );
    expect(texts).toEqual([
      'Hello world.',
      'ID:Hello world.',
      'How are you?',
      'ID:How are you?',
      'Nice day.',
      'ID:Nice day.',
    ]);
  });

  it('removes inserted translations when the toggle turns off', async () => {
    const { container, rerender } = render(
      <ParagraphOverlay bookKey='overlay-book' viewSettings={currentViewSettings as never} />,
    );
    await focusParagraph('overlay-book', '<p>Hello world. How are you? Nice day.</p>');
    await waitFor(() => {
      expect(container.querySelectorAll('.paragraph-translation-target').length).toBe(3);
    });

    currentViewSettings['paragraphMode'] = { enabled: true, translationEnabled: false };
    rerender(
      <ParagraphOverlay bookKey='overlay-book' viewSettings={currentViewSettings as never} />,
    );
    await waitFor(() => {
      expect(container.querySelectorAll('.paragraph-translation-target').length).toBe(0);
    });
    currentViewSettings['paragraphMode'] = { enabled: true, translationEnabled: true };
  });

  it('does nothing when the toggle is off from the start', async () => {
    currentViewSettings['paragraphMode'] = { enabled: true, translationEnabled: false };
    try {
      const { container } = render(
        <ParagraphOverlay bookKey='overlay-book' viewSettings={currentViewSettings as never} />,
      );
      await focusParagraph('overlay-book', '<p>Hello world. How are you? Nice day.</p>');
      await waitFor(() => {
        expect(container.querySelector('.paragraph-content')).not.toBeNull();
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(mockTranslate).not.toHaveBeenCalled();
      expect(container.querySelectorAll('.paragraph-translation-target').length).toBe(0);
    } finally {
      currentViewSettings['paragraphMode'] = { enabled: true, translationEnabled: true };
    }
  });

  it('settles briefly before sending the paragraph batch', async () => {
    const { container } = render(
      <ParagraphOverlay bookKey='overlay-book' viewSettings={currentViewSettings as never} />,
    );
    await focusParagraph('overlay-book', '<p>Hello world. How are you? Nice day.</p>');
    await waitFor(() => {
      expect(container.querySelector('.paragraph-content')).not.toBeNull();
    });
    // Flipping through paragraphs must not fire a request per paragraph.
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(mockTranslate).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(mockTranslate).toHaveBeenCalledTimes(1);
    });
  });

  // User-reported regression: paragraphs whose final sentence ends in a quoted
  // word or an ellipsis lost their tail translation. The tail span always
  // exists (the splitter pushes the remaining text), so every sentence must
  // come back translated.
  it('translates the tail sentence of paragraphs ending in quotes or an ellipsis', async () => {
    const { container } = render(
      <ParagraphOverlay bookKey='overlay-book' viewSettings={currentViewSettings as never} />,
    );
    await focusParagraph(
      'overlay-book',
      '<p>She fed him sections of the "Fetes Galantes" before he was ten. This was fun for a while, but he eschewed a cigarette, and succumbed to a vulgar reaction. Though this incident horrified Beatrice, it also amused her and became part of what was later termed her "line."</p>',
    );

    const targets = await waitFor(() => {
      const nodes = container.querySelectorAll<HTMLElement>('.paragraph-translation-target');
      expect(nodes.length).toBe(3);
      return Array.from(nodes);
    });
    expect(targets[2]!.textContent).toBe(
      'ID:Though this incident horrified Beatrice, it also amused her and became part of what was later termed her "line."',
    );

    await focusParagraph(
      'overlay-book',
      '<p>He told them of the apricot cordial. They rejoiced, for she was a brave raconteuse, but many were the keys turned in sideboard locks that night against the possible defection of little Bobby or Barbara...</p>',
    );
    await waitFor(() => {
      const nodes = container.querySelectorAll<HTMLElement>('.paragraph-translation-target');
      expect(nodes.length).toBe(2);
    });
    expect(mockTranslate).toHaveBeenLastCalledWith([
      'He told them of the apricot cordial.',
      'They rejoiced, for she was a brave raconteuse, but many were the keys turned in sideboard locks that night against the possible defection of little Bobby or Barbara...',
    ]);
  });
});
