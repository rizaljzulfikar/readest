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

  // Sentence-by-sentence display toggle, persisted per book like the mode
  // itself. It only controls how the paragraph's translation is MAPPED in the
  // overlay (sentence by sentence vs one block); the translation request
  // itself always follows the main translation toggle.
  const toggleSentenceTranslation = useCallback(() => {
    const settings = getViewSettings(bookKey);
    if (!settings) return;
    const config = settings.paragraphMode ?? DEFAULT_PARAGRAPH_MODE_CONFIG;
    const newConfig = { ...config, translationEnabled: !config.translationEnabled };
    setViewSettings(bookKey, { ...settings, paragraphMode: newConfig });
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
