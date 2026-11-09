import { act, cleanup, render, waitFor as waitForWithOptions } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ParagraphOverlay from '@/app/reader/components/paragraph/ParagraphOverlay';
import { eventDispatcher } from '@/utils/event';
import { rangeTextExcludingInert } from '@/services/tts/wordHighlight';

const currentViewSettings: Record<string, unknown> = {
  paragraphMode: { enabled: true, translationEnabled: true },
  translationEnabled: true,
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

// A paragraph as the book page's translation hook leaves it: source text plus
// one appended translation wrapper carrying the whole-paragraph translation.
const paragraphWithTranslation = (source: string, translated: string) =>
  `<p>${source}<font class="translation-target translation-target-block" translation-element-mark="1" lang="ID">${translated}</font></p>`;

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

const renderOverlay = () =>
  render(<ParagraphOverlay bookKey='overlay-book' viewSettings={currentViewSettings as never} />);

describe('paragraph sentence translation', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    currentViewSettings['paragraphMode'] = { enabled: true, translationEnabled: true };
  });

  it('redistributes the translated paragraph sentence by sentence', async () => {
    const { container } = renderOverlay();
    await focusParagraph(
      'overlay-book',
      paragraphWithTranslation(
        'Hello world. How are you? Nice day.',
        'Halo dunia. Apa kabar? Hari yang bagus.',
      ),
    );

    const targets = await waitFor(() => {
      const nodes = container.querySelectorAll<HTMLElement>('.paragraph-translation-target');
      expect(nodes.length).toBe(3);
      return Array.from(nodes);
    });

    expect(targets.map((node) => node.textContent)).toEqual([
      'Halo dunia.',
      'Apa kabar?',
      'Hari yang bagus.',
    ]);

    // Injection conventions: not book text for offset computations, target
    // language marked for bidi and styling.
    for (const node of targets) {
      expect(node.hasAttribute('cfi-inert')).toBe(true);
      expect(node.getAttribute('lang')).toBe('ID');
    }

    // The whole-paragraph wrapper is hidden while its text is redistributed,
    // and comes back when the mapping is undone.
    const wrapper = container.querySelector('.translation-target-block') as HTMLElement;
    expect(wrapper.classList.contains('hidden')).toBe(true);
  });

  it('renders interleaved source and translation text in order', async () => {
    const { container } = renderOverlay();
    await focusParagraph(
      'overlay-book',
      paragraphWithTranslation(
        'Hello world. How are you? Nice day.',
        'Halo dunia. Apa kabar? Hari yang bagus.',
      ),
    );
    await waitFor(() => {
      expect(container.querySelectorAll('.paragraph-translation-target').length).toBe(3);
    });

    const clone = container.querySelector('.paragraph-content')!;
    const texts = Array.from(clone.childNodes)
      .filter((node) => node.textContent?.trim())
      // The whole-paragraph wrapper is hidden while its text is redistributed.
      .filter((node) => !(node instanceof HTMLElement && node.classList.contains('hidden')))
      .map((node) => node.textContent!.trim());
    expect(texts).toEqual([
      'Hello world.',
      'Halo dunia.',
      'How are you?',
      'Apa kabar?',
      'Nice day.',
      'Hari yang bagus.',
    ]);
  });

  it('keeps the inserted blocks out of the inert-skipping baseline', async () => {
    const { container } = renderOverlay();
    const { range } = await focusParagraph(
      'overlay-book',
      paragraphWithTranslation(
        'Hello world. How are you? Nice day.',
        'Halo dunia. Apa kabar? Hari yang bagus.',
      ),
    );
    await waitFor(() => {
      expect(container.querySelectorAll('.paragraph-translation-target').length).toBe(3);
    });

    const clone = container.querySelector('.paragraph-content')!;
    const base = (clone.ownerDocument as Document).createRange();
    base.selectNodeContents(clone);
    // Baseline = everything cloned except the (inert) per-sentence blocks —
    // the source text plus the wrapper's text, exactly what the book range
    // stringifies to.
    expect(rangeTextExcludingInert(base)).toBe(range.toString());
  });

  it('falls back to the block translation when sentence counts differ', async () => {
    const { container } = renderOverlay();
    await focusParagraph(
      'overlay-book',
      paragraphWithTranslation(
        'Hello world. How are you? Nice day.',
        'Halo dunia semua, apa kabar kalian?',
      ),
    );

    // Give the mapper a chance to run; the mismatch must leave the wrapper
    // exactly as the book translation produced it.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(container.querySelectorAll('.paragraph-translation-target').length).toBe(0);
    const wrapper = container.querySelector('.translation-target-block') as HTMLElement;
    expect(wrapper).not.toBeNull();
    expect(wrapper.classList.contains('hidden')).toBe(false);
    expect(wrapper.textContent).toBe('Halo dunia semua, apa kabar kalian?');
  });

  it('restores the block translation when the toggle turns off', async () => {
    const { container, rerender } = renderOverlay();
    await focusParagraph(
      'overlay-book',
      paragraphWithTranslation(
        'Hello world. How are you? Nice day.',
        'Halo dunia. Apa kabar? Hari yang bagus.',
      ),
    );
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
    const wrapper = container.querySelector('.translation-target-block') as HTMLElement;
    expect(wrapper.classList.contains('hidden')).toBe(false);
  });

  it('does nothing when the toggle is off from the start', async () => {
    currentViewSettings['paragraphMode'] = { enabled: true, translationEnabled: false };
    try {
      const { container } = renderOverlay();
      await focusParagraph(
        'overlay-book',
        paragraphWithTranslation(
          'Hello world. How are you? Nice day.',
          'Halo dunia. Apa kabar? Hari yang bagus.',
        ),
      );
      await waitFor(() => {
        expect(container.querySelector('.paragraph-content')).not.toBeNull();
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(container.querySelectorAll('.paragraph-translation-target').length).toBe(0);
      const wrapper = container.querySelector('.translation-target-block') as HTMLElement;
      expect(wrapper.classList.contains('hidden')).toBe(false);
    } finally {
      currentViewSettings['paragraphMode'] = { enabled: true, translationEnabled: true };
    }
  });

  // User-reported regression: paragraphs whose final sentence ends in a quoted
  // word or an ellipsis lost their tail translation. The tail span always
  // exists (the splitter pushes the remaining text), so every sentence must
  // come back translated.
  it('maps the tail sentence of paragraphs ending in quotes or an ellipsis', async () => {
    const { container } = renderOverlay();
    await focusParagraph(
      'overlay-book',
      paragraphWithTranslation(
        'She fed him sections of the "Fetes Galantes" before he was ten. This was fun for a while, but he eschewed a cigarette, and succumbed to a vulgar reaction. Though this incident horrified Beatrice, it also amused her and became part of what was later termed her "line."',
        'Dia memberinya makan bagian dari "Fetes Galantes" sebelum dia berumur sepuluh tahun. Ini menyenangkan untuk beberapa waktu, tetapi dia menolak rokok, dan menyerah pada reaksi yang vulgar. Meski kejadian ini membuat Beatrice ngeri, ia juga diam-diam tersenyum dan menjadi bagian dari apa yang kemudian disebut "garisnya."',
      ),
    );

    const targets = await waitFor(() => {
      const nodes = container.querySelectorAll<HTMLElement>('.paragraph-translation-target');
      expect(nodes.length).toBe(3);
      return Array.from(nodes);
    });
    expect(targets[2]!.textContent).toBe(
      'Meski kejadian ini membuat Beatrice ngeri, ia juga diam-diam tersenyum dan menjadi bagian dari apa yang kemudian disebut "garisnya."',
    );
  });
});
