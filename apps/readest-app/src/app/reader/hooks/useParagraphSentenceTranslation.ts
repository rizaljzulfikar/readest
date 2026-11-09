import { useEffect, useRef } from 'react';
import { ViewSettings } from '@/types/book';
import { getLocale } from '@/utils/misc';
import { createTranslationTargetNode } from '@/app/reader/hooks/useTextTranslation';
import {
  buildSentenceTranslationPlan,
  getTextPositionAt,
  splitIntoSentences,
} from '@/app/reader/components/paragraph/paragraphSentences';

/**
 * Sentence-by-sentence display for Paragraph Mode.
 *
 * This is a DISPLAY mapper, not a translation pipeline: the paragraph is
 * translated whole by the book page's translation hook (one request per
 * paragraph, honoring the main toggle). When the paragraph's translation
 * wrapper lands in the overlay's clone, the wrapper's text is split into
 * sentences and redistributed next to the matching source sentences. The
 * main translation toggle is never overridden — with it off there is no
 * wrapper, and this mapper simply has nothing to map.
 *
 * When the translated sentence count drifts from the source count
 * (translators occasionally merge or split), the mapping is skipped and the
 * whole-paragraph block shows as the book page produced it.
 */

const TRANSLATION_CLASS = 'paragraph-translation-target';

interface ParagraphSentenceTranslationProps {
  /** Returns the paragraph clone currently mounted in the overlay. */
  getCloneRoot: () => Element | null;
  /** Identifies the clone build; a change clears and recomputes. */
  paragraphKey: number;
  enabled: boolean;
  viewSettings?: ViewSettings;
}

export const useParagraphSentenceTranslation = ({
  getCloneRoot,
  paragraphKey,
  enabled,
  viewSettings,
}: ParagraphSentenceTranslationProps) => {
  // Drops stale observer work when the paragraph, toggle or language changes.
  const generationRef = useRef(0);

  useEffect(() => {
    const generation = ++generationRef.current;
    const cloneRoot = getCloneRoot();

    const undo = () => {
      cloneRoot?.querySelectorAll(`.${TRANSLATION_CLASS}`).forEach((node) => node.remove());
      cloneRoot
        ?.querySelectorAll('.translation-target')
        .forEach((node) => node.classList.remove('hidden'));
    };
    undo();
    if (!enabled || !cloneRoot) return undefined;

    const targetLang = viewSettings?.translateTargetLang || getLocale();

    const map = () => {
      const wrapper = cloneRoot.querySelector('.translation-target');
      if (!wrapper || wrapper.classList.contains('hidden')) return;
      const translated = wrapper.textContent?.trim() ?? '';
      if (!translated) return;

      const plan = buildSentenceTranslationPlan(cloneRoot);
      const sourceSentences = (plan?.sentences ?? [])
        .map((span) => ({ span, text: span.text.trim() }))
        .filter((entry) => entry.text.length > 0);
      const translatedSentences = splitIntoSentences(translated)
        .map((span) => span.text.trim())
        .filter((text) => text.length > 0);

      // The pairing is only as good as the translator's sentence discipline:
      // when the counts drift, keep the whole-paragraph block as the book
      // page produced it.
      if (
        translatedSentences.length === 0 ||
        translatedSentences.length !== sourceSentences.length
      ) {
        return;
      }

      wrapper.classList.add('hidden');
      sourceSentences.forEach((entry, index) => {
        const position = getTextPositionAt(cloneRoot, entry.span.end);
        if (!position) return;
        const node = createTranslationTargetNode({
          translatedText: translatedSentences[index]!,
          lang: targetLang,
          targetBlockClassName: TRANSLATION_CLASS,
          hidden: false,
          widthLineBreak: false,
        });
        // The clone's own offset computations (selection mapping, highlight
        // painting, TTS word ranges) skip cfi-inert text, so an inserted
        // translation never shifts them.
        node.setAttribute('cfi-inert', '');
        const tail = position.node.splitText(position.offset);
        position.node.parentNode?.insertBefore(node, tail);
      });
    };

    // The wrapper lands asynchronously (the page translation hook appends it
    // to the book paragraph, and the clone picks it up on the next focus) —
    // watch the clone so the mapping runs the moment it appears. The mapper's
    // own insertions re-trigger the observer; the hidden-wrapper guard makes
    // those runs no-ops.
    const observer = new MutationObserver(map);
    observer.observe(cloneRoot, { childList: true, subtree: true });
    map();

    return () => {
      if (generation !== generationRef.current) return;
      observer.disconnect();
      undo();
    };
  }, [getCloneRoot, paragraphKey, enabled, viewSettings?.translateTargetLang]);
};

export default useParagraphSentenceTranslation;
