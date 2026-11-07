'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FoliateView } from '@/types/view';
import { Insets } from '@/types/misc';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';
import { saveViewSettings } from '@/helpers/settings';
import { DEFAULT_PARAGRAPH_MODE_CONFIG } from '@/services/constants';
import {
  loadParagraphFontScaleIndex,
  PARAGRAPH_FONT_SCALE_OPTIONS,
  saveParagraphFontScaleIndex,
} from '@/utils/paragraphPresentation';
import { useParagraphMode } from '../../hooks/useParagraphMode';
import ParagraphBar from './ParagraphBar';
import ParagraphOverlay from './ParagraphOverlay';

interface ParagraphControlProps {
  bookKey: string;
  viewRef: React.RefObject<FoliateView | null>;
  gridInsets: Insets;
}

const ParagraphControl: React.FC<ParagraphControlProps> = ({ bookKey, viewRef, gridInsets }) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { getViewSettings, setViewSettings } = useReaderStore();
  const viewSettings = getViewSettings(bookKey);

  const {
    paragraphState,
    paragraphConfig,
    ttsSyncStatus,
    ttsActive,
    toggleParagraphMode,
    goToNextParagraph,
    goToPrevParagraph,
    toggleTtsAudio,
    reengageTtsFollow,
  } = useParagraphMode({ bookKey, viewRef });

  // Sentence-by-sentence translation toggle, persisted per book like the mode
  // itself. Turning it on really turns the book page's paragraph translation
  // off (the main toggle): sentence translation replaces it, so both can never
  // run at once. Turning it back off leaves the main toggle as it is — the
  // user re-enables it in Settings when they want paragraph translations.
  const toggleSentenceTranslation = useCallback(() => {
    const settings = getViewSettings(bookKey);
    if (!settings) return;
    const config = settings.paragraphMode ?? DEFAULT_PARAGRAPH_MODE_CONFIG;
    const newConfig = { ...config, translationEnabled: !config.translationEnabled };
    const nextSettings = { ...settings, paragraphMode: newConfig };
    if (newConfig.translationEnabled) {
      nextSettings.translationEnabled = false;
      saveViewSettings(envConfig, bookKey, 'translationEnabled', false, true, false);
    }
    setViewSettings(bookKey, nextSettings);
    saveViewSettings(envConfig, bookKey, 'paragraphMode', newConfig, true, false);
  }, [bookKey, getViewSettings, setViewSettings, envConfig]);

  // Device-level display scale for the paragraph text (#5246), persisted like
  // the RSVP overlay's display settings.
  const [fontScaleIndex, setFontScaleIndex] = useState(loadParagraphFontScaleIndex);
  const handleFontScaleIndexChange = useCallback((index: number) => {
    setFontScaleIndex(saveParagraphFontScaleIndex(index));
  }, []);

  // One-time-per-session decouple toast: the first time following drops while
  // TTS still plays, tell the user once. Reset when following re-engages so a
  // later decouple notifies again.
  const decoupleToastShownRef = useRef(false);
  useEffect(() => {
    if (ttsSyncStatus === 'decoupled') {
      if (!decoupleToastShownRef.current) {
        decoupleToastShownRef.current = true;
        eventDispatcher.dispatch('toast', {
          message: _('Stopped following audio'),
          type: 'info',
        });
      }
    } else if (ttsSyncStatus === 'following') {
      decoupleToastShownRef.current = false;
    }
  }, [ttsSyncStatus, _]);

  if (!paragraphConfig?.enabled) {
    return null;
  }

  return (
    <>
      <ParagraphOverlay
        bookKey={bookKey}
        viewSettings={viewSettings ?? undefined}
        fontScale={PARAGRAPH_FONT_SCALE_OPTIONS[fontScaleIndex] ?? 1}
        gridInsets={gridInsets}
        ttsSyncStatus={ttsSyncStatus}
        onResumeTtsFollow={reengageTtsFollow}
        onClose={toggleParagraphMode}
      />
      <ParagraphBar
        bookKey={bookKey}
        currentIndex={paragraphState.currentIndex}
        totalParagraphs={paragraphState.totalParagraphs}
        isLoading={paragraphState.isLoading}
        onPrev={goToPrevParagraph}
        onNext={goToNextParagraph}
        onClose={toggleParagraphMode}
        ttsActive={ttsActive}
        onToggleTtsAudio={toggleTtsAudio}
        translationEnabled={viewSettings?.paragraphMode?.translationEnabled ?? false}
        onToggleTranslation={toggleSentenceTranslation}
        fontScaleIndex={fontScaleIndex}
        onFontScaleIndexChange={handleFontScaleIndexChange}
        viewSettings={viewSettings ?? undefined}
        gridInsets={gridInsets}
      />
    </>
  );
};

export default ParagraphControl;
