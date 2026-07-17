# Lectorium — Product Contract

> Working name: **Lectorium** — "A quiet room for books."
> The name and tagline live in `src/config/identity.ts` and must remain trivially renameable.

## What this is

A Windows 11 desktop reader for a large local library of EPUBs, PDFs, TXT, Markdown, and simple HTML. It is a **calm reading instrument**, not a tracker with a reader attached. It optimizes for beginning, returning, understanding, and remembering — with unusually low friction.

## The user

A young adult with a very large local ebook library who used to read deeply, now starts books and rarely returns, and is surrounded by high-frequency digital rewards. Dislikes fake gamification. Often reads at night on a 27″ 2560×1440 monitor, sometimes with room lights off. Reads fiction, self-development, history, literature, and difficult nonfiction. Malayalam is a first-class reading language.

## Product promise

Make these exceptionally easy:

1. Start the current book.
2. Resume at the exact place, with enough context to re-enter.
3. Stay in the text without visual or interactive temptation.
4. Understand difficult words and passages without a browser rabbit hole.
5. Preserve ideas worth remembering in a real personal commonplace book.
6. Return to self-authored ideas later through optional retrieval, with no scores.
7. Move an unsuitable book off the desk without treating it as failure.

## The four spaces

| Space | Role |
|---|---|
| **Room** | Restrained 3D entry: one current book, up to two companions. One action: *Continue reading*. |
| **Reader** | The product. Full-screen, paginated, distraction-free. Built and validated before any 3D polish. |
| **Stacks** | Fast 2D searchable full library. Filters, metadata correction, deterministic fallback covers. |
| **Commonplace** | Quotes, ideas, questions, vocabulary, actions, characters, free notes — with source locators, tags, explicit cross-links, Markdown/JSON export, and opt-in non-scored Recall. |

Settings is a sheet/dialog, not a fifth destination.

## Absolute anti-requirements (enforced, not aspirational)

Never implement:

- Streaks, XP, levels, badges, coins, achievements, leaderboards, confetti, loot, daily quests, points, celebratory particles.
- Guilt copy, red overdue states, unread-book totals on the home view, nagging reminders.
- Social feed, public profile, followers, reviews feed, store.
- Ads, telemetry, analytics, account creation, cloud dependence, silent network calls.
- AI summaries before the user reads a chapter; auto-generated highlights/notes.
- Infinite-scroll home feed; a 3D scene animating behind reading text.
- Pure `#000` behind pure `#FFF`; bright blue accents at night; bloom; lens flares; sudden white loading frames.
- Automatic PDF→EPUB conversion or modification of an original PDF (Reflow is a reversible *view*).
- DRM removal or bypass.

## Product principles

1. One book is foreground; the library is background.
2. Launch → reading requires one action (or direct-resume launch).
3. The full library never appears on the opening screen.
4. All book content and personal data remain local by default.
5. Real progress = bookmark, page, chapter, shelf, notes. Never a reward economy.
6. Story reading and study reading are different cognitive tasks → different modes.
7. Typography is personal: useful default + short optional calibration.
8. The reader is stable and spatial: pagination by default, persistent chapter landmarks, exact locators.
9. Reflection/recall prompts are optional, skippable, and only at natural boundaries.
10. Calm means low interaction density, not low capability.

## Book states and the desk constraint

States: **On desk**, **Paused**, **Completed**, **Reference**. Never "Failed" or "Abandoned" — the neutral action is *Return to shelf*.

At most three books on the desk: one **Current**, one **Companion**, one **Short**. Placing a fourth asks which existing book returns to the shelf. Completion is a factual archive state — a cloth bookmark, not a trophy.

## Reading modes (per book)

- **Story** — pure immersion. No prompts. Annotation and dictionary available on selection.
- **Study** — chapter landmarks, marginalia, optional end-of-chapter prompt ("What stayed with you?" / "One idea worth testing?"), search, Commonplace tools.
- **Contemplative** — deliberately small passage; Read / Reflect / Respond / Rest. No timer.

Mode changes never lose location or annotations.

## Night reading (honest harm reduction)

- **Ember** theme: warm, dark, low-luminance (`#12100E` page, `#C8BBA8` text). No white flash anywhere in the night flow, ever — including splash, dialogs, PDF placeholders, and error surfaces.
- One-time dismissible note recommending a dim warm lamp, lowest comfortable hardware brightness, and paper/e-ink near bedtime. Never repeated nightly.
- Optional Quiet Night window: freeze decorative motion, Ember, defer Recall. Never locks the user out.
- Optional subtle eye-rest glyph at a page turn after ~20 min. Not a modal. Disappears after one page.
- Page-luminance control that states plainly it does not change hardware brightness.

## Format support

- **EPUB 2/3** — reflowable first; sanitized, scripts disabled, remote resources blocked by default.
- **PDF** — faithful fixed layout via PDF.js; optional reversible **Reflow view** for suitable text PDFs (never touches the file, conservative layout analysis, labeled as derived, "Original page" one action away). Scanned PDFs read visually; text tools report "Text not available on this page."
- **TXT / Markdown / simple HTML** — reflowable.
- **MOBI/AZW3** — only via optional, explicit, user-confirmed Calibre conversion (DRM-free only, structured args, original preserved, cache rebuildable).
- **Malayalam** is first-class: shaping, conjuncts, chillus, selection, search, annotations, export — all Unicode-safe, with bundled Noto Malayalam families.

## Definition of done (first usable release)

- Install on Windows 11 → select nested library folder → place one book on desk → open EPUB/PDF → close → return to the exact place.
- Night flow never flashes a bright surface.
- Reader fully operable without a mouse.
- Notes, vocabulary, Commonplace export survive restart and file moves.
- Fully offline after install (except explicitly enabled online dictionary).
- Zero forbidden gamification or analytics.
- Automated tests, Rust + TS checks pass; documented manual QA actually performed.
