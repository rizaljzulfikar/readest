import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ParagraphControl from '@/app/reader/components/paragraph/ParagraphControl';
import type { FoliateView } from '@/types/view';
import type { Insets } from '@/types/misc';

vi.mock('@/hooks/useTranslator', () => ({
  useTranslator: () => ({
    translate: vi.fn(async (texts: string[]) => texts.map((text) => `ID:${text}`)),
    translator: { concurrency: 2 },
    translators: [],
    loading: false,
  }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

const mockSetViewSettings = vi.fn();
let currentViewSettings: Record<string, unknown> = {
  paragraphMode: { enabled: true, translationEnabled: false },
  translationEnabled: true,
  translationProvider: 'deepl',
  translateTargetLang: 'ID',
  writingMode: 'horizontal-tb',
  vertical: false,
  rtl: false,
};

const mockGetViewSettings = vi.fn(() => currentViewSettings);
const mockGetProgress = vi.fn(() => null);
const mockGetView = vi.fn(() => null);

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: (selector?: (state: unknown) => unknown) => {
    const state = {
      getBookData: () => ({ isFixedLayout: false }),
      booksData: {
        'book-1': { book: { title: 'Book', author: 'Author' }, config: { booknotes: [] } },
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
    getViewSettings: mockGetViewSettings,
    setViewSettings: mockSetViewSettings,
    getProgress: mockGetProgress,
    getView: mockGetView,
  }),
}));

const saveViewSettings = vi.hoisted(() => vi.fn());
vi.mock('@/helpers/settings', () => ({ saveViewSettings }));

const createMockView = (): FoliateView =>
  ({
    renderer: {
      primaryIndex: 0,
      atStart: true,
      atEnd: false,
      getContents: vi.fn(() => []),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      goTo: vi.fn(),
      scrollToAnchor: vi.fn(),
    },
    resolveCFI: vi.fn(),
    getCFI: vi.fn(() => 'epubcfi(/6/4!/4/2/1:0)'),
  }) as unknown as FoliateView;

const renderControl = () =>
  render(
    <ParagraphControl
      bookKey='book-1'
      viewRef={{ current: createMockView() } as React.RefObject<FoliateView | null>}
      gridInsets={{ top: 0, right: 0, bottom: 0, left: 0 } as Insets}
    />,
  );

describe('ParagraphControl sentence translation override', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    currentViewSettings = {
      paragraphMode: { enabled: true, translationEnabled: false },
      translationEnabled: true,
      translationProvider: 'deepl',
      translateTargetLang: 'ID',
      writingMode: 'horizontal-tb',
      vertical: false,
      rtl: false,
    };
    mockGetViewSettings.mockImplementation(() => currentViewSettings);
    mockSetViewSettings.mockImplementation((_key: string, settings: Record<string, unknown>) => {
      currentViewSettings = settings;
    });
  });

  it('toggles sentence translation without touching the main translation toggle', () => {
    const { container } = renderControl();
    fireEvent.click(container.querySelector('button[aria-label="Settings"]')!);
    const toggle = container.querySelector(
      'input[aria-label="Sentence Translation"]',
    ) as HTMLInputElement;
    expect(toggle).not.toBeNull();
    expect(toggle.checked).toBe(false);

    fireEvent.click(toggle);

    // The toggle only controls the overlay's sentence mapping — the main
    // translation toggle and its persisted value are never written.
    expect(mockSetViewSettings).toHaveBeenCalledWith(
      'book-1',
      expect.objectContaining({
        translationEnabled: true,
        paragraphMode: { enabled: true, translationEnabled: true },
      }),
    );
    const keys = saveViewSettings.mock.calls.map((call) => call[2]);
    expect(keys).toEqual(['paragraphMode']);
  });

  it('disabling sentence translation only writes the paragraph mode config', () => {
    currentViewSettings = {
      ...currentViewSettings,
      paragraphMode: { enabled: true, translationEnabled: true },
      translationEnabled: false,
    };
    const { container } = renderControl();
    fireEvent.click(container.querySelector('button[aria-label="Settings"]')!);
    const toggle = container.querySelector(
      'input[aria-label="Sentence Translation"]',
    ) as HTMLInputElement;
    expect(toggle.checked).toBe(true);

    fireEvent.click(toggle);

    expect(mockSetViewSettings).toHaveBeenCalledWith(
      'book-1',
      expect.objectContaining({
        translationEnabled: false,
        paragraphMode: { enabled: true, translationEnabled: false },
      }),
    );
    const keys = saveViewSettings.mock.calls.map((call) => call[2]);
    expect(keys).toEqual(['paragraphMode']);
  });
});
