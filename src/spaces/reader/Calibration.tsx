import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { READING_STACK_LATIN } from "../../config/typography";
import "./calibration.css";

/**
 * "Make the page fit me" — a short, skippable reading-fit calibration
 * (docs/PRODUCT.md §Typography). Research says the fastest font differs per
 * person and isn't the preferred one, so we time reading of matched neutral
 * passages, keep only comprehension-correct samples, and pick the fastest.
 * WPM is never shown as a score and no medical claim is made.
 */

interface Passage {
  font: string;
  label: string;
  /** x-height normalization factor so fonts are perceptually matched */
  scale: number;
  text: string;
  question: string;
  options: string[];
  answer: number;
}

// Five original, neutral, matched passages (~130–170 words, grade ~7–9).
const BASE_PASSAGES: Omit<Passage, "font" | "label" | "scale">[] = [
  {
    text: "The harbor kept two clocks, and they never agreed. One hung in the customs house and ran a little fast, as if eager for the ships to leave. The other stood on the pier, salt-stained and slow, and the fishermen trusted it more. A traveler who arrived by the fast clock always felt he had missed something; a traveler who arrived by the slow clock felt he had time to spare. In truth the ships left when the tide allowed and paid no attention to either face. The clocks were less about hours than about temperament: the town's impatience nailed to one wall, its patience bolted to another. Children learned early which clock their errand required, and adults, without noticing, chose the clock that matched the mood they wished to keep.",
    question: "Which clock did the fishermen trust more?",
    options: ["The customs-house clock", "The pier clock", "Neither clock"],
    answer: 1,
  },
  {
    text: "A library near the river had a rule that seemed strange to visitors: no book could be shelved until someone had read at least one page of it aloud. The librarian believed that a book unheard was only paper, and that the sound of a first page gave it a place in the room's memory. New arrivals waited on a long oak table, spines up, until a reader passed and lifted one. Some waited days; a few waited months. The librarian never hurried the process. She said that a book chosen too quickly was rarely finished, while a book that had waited for the right voice tended to be read to its end. Visitors found the rule sentimental until they returned a year later and remembered exactly which books they had heard.",
    question: "What had to happen before a book could be shelved?",
    options: ["It had to be stamped", "A page had to be read aloud", "It had to wait a year"],
    answer: 1,
  },
  {
    text: "In the mountains the mail came by a man who walked rather than rode, because the paths were too narrow for a horse and too steep for a cart. He carried letters in a leather satchel and news in his head, and the villages could not always tell which they valued more. He learned to read faces the way others read weather, and he timed his visits to the hours when people were most willing to listen. A letter he delivered in the morning was received as fact; the same letter in the evening became a story to be turned over by the fire. He never explained this to anyone. He simply arrived, set down the satchel, and let the light decide how his news would be heard.",
    question: "Why did the mail come on foot?",
    options: [
      "The paths were too narrow and steep",
      "There were no horses",
      "The man preferred walking",
    ],
    answer: 0,
  },
  {
    text: "The bakery opened before dawn, and its first customers were not buyers but the cold themselves, drawn to the warmth that leaked under the door. The baker allowed it. He said an empty shop cooled faster than a full one, and that a few early loiterers kept the ovens company. By the time the paying crowd arrived, the room had a lived-in warmth that no furnace alone could make. Regulars claimed the bread tasted better for it, though the baker only shrugged. He knew the difference was not in the flour but in the hour: bread pulled from a patient morning carried something a rushed one lacked. When apprentices asked his secret, he pointed not at the recipe but at the clock, and told them to respect the slow part.",
    question: "What did the baker credit for the bread's quality?",
    options: ["A rare flour", "The patient, early hour", "A secret recipe"],
    answer: 1,
  },
  {
    text: "A cartographer spent his life mapping a single valley, and his maps grew stranger as he aged. The early ones showed roads and rivers, the useful bones of the place. The later ones marked where the light fell in October, where sound carried on still evenings, where a certain grief had once been felt and left its trace. Officials found these maps useless and refused to buy them. But the people of the valley kept copies, because they recognized a country the official maps had missed. When he died, the two kinds of map were buried together, and travelers who found only the first kind always felt they had arrived in a thinner place than the one the old man knew.",
    question: "How did the cartographer's later maps differ?",
    options: [
      "They showed more roads",
      "They marked light, sound, and feeling",
      "They were more accurate for officials",
    ],
    answer: 1,
  },
];

// Bundled fonts to compare, with empirically reasonable x-height scale
// factors so perceived size is matched (docs/PRODUCT.md).
const FONTS: { font: string; label: string; scale: number }[] = [
  { font: READING_STACK_LATIN, label: "Literata", scale: 1.0 },
  { font: '"Source Serif 4", Georgia, serif', label: "Source Serif", scale: 1.0 },
  { font: '"Atkinson Hyperlegible", system-ui, sans-serif', label: "Atkinson", scale: 0.98 },
  { font: '"EB Garamond", Georgia, serif', label: "EB Garamond", scale: 1.08 },
  { font: '"Noto Sans", system-ui, sans-serif', label: "Noto Sans", scale: 0.97 },
];

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

interface Sample {
  label: string;
  ms: number;
  correct: boolean;
}

export function Calibration({
  onDone,
  onSkip,
}: {
  onDone: (fastestFontLabel: string, fontStack: string) => void;
  onSkip: () => void;
}) {
  const passages: Passage[] = useMemo(() => {
    const fonts = shuffle(FONTS);
    return BASE_PASSAGES.map((p, i) => ({ ...p, ...fonts[i % fonts.length] }));
  }, []);

  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<"read" | "question">("read");
  const [samples, setSamples] = useState<Sample[]>([]);
  const startedAt = useRef(0);
  const current = passages[index];

  useEffect(() => {
    if (phase === "read") startedAt.current = performance.now();
  }, [phase, index]);

  const answer = useCallback(
    (choice: number) => {
      const ms = performance.now() - startedAt.current;
      const sample: Sample = {
        label: current.label,
        ms,
        correct: choice === current.answer,
      };
      const nextSamples = [...samples, sample];
      if (index + 1 < passages.length) {
        setSamples(nextSamples);
        setIndex(index + 1);
        setPhase("read");
      } else {
        finish(nextSamples);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [current, samples, index, passages.length],
  );

  const finish = (all: Sample[]) => {
    // keep only comprehension-correct, non-interrupted samples
    const valid = all.filter((s) => s.correct && s.ms > 4000 && s.ms < 300000);
    const byFont = new Map<string, number[]>();
    for (const s of valid) {
      const list = byFont.get(s.label) ?? [];
      list.push(s.ms);
      byFont.set(s.label, list);
    }
    let best = FONTS[0].label;
    let bestMs = Infinity;
    for (const [label, times] of byFont) {
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      if (avg < bestMs) {
        bestMs = avg;
        best = label;
      }
    }
    const stack = FONTS.find((f) => f.label === best)?.font ?? READING_STACK_LATIN;
    onDone(best, stack);
  };

  return (
    <main className="calibration" aria-label="Make the page fit me">
      <div className="calibration-progress" aria-hidden="true">
        {index + 1} / {passages.length}
      </div>
      {phase === "read" ? (
        <div className="calibration-read">
          <p
            className="calibration-passage"
            style={{ fontFamily: current.font, fontSize: `${20 * current.scale}px` }}
          >
            {current.text}
          </p>
          <div className="calibration-actions">
            <button className="calibration-primary" onClick={() => setPhase("question")}>
              Done reading
            </button>
            <button className="calibration-skip" onClick={onSkip}>
              Skip calibration
            </button>
          </div>
        </div>
      ) : (
        <div className="calibration-question">
          <p>{current.question}</p>
          <div className="calibration-options">
            {current.options.map((opt, i) => (
              <button key={i} onClick={() => answer(i)}>
                {opt}
              </button>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
