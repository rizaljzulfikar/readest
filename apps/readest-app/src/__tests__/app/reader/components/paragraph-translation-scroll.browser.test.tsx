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
import '@/styles/globals.css';

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

// Twelve sentences so the interleaved content is far taller than the frame's
// height cap at any viewport. The paragraph carries its whole-paragraph
// translation the way the book page's translation hook appends it — the
// overlay redistributes it sentence by sentence.
const SOURCE = Array.from(
  { length: 12 },
  () => 'She fed him sections of the Fetes Galantes before he was ten years old.',
).join(' ');
const TRANSLATED = Array.from(
  { length: 12 },
  () => 'Dia memberinya makan bagian dari Fetes Galantes sebelum usia sepuluh tahun.',
).join(' ');
const LONG_PARAGRAPH = `<p>${SOURCE}<font class="translation-target translation-target-block" translation-element-mark="1" lang="ID">${TRANSLATED}</font></p>`;

const focus = async (body: string) => {
  const holder = document.createElement('div');
  holder.innerHTML = body;
  document.body.appendChild(holder);
  const paragraph = holder.querySelector('p')!;
  const range = document.createRange();
  range.selectNodeContents(paragraph);
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
  const clone = container.querySelector('.paragraph-content');
  expect(clone).not.toBeNull();
  return { container, clone: clone as HTMLElement };
};

describe('paragraph overlay scrolling with sentence translations', () => {
  afterEach(() => {
    cleanup();
    document.querySelectorAll('body > div').forEach((node) => {
      if (node.querySelector('.translation-target')) node.remove();
    });
  });

  test('redistributes every translated sentence, including the tail', async () => {
    const { container } = await focus(LONG_PARAGRAPH);
    await waitFor(() => {
      expect(container.querySelectorAll('.paragraph-translation-target').length).toBe(12);
    });
    const targets = Array.from(
      container.querySelectorAll<HTMLElement>('.paragraph-translation-target'),
    );
    expect(targets[0]!.textContent).toContain('Dia memberinya');
    expect(targets[11]!.textContent).toContain('sebelum usia sepuluh tahun');
    // The whole-paragraph wrapper is hidden while redistributed.
    const wrapper = container.querySelector('.translation-target-block') as HTMLElement;
    expect(wrapper.classList.contains('hidden')).toBe(true);
  });

  test('a wheel over scrollable paragraph content scrolls instead of page-turning', async () => {
    const { container } = await focus(LONG_PARAGRAPH);
    // Wait for the interleaved translations: they are what push the content
    // past the frame's height cap.
    await waitFor(() => {
      expect(container.querySelectorAll('.paragraph-translation-target').length).toBe(12);
    });
    const frame = container.querySelector('.overflow-auto') as HTMLElement;
    expect(frame).not.toBeNull();
    // The interleaved content really does overflow the frame's height cap.
    expect(frame.scrollHeight).toBeGreaterThan(frame.clientHeight);

    const dispatchSpy = vi.spyOn(eventDispatcher, 'dispatch');

    // Mid-scroll: the wheel belongs to the paragraph content.
    frame.scrollTop = Math.floor((frame.scrollHeight - frame.clientHeight) / 2);
    const midScrollTop = frame.scrollTop;
    await act(async () => {
      frame.dispatchEvent(
        new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }),
      );
    });
    expect(dispatchSpy).not.toHaveBeenCalledWith('paragraph-next', expect.anything());

    // At the very bottom: the same wheel turns to the next paragraph.
    frame.scrollTop = frame.scrollHeight - frame.clientHeight;
    await act(async () => {
      frame.dispatchEvent(
        new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }),
      );
    });
    expect(dispatchSpy).toHaveBeenCalledWith('paragraph-next', { bookKey: 'browser-book' });

    // Scrolled back to the top: wheel-up turns to the previous paragraph, but
    // wheel-down keeps scrolling down. The wait clears the page-turn throttle
    // the bottom wheel armed.
    frame.scrollTop = 0;
    dispatchSpy.mockClear();
    await act(async () => {
      frame.dispatchEvent(
        new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }),
      );
    });
    expect(dispatchSpy).not.toHaveBeenCalledWith('paragraph-prev', expect.anything());
    await new Promise((resolve) => setTimeout(resolve, 160));
    await act(async () => {
      frame.dispatchEvent(
        new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true }),
      );
    });
    expect(dispatchSpy).toHaveBeenCalledWith('paragraph-prev', { bookKey: 'browser-book' });
    expect(midScrollTop).toBeGreaterThan(0);
  });
});
