import { useEffect, useRef } from 'react';
import { ViewSettings } from '@/types/book';
import { UseTranslatorOptions } from '@/services/translators';
import { useTranslator } from '@/hooks/useTranslator';
import { getLocale } from '@/utils/misc';
import { createTranslationTargetNode } from '@/app/reader/hooks/useTextTranslation';
import {
  buildSentenceTranslationPlan,
  getTextPositionAt,
} from '@/app/reader/components/paragraph/paragraphSentences';

/**
 * Sentence-by-sentence interleaved translation for Paragraph Mode.
 *
 * The focused paragraph stays one block; after each of its sentences the
 * sentence's translation is inserted (EN → ID 1, EN → ID 2, …). Runs entirely
 * on the overlay's host-document clone, so the same code serves web, desktop
 * and mobile. Translation reuses the book's translator settings (provider,
 * target language, prompt) and its cache through `useTranslator`.
 */

const TRANSLATION_CLASS = 'paragraph-translation-target';
// The hosted DeepL route caps a request at 100 text items; past that the whole
// batch would fail, so the first 100 sentences get translations instead.
const MAX_SENTENCES = 100;
// Paragraph navigation fires a focus per paragraph; settling briefly keeps
// quick flips from bursting the translation API.
const SETTLE_MS = 200;

interface ParagraphSentenceTranslationProps {
  /** Returns the paragraph clone currently mounted in the overlay. */
  getCloneRoot: () => Element | null;
  /** Identifies the clone build; a change clears and recomputes. */
  paragraphKey: number;
  enabled: boolean;
  viewSettings?: ViewSettings;
  bookTitle?: string;
  bookAuthor?: string;
}

export const useParagraphSentenceTranslation = ({
  getCloneRoot,
  paragraphKey,
  enabled,
  viewSettings,
  bookTitle,
  bookAuthor,
}: ParagraphSentenceTranslationProps) => {
  const { translate } = useTranslator({
    provider: viewSettings?.translationProvider,
    targetLang: viewSettings?.translateTargetLang || getLocale(),
    promptId: viewSettings?.translationPromptId,
    bookTitle,
    bookAuthor,
  } as UseTranslatorOptions);

  // Drops translation results that resolve after the paragraph, toggle or
  // language changed: a stale result must not land in a new paragraph.
  const generationRef = useRef(0);

  useEffect(() => {
    const generation = ++generationRef.current;
    const cloneRoot = getCloneRoot();
    const clear = () => {
      cloneRoot?.querySelectorAll(`.${TRANSLATION_CLASS}`).forEach((node) => node.remove());
    };
    clear();
    if (!enabled || !cloneRoot) return undefined;

    const targetLang = viewSettings?.translateTargetLang || getLocale();
    const plan = buildSentenceTranslationPlan(cloneRoot);
    const entries = (plan?.sentences ?? [])
      .map((span) => ({ span, text: span.text.trim() }))
      .filter((entry) => entry.text.length > 0)
      .slice(0, MAX_SENTENCES);
    if (entries.length === 0) return undefined;

    let cancelled = false;
    const settleTimer = setTimeout(() => {
      translate(entries.map((entry) => entry.text))
        .then((results) => {
          if (cancelled || generation !== generationRef.current) return;
          entries.forEach((entry, index) => {
            const translated = results[index]?.trim();
            // An empty answer or an unchanged one (same script, e.g. names)
            // would only duplicate the sentence.
            if (!translated || translated === entry.text) return;
            const position = getTextPositionAt(cloneRoot, entry.span.end);
            if (!position) return;
            const wrapper = createTranslationTargetNode({
              translatedText: translated,
              lang: targetLang,
              targetBlockClassName: TRANSLATION_CLASS,
              hidden: false,
              widthLineBreak: false,
            });
            // The clone's own offset computations (selection mapping, highlight
            // painting, TTS word ranges) skip cfi-inert text, so an inserted
            // translation never shifts them.
            wrapper.setAttribute('cfi-inert', '');
            const tail = position.node.splitText(position.offset);
            position.node.parentNode?.insertBefore(wrapper, tail);
          });
        })
        .catch(() => {
          // Provider failures surface through useTranslator's own toasts.
        });
    }, SETTLE_MS);

    return () => {
      cancelled = true;
      clearTimeout(settleTimer);
      clear();
    };
  }, [
    translate,
    getCloneRoot,
    paragraphKey,
    enabled,
    viewSettings?.translateTargetLang,
    viewSettings?.translationProvider,
    viewSettings?.translationPromptId,
    bookTitle,
    bookAuthor,
  ]);
};

export default useParagraphSentenceTranslation;
