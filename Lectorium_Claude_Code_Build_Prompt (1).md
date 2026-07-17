# Lectorium

## Research-backed product brief and master Claude Code prompt

Working title: **Lectorium** — “a quiet room for books.” The name is provisional and must remain easy to change from one config file.

This document specifies a Windows 11 desktop reader for a large local library of EPUBs, PDFs, and related book formats. It is designed for a reader who used to read deeply, now starts books and rarely returns to them, is surrounded by high-frequency digital rewards, dislikes fake gamification, and will often read on a 27-inch 2560×1440 monitor at night.

The product is not a tracker with a reader attached. It is a reader that makes beginning, returning, understanding, and remembering unusually frictionless.

---

## 1. Research conclusions that govern the design

### 1.1 This is not a character defect

The pattern “I read constantly as a child, now I start and abandon books while checking fast digital media” appears repeatedly in reader communities. These accounts are anecdotal, not a diagnosis, but they are strikingly similar: people describe restlessness, returning to the same page without absorbing it, and preferring media with rapid novelty. Notifications themselves can impair attention even without opening the phone. The app must therefore reduce cues, choices, switching, and restart cost rather than lecture the reader about discipline.

Sources:

- [Reddit: readers describing the same loss of sustained reading after smartphones](https://www.reddit.com/r/books/comments/nb8gd7/anybody_else_used_to_read_a_ton_before/)
- [Reddit: “I can’t focus on reading anymore”](https://www.reddit.com/r/ADHD/comments/1ldey58/i_cant_focus_on_reading_anymore_and_i_really_want/)
- [Study of smartphone notifications and cognitive control](https://pmc.ncbi.nlm.nih.gov/articles/PMC9671478/)

### 1.2 A huge library should not become a huge decision

Choice overload is conditional rather than universal, but it is most likely when the set is complex, the decision is difficult, and preferences are uncertain—exactly the situation created by hundreds of unread files. The default surface must therefore present one current book and at most two companions. The full library remains one deliberate step away.

Source: [Choice overload: conceptual review and meta-analysis](https://chernev.com/wp-content/uploads/2017/02/ChoiceOverload_JCP_2015.pdf)

### 1.3 Typography must be personalized, not declared “perfect”

There is no universally fastest font. In a large digital-reading study, different people had materially different fastest fonts, and the font they preferred was not reliably their fastest. The product should offer a short, skippable reading-fit calibration and then give three coherent typography presets rather than an intimidating panel of sliders.

Sources:

- [Different fonts increase reading speed for different individuals](https://jeffhuang.com/papers/Readability_TOCHI22.pdf)
- [W3C guidance: user-selectable colors, no more than 80 characters per line, adequate spacing, and no forced justification](https://www.w3.org/WAI/WCAG21/Understanding/visual-presentation.html)

### 1.4 Screen reading needs spatial structure

Meta-analyses generally find a small paper advantage for comprehension, especially for expository material and under time pressure; narrative-only reading is less consistently affected. Long-text experiments also suggest that physical books can aid chronology and location memory. The app cannot reproduce paper, but it can preserve stable pagination, chapter landmarks, a visible book edge, headings, and annotations instead of presenting an endless, placeless scroll.

Sources:

- [Meta-analysis of paper versus digital reading comprehension](https://www.sciencedirect.com/science/article/pii/S1747938X18300101)
- [Long text on Kindle versus print](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2019.00038/full)
- [Physical and verbal signals can improve on-screen cognitive maps](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2020.571957/full)

### 1.5 Night mode can reduce discomfort; it cannot make a luminous monitor sleep-neutral

Evening light-emitting e-readers have delayed circadian timing and reduced next-morning alertness in controlled research. Warmer color alone is not a magic shield; intensity, duration, timing, and the amount of light reaching the eyes matter. In a dim room, low-luminance negative-polarity text can be comfortable, but reading in total darkness with a bright monitor is still poor ergonomics. The app must be honest: use a warm, dark, low-luminance interface; eliminate bright flashes; recommend a dim warm ambient lamp and the lowest comfortable monitor brightness; and gently suggest paper or e-ink close to bedtime.

Sources:

- [Evening light-emitting e-reader use and sleep/circadian effects](https://www.pnas.org/doi/10.1073/pnas.1418490112)
- [Night Shift reduces short-wavelength output but does not eliminate melatonin suppression](https://pmc.ncbi.nlm.nih.gov/articles/PMC6561503/)
- [Consensus recommendations for daytime, evening, and nighttime light exposure](https://pmc.ncbi.nlm.nih.gov/articles/PMC8929548/)
- [Review of digital eye strain and ambient-light/20-20-20 guidance](https://pmc.ncbi.nlm.nih.gov/articles/PMC9434525/)

### 1.6 Remembering requires retrieval, not decorative highlighting

Spacing and retrieval practice improve durable learning. Historical scholars also dealt with information overload by extracting passages into commonplace books organized under meaningful headings. The app should combine those ideas without turning them into a quiz game: save passages with context, ask for an optional one-sentence personal response at natural boundaries, and provide an opt-in “Recall” view that asks the reader to retrieve an idea before revealing the passage.

Sources:

- [US Institute of Education Sciences: space learning over time](https://ies.ed.gov/ncee/wwc/practiceguide/1)
- [Review of distributed practice and retrieval practice](https://pmc.ncbi.nlm.nih.gov/articles/PMC11078833/)
- [Harvard: the rise of note-taking in early modern Europe](https://dash.harvard.edu/bitstreams/7312037c-8fb7-6bd4-e053-0100007fdf3b/download)

### 1.7 Repetition in a stable context matters more than motivational theatre

Habit research emphasizes repeating a behavior in a stable context. If–then plans also help people initiate intended actions. The app can support one quiet cue at a chosen time and a one-action route back into the book, but it must never use streaks, shame, confetti, points, or an “unread mountain.”

Sources:

- [Systematic review and meta-analysis of habit formation](https://pmc.ncbi.nlm.nih.gov/articles/PMC11641623/)
- [Implementation intentions and goal achievement](https://cancercontrol.cancer.gov/sites/default/files/2020-06/goal_intent_attain.pdf)

---

## 2. The core product decision

The advanced 3D environment belongs at the **doorway**, not behind the text.

- The Reading Room should make opening the application feel like entering a private place devoted to books.
- The moment a book opens, the room must fade away and release its GPU resources. Reading is flat, stable, typographic, and quiet.
- The knowledge layer must contain real artifacts—quotes, questions, ideas, vocabulary, and actions—not invented currencies.

The application has four spaces only:

1. **Room** — a restrained 3D entry containing the current book and two companions.
2. **Reader** — the primary product; full-screen, paginated, and distraction-free.
3. **Stacks** — the searchable full local library.
4. **Commonplace** — the reader’s quotes, notes, questions, vocabulary, and cross-book connections.

---

# 3. Master prompt for Claude Code

Copy everything inside the following block into Claude Code from the empty project folder (or the repository you want it to use).

```text
You are the product architect, senior Windows desktop engineer, interaction designer, 3D designer, accessibility engineer, and QA lead for a serious local reading application.

Build the application described below. Do not merely scaffold it, produce mock screens, or stop after a design plan. Work in verified milestones. At each milestone, run the relevant checks, repair failures, and update the project documentation. If the directory already contains a project, inspect and preserve it; otherwise create the project here. Follow any existing AGENTS.md or repository instructions. Do not push, publish, upload, or enable analytics.

## Product identity

Working name: Lectorium
Tagline: A quiet room for books.

Keep the name and tagline in a single typed config file so they can be renamed later.

## User and problem

The primary user is a young adult on Windows 11 with a very large local library of EPUBs, PDFs, and occasional other ebook formats. He used to read deeply as a child, now often reads intensely once and never reopens the book, and is easily pulled toward fast-reward apps. He dislikes obvious gamification because points, badges, streaks, coins, and arbitrary scores feel fake. He often reads at night on a 27-inch, 2560×1440 LG monitor, sometimes with the room lights off. He wants fiction, self-development, history, literature, and difficult nonfiction to be inviting, comprehensible, and memorable.

This is not a productivity dashboard. It is a calm reading instrument.

## Product promise

Make these actions exceptionally easy:

1. Start the current book.
2. Resume at the exact place, with enough context to re-enter.
3. Stay in the text without visual or interactive temptation.
4. Understand difficult words and passages without falling into a browser rabbit hole.
5. Preserve ideas worth remembering in a real personal commonplace book.
6. Return to self-authored ideas later through optional retrieval, with no scores.
7. Move an unsuitable book off the desk without treating it as failure.

No application can guarantee that a person reads every file. Build for durable reading, intelligent selection, and meaningful completion—not compulsive collection.

## Absolute anti-requirements

Do not implement:

- streaks, XP, levels, badges, coins, achievements, leaderboards, confetti, loot, daily quests, arbitrary points, or celebratory particle effects;
- guilt copy, red overdue states, “you broke your streak,” unread-book totals on the home view, or nagging reminders;
- a social feed, public profile, follower system, reviews feed, or store;
- ads, telemetry, analytics, account creation, cloud dependence, or silent network calls;
- AI summaries shown before the user reads a chapter;
- auto-generated highlights or notes that replace the reader’s thinking;
- an infinite-scroll home feed;
- a 3D scene continuously animating behind reading text;
- pure black behind pure white text, bright blue accents at night, bloom, lens flares, or sudden white loading screens;
- automatic PDF-to-EPUB conversion or modification of an original PDF. Fixed-layout conversion is often destructive. A reversible in-app Reflow view for suitable text PDFs is required instead;
- DRM removal or instructions that bypass DRM.

## Product principles

1. One book is foreground; the library is background.
2. The fastest path from launch to reading requires one action or an optional direct-resume launch.
3. The full library never appears on the opening screen.
4. All book content and personal data remain local by default.
5. Real progress may be represented by a bookmark, page, chapter, shelf, and notes. It must never be converted into a fake reward economy.
6. Story reading and study reading are different cognitive tasks and must have different modes.
7. Typography is personal. Provide a useful default and a short optional calibration.
8. The reader is stable and spatial: pagination by default, persistent chapter landmarks, and exact locators.
9. All reflection and recall prompts are optional, skippable, and placed at natural boundaries—not injected into paragraphs.
10. Calm means low interaction density, not low capability.

## Target platform and implementation stack

Use current stable releases verified against official documentation at implementation time; do not guess version numbers.

- Tauri 2 desktop application, Windows 11 first.
- React + TypeScript + Vite.
- pnpm.
- Rust for recursive scanning, file watching, hashing, safe filesystem mediation, and any operation that would be inefficient across WebView IPC.
- SQLite for durable local data, with versioned migrations. Prefer typed repository/service modules over ad-hoc SQL scattered through components.
- Zustand or an equally small state layer for transient UI state. Do not put persistent domain data only in browser localStorage.
- EPUB: epub.js behind a ReaderEngine interface. Load local EPUBs as ArrayBuffer or through a strictly scoped local protocol. Use EPUB CFI plus spine/section data for robust locators. Sanitize and sandbox publication content; disable publication scripts and remote resources by default.
- PDF: Mozilla PDF.js with worker rendering, text layer, annotation layer, search, page labels, and virtualization. Preserve fixed layout. Do not convert PDFs behind the user’s back.
- 3D room: Three.js through @react-three/fiber and drei. Use demand-driven rendering, instancing, compressed assets, and a graceful 2D fallback.
- Accessible headless UI primitives (for example Radix) are acceptable, but the visual design must be original rather than a generic component-library dashboard.
- Vitest + Testing Library for unit/component tests and Playwright for browser-level flows/visual regression. Add a practical Tauri smoke-test procedure.
- Use strict TypeScript, ESLint, formatting, and Rust fmt/clippy.

Keep the reader engine abstract enough that epub.js can later be replaced by a more complete Readium implementation without rewriting the product UI or data model.

## Local-first security model

- The user explicitly chooses library folders. Store durable folder grants using the supported Tauri persisted-scope approach where appropriate.
- Scope filesystem and asset-protocol access to the selected roots and app-owned cache only. Never grant broad home-directory access just because it is convenient.
- Apply a strict Content Security Policy.
- Treat EPUB HTML/CSS, SVG, remote links, embedded scripts, and PDF actions as untrusted input.
- Publication JavaScript is disabled. External URLs require explicit confirmation and open in the system browser.
- Remote images/fonts/resources in publications are blocked by default with a per-book opt-in.
- No local file path is rendered into unsafe HTML.
- Any optional Calibre `ebook-convert` integration must be explicit, limited to DRM-free files, detect the executable safely, invoke only that executable with structured arguments, never a shell string, and preserve the source file.
- Create atomic database backups and an export/import format for user-created data.

## Supported formats

MVP direct support:

- EPUB 2/3, reflowable first; preserve reasonable publisher structure while allowing reader styles.
- PDF, including text PDFs and scanned/image PDFs for visual reading. Text-based PDFs must also offer an optional, reversible in-app Reflow view that adopts the Reader typography and themes without modifying or converting the original file.
- TXT, Markdown, and simple local HTML as reflowable text.

Secondary import:

- MOBI and AZW3 only through an optional, user-confirmed Calibre conversion adapter when Calibre is installed and the file is DRM-free. Store the generated EPUB in app cache, keep the original path and provenance, and make the cache rebuildable.
- Show a calm, precise unsupported/DRM message. Never pretend an import succeeded.

PDF Reflow is a view, not a file conversion. Derive it from PDF.js text content, cache only rebuildable layout data, retain page anchors, and keep “Original page” one action away. Detect obviously unsafe cases such as image-only scans, complex tables, equations, unusual positioned text, and ambiguous multi-column reading order. In those cases, explain that reflow may be inaccurate and default to Original page. Never silently scramble a book.

For scanned PDFs, visual reading must still work. Text-dependent features should display “Text not available on this page.” Architect a later local OCR adapter, but do not make OCR a blocker for the main reader.

Malayalam is a first-class supported reading language, not merely a generic “non-Latin” edge case. EPUB, reflowed PDF text, TXT, Markdown, metadata, search, selection, copy, highlighting, notes, bookmarks, and Commonplace export must preserve Malayalam Unicode text and correct shaping. Fixed-layout PDFs must render their embedded Malayalam glyphs faithfully when the source PDF is valid. If a PDF uses broken/custom character encoding, the visual page should still render, while search/copy/reflow must report the limitation rather than returning corrupted text.

## Information architecture

Use exactly four primary destinations: Room, Reader, Stacks, Commonplace. Settings is a sheet/dialog, not a fifth destination.

### Room

The Room is the default atmospheric entry unless the user enables direct resume.

- Show one current book physically resting on a walnut desk.
- Show at most two smaller companion books on a side stand: one contrasting long-form book and one short/easy book. These are real selected books, not recommendations pulled from the internet.
- The full library exists as shelves in the background but individual thousands of books are not all interactive 3D meshes.
- One obvious action: Continue reading.
- Secondary actions: choose another book; open Stacks; open Commonplace.
- Never show total unread count, daily target, charts, or completion statistics here.
- If there is no current book, the desk displays “Place one book here,” leading to a fast searchable picker.
- If a file is missing, show “Find this file” rather than a destructive error.

### Stacks

The Stacks is a fast 2D library, not a 3D maze.

- Search by title, author, filename, series, tags, and—when indexed—book text.
- Filters: On desk, Paused, Completed, Reference, format, author, collection.
- Do not use “Failed” or “Abandoned.” The neutral action is “Return to shelf” or status “Paused.”
- Allow manual metadata and cover correction.
- Covers missing from files receive elegant deterministic typographic covers, generated locally from title/author; no AI and no network.
- A preview drawer shows description/metadata, table of contents, file details, and “Place on desk.” It does not expose a wall of metrics.
- Allow nested-folder rescan, drag/drop files, duplicate resolution, and missing-file relinking.
- Scanning and metadata extraction happen in the background with calm status. The UI remains usable for a library of at least 10,000 files.

### Commonplace

This is a real intellectual artifact, not a trophy cabinet.

- Entries may be Quote, Idea, Question, Vocabulary, Action, Character, or Free note.
- Every excerpt retains book, author, chapter/page, stable locator, created date, and the reader’s optional response.
- Tags/headings are reader-defined “commonplaces” such as courage, power, rhetoric, discipline, love, history, or craft.
- Search across the reader’s own notes and quoted excerpts.
- Cross-book connections are explicit links the reader creates. Offer likely same-tag entries, but do not fabricate semantic claims.
- Export one book or the whole commonplace as clean Markdown and JSON, including source locations.
- Provide an opt-in Recall view. It first shows a reader-authored cue or heading and asks “What do you remember?” After the user thinks or types, Reveal shows the original passage and note. There are no grades, percentages, streaks, or due-date shame.
- Spacing may schedule when an entry quietly becomes available in Recall, but the queue is never forced and the scheduling algorithm is not displayed as a game.

## Book states and the desk constraint

Book states:

- On desk
- Paused
- Completed
- Reference

Allow no more than three books on the desk by default: one Current, one Companion, one Short. If the user places a fourth, ask which existing book should return to the shelf. This is not punishment; it prevents the opening view from reproducing the overwhelming library.

The Completed state is a factual archive state. Do not animate a trophy, award points, or move a counter. A subtle cloth bookmark or a normal Completed shelf is enough.

## Onboarding

Onboarding is three screens maximum and every optional step is skippable.

1. Choose one or more local book folders. Explain: “Your books and notes stay on this computer.”
2. Search and place one book on the desk. Copy: “Choose the book you most want to return to—not the book you think you should read.”
3. Choose Day or Ember appearance and finish. Briefly recommend a dim warm room lamp and lowest comfortable hardware brightness for night reading. Be honest that a glowing monitor is not equivalent to paper or e-ink near bedtime.

Do not put the typography calibration, target bedtime, reminder schedule, goals, or tutorial carousel in onboarding. Offer them later from a small “Make the page fit me” action.

## Reader experience

The Reader is the highest-priority surface. Build and validate it before polishing the 3D room.

### Entry and resumption

- Autosave location frequently and on every navigation, window blur, suspend, and clean close.
- Reopen at the exact stable locator. Never default to a nearby chapter because a percentage was rounded.
- On return after a gap, show a quiet translucent re-entry ribbon for a few seconds: book title, chapter/section, and the reader’s last note if one exists. Do not generate a plot summary.
- The ribbon disappears on any reading/navigation input and can be disabled.
- A `--resume` argument or deep-link/shortcut should launch straight into the most recent book when practical.

### Reading modes

Each book has one mode:

1. Story — pure immersion. No learning prompts at chapter ends. Annotation and dictionary remain available on selection.
2. Study — stable chapter landmarks, marginalia, optional end-of-chapter prompt, text search, and Commonplace tools.
3. Contemplative — optional for scripture, devotional reading, philosophy, or poetry. Present a deliberately small passage and four unobtrusive actions: Read, Reflect, Respond, Rest. No timer and no religious claims imposed on other books.

Mode is a per-book preference and can change without losing location or annotations.

### Layout

- EPUB and reflowable text use pagination by default. Continuous scroll is available but not the default.
- A single centered page is the default even on 2560×1440. An optional two-page Spread mode may appear for sufficiently wide windows, but never change modes automatically after the user has begun a book.
- Text column default: about 62–68 characters per line; adjustable safe range 48–78ch; never exceed 80ch in normal reflow.
- Base font default on the target monitor: 20 CSS px, user-adjustable from 16–32px.
- Default line-height: 1.58. Provide coherent presets rather than exposing all sliders first:
  - Focus: 19px, 1.48 line-height, 60ch.
  - Open (default): 20px, 1.58 line-height, 66ch.
  - Air: 21px, 1.68 line-height, 58ch.
- Advanced controls: font, size, line height, page width, paragraph spacing, letter spacing, word spacing, alignment, hyphenation, margins, column count.
- Left-align by default. Do not force full justification. Preserve poetry, code, tables, footnotes, block quotes, headings, images, and semantic structure.
- For novels, preserve first-line indents and avoid adding a blank gap between every paragraph. For nonfiction whose source uses block paragraphs, respect or sensibly normalize the source.
- UI chrome fades after 2.5 seconds of no pointer movement or keyboard command. Text, a two-pixel book-edge landmark, and the current page remain stable.
- No visible timer or speed meter during reading.
- Page transition: 120–180ms subtle directional translate/fade, never a showy page curl. Disable under reduced motion.

### Typography

Bundle open-source reading fonts locally so the app works offline:

- Literata
- Noto Sans
- Source Serif 4
- Atkinson Hyperlegible
- EB Garamond
- Noto Sans Malayalam
- Noto Serif Malayalam

Use a quiet sans-serif such as Inter for interface labels only. Verify licenses and include notices.

Define script-aware font stacks. For content tagged `lang="ml"`, detected as Malayalam Unicode (U+0D00–U+0D7F), or carrying Malayalam publication metadata, prefer Noto Serif Malayalam for book text and Noto Sans Malayalam for interface-like text. Do not apply Latin fonts to Malayalam glyphs and hope that an arbitrary system fallback works. Preserve conjuncts, chillus, vowel signs, punctuation, line breaking, and text selection. Use the browser/WebView shaping engine rather than manually positioning glyphs. Let the user choose either bundled Malayalam family.

Default to Literata/Open for first use, but offer “Make the page fit me,” a 4–6 minute skippable calibration:

- Use five original, neutral, matched passages around 130–170 words and approximately grade 7–9 difficulty.
- Randomize font order.
- Normalize perceived x-height using supported CSS such as `font-size-adjust` or empirically tested scale factors.
- Ask one simple comprehension question after each passage.
- Record elapsed reading time privately. Reject obviously interrupted samples.
- Select the fastest font among passages answered correctly; in a close tie, use stated comfort.
- Do not display WPM as a score or claim a medical/diagnostic result.
- Let the user override, rerun, or delete calibration data.

### Themes and exact visual tokens

Implement at least these themes using CSS custom properties. Check all final foreground/background combinations with an automated contrast test.

Paper (day):

- app surround: #D8D0C3
- page: #F3EBDD
- primary text: #2C2823
- secondary text: #6E645A
- accent: #7A4E2D
- selection: #D9BE9A

Ember (night default):

- app/page background: #12100E
- raised surface: #191611
- primary text: #C8BBA8
- secondary text: #8F8372
- accent: #B18452
- selection: #5A452D
- hairline: #2A241D

Do not use pure #000 or #FFF. Do not use bright saturated blue for focus states at night; use a warm accessible outline. Link styling inside books must be distinguishable without relying only on color.

Add a “page luminance” control that darkens the app content but clearly states it does not change the monitor’s hardware brightness. Never flash a white intermediate frame while loading or changing books.

### Spatial landmarks

- Keep stable section/chapter boundaries and locators.
- Show a very thin right-side fore-edge with small chapter notches and current position. It is real navigation, not a progress reward.
- Reveal chapter name and location on hover/focus or a keyboard command; keep percentages hidden by default.
- PDF may expose page thumbnails in a drawer. EPUB exposes a hierarchical table of contents and a compact section map.
- Changing font/layout must preserve the logical locator and recompute pages without moving the reader to an approximate percentage.

### PDF behavior

- Default to single-page paginated view.
- Fit page, fit width, actual size, custom zoom, two-page spread, rotate, crop margins, and page-label navigation.
- Offer two reversible presentation families:
  - Original page: faithful fixed-layout PDF rendering.
  - Reflow: for suitable text PDFs, reconstruct a semantic reading stream from PDF.js text items, retain headings/paragraphs/page anchors where confidently detectable, and render it through the same typography/theme system as EPUB. Reflow never changes the source PDF and always labels itself as a derived view.
- Run conservative layout analysis before enabling Reflow by default. Measure columns, line baselines, font-size clusters, spatial gaps, and text coverage. If confidence is low, keep Reflow available as experimental with a clear preview/warning rather than pretending the extracted order is correct.
- Persist progress in a cross-view locator containing source PDF page plus text-quote context and intra-page position, so switching between Original and Reflow returns to the same passage as closely and deterministically as possible.
- Render only visible/adjacent pages. Use an LRU cache with strict memory limits and render at appropriate device pixel ratio without creating unbounded canvases.
- Provide selectable text, find-in-book, keyboard navigation, links with confirmation, and annotations anchored to page plus text quote/coordinates.
- For image-only pages, reading/navigation still works. Disable text tools gracefully.
- Preserve page geometry when restoring annotations.
- In Ember, Reflow uses the normal Ember palette. Original-page PDFs offer Original, Warm Dim, and Smart Dark display choices. Warm Dim lowers page luminance without destructive inversion. Smart Dark may recolor near-achromatic paper/text while preserving photographs and colored figures; it must be opt-in, reversible, and automatically fall back when page analysis predicts damaged imagery or diagrams. Never overwrite the PDF.
- Verify Malayalam PDFs separately. Embedded-font visual rendering, Unicode text-layer extraction, search, copy, Reflow, annotations, and export are distinct capabilities and must each fail gracefully if the source PDF encoding supports only some of them.

### EPUB behavior

- Respect the EPUB spine, TOC, language, direction, footnotes, images, and structural semantics.
- Support CFI-based selections and locations plus a text-quote fallback for resilience.
- Reader CSS overrides are scoped and reversible; Publisher style is an available mode.
- Footnotes open in a small in-app popover and return to the exact source location.
- External links require explicit action.
- Never allow an EPUB to execute arbitrary script in the application context.
- Honor EPUB language metadata and element-level `lang` attributes. Malayalam text must automatically use the bundled Malayalam font stack unless Publisher style supplies a valid embedded Malayalam font. Test mixed English–Malayalam paragraphs, headings, footnotes, tables of contents, search results, selections spanning conjuncts, and exported quotations.

### Selection toolbar

On text selection show a small, non-blocking toolbar:

- Highlight
- Note
- Define
- Keep (to Commonplace)
- Copy

The toolbar must be keyboard accessible and disappear without altering selection if dismissed.

Definition behavior:

- Use an adapter interface.
- Provide a modest offline English option if a responsibly licensed WordNet-compatible package is practical.
- An optional online dictionary may be enabled explicitly, with clear network disclosure and cached responses.
- Show one concise context-appropriate definition first, pronunciation when available, and the sentence. Do not open a browser or show a page of unrelated senses by default.
- “Keep word” saves the word, sentence, book locator, definition, and the reader’s optional note to Vocabulary.

### Natural stopping points

- Do not interrupt a reader with timers, popups, or congratulations.
- At a chapter end in Study mode only, show one quiet optional field: “What stayed with you?”
- For practical/self-development books, allow an alternate prompt: “One idea worth testing?” plus an optional context field. This creates a Commonplace Action, not a habit streak.
- Story mode simply continues.
- Closing the app never requires a reflection. Save instantly and leave.

### Keyboard and input

Implement and document:

- Left/Right or PageUp/PageDown: previous/next page
- Space/Shift+Space: next/previous page
- F: fullscreen
- T: table of contents/section map
- S or Ctrl+F: search (use conventional Ctrl+F; do not override if conflicting)
- A: appearance sheet
- N: note on current selection
- B: bookmark
- C: open/close Commonplace side sheet
- Esc: close sheet, then exit fullscreen; never unexpectedly close the book
- Ctrl++ / Ctrl+- / Ctrl+0: text zoom/reset in reflowable books; PDF zoom in PDF mode

Support mouse, keyboard-only, and touchpad. Do not require precise hover interactions.

## Night-reading and eye-comfort behavior

The software cannot promise to protect sleep. Implement harm-reducing design honestly:

- Ember is the recommended dark-room theme.
- Never display a white splash, dialog, webview, PDF placeholder, or error surface in Ember.
- If the user sets a target bedtime, enter Quiet Night during the chosen wind-down window: freeze decorative room motion, remove optional audio, use Ember, suppress nonessential notifications, and defer Recall prompts. Do not lock the user out.
- On first use of night mode, show one dismissible note: “For the lowest sleep impact, use paper or e-ink near bedtime. On this monitor, keep a dim warm lamp in the room and set hardware brightness to the lowest comfortable level.” Do not repeat it nightly.
- Offer an optional subtle eye-rest glyph at a page turn after roughly 20 minutes. It is not a modal, timer, or required break and disappears after one page.
- Respect reduced motion and high contrast preferences.

## 3D Reading Room art direction

The Room should feel like a private nocturnal study built from walnut, cloth, paper, aged brass, and warm shadow—adult, restrained, and tactile. It must not look like a fantasy game lobby, a productivity SaaS dashboard, or a children’s rewards app.

Scene:

- Fixed, slightly elevated 35–45° camera with a small deliberate camera move only after explicit selection.
- Walnut desk in the foreground; current book centered under a shaded amber lamp.
- Tall shelves in shadow; two companion books on a side stand.
- A dark window or architectural recess may add depth, but no bright moon, neon, visible UI billboards, or endlessly animated rain.
- PBR materials with baked lighting/lightmaps. Soft shadow, subtle ambient occlusion, restrained depth of field if it does not impair performance. No bloom.
- Real cover image on the current book face. Generate a coherent spine from cover colors/title/author.
- Book-open transition lasts about 500–700ms, then the scene crossfades fully out and is unmounted or paused. The reader page appears without a bright flash.

Performance:

- `frameloop="demand"` or equivalent; render only when needed.
- No continuous dust particles. If any atmospheric motes exist, stop after a few seconds and disable in Quiet Night/reduced motion.
- Use instanced shelf-book geometry and LOD. Never create 10,000 unique cover-textured meshes.
- Pause when window loses focus and release large textures when entering Reader.
- Target smooth interaction on integrated graphics; offer Low/High/2D quality. Detect WebGL failure and fall back to a beautiful static/CSS room.
- Cap texture sizes, use KTX2/Draco where justified, and document asset licenses.

The 3D room is an emotional threshold. The 2D Stacks remains the serious library tool.

## Visual design outside the room

- Use generous negative space, low panel density, and restrained warm materials.
- Avoid glassmorphism everywhere. A little translucent re-entry ribbon is acceptable; the base UI should be crisp and stable.
- Buttons are text-first, quiet, and visibly focusable.
- Rounded corners should be modest (6–12px), not bubbly.
- Use real typographic hierarchy rather than many bordered cards.
- The Reader must use DOM text for EPUB/TXT/Markdown, never rasterized text.
- The application must remain usable at 200% text scaling without two-dimensional scrolling for reflowable content.

## Data model

Create normalized, migrated tables or equivalent typed domain structures for at least:

### library_roots
- id
- canonical_path
- display_name
- added_at
- last_scan_at
- watch_enabled

### books
- id UUID
- content_hash (BLAKE3 or equivalent; calculate in background)
- quick_fingerprint (size + modified time for scan triage)
- canonical_path
- derived_path nullable
- source_format
- reading_format
- title
- authors structured JSON or related table
- language
- series and series_index nullable
- description nullable
- cover_cache_path nullable
- status enum
- desk_role nullable (current, companion, short)
- reading_mode enum
- added_at
- last_opened_at nullable
- completed_at nullable
- missing_since nullable
- metadata_override JSON

### book_locations
- book_id unique
- engine_type
- locator_json (CFI/spine/href/text quote for EPUB; page/page label/coordinates for PDF)
- section_title nullable
- page_index nullable
- hidden_progress_estimate nullable
- updated_at

### annotations
- id UUID
- book_id
- kind enum
- start_locator_json
- end_locator_json
- exact_quote
- prefix/suffix text quote context
- note nullable
- color_token
- commonplace_heading nullable
- created_at
- updated_at

### vocabulary
- id UUID
- book_id
- normalized_word
- displayed_word
- sentence
- definition
- locator_json
- note nullable
- created_at

### links
- from_annotation_id
- to_annotation_id
- label nullable
- created_at

### recall_state
- item_type and item_id
- available_after nullable
- last_seen_at nullable
- reader_response nullable

### settings
- typed versioned settings, including theme, typography preset, custom reader values, reduced motion, direct resume, target bedtime, reminder preference, and 3D quality.

Avoid collecting a minute-by-minute surveillance history. Reading-session logs are not required for this product. If a transient session table is needed for crash recovery, do not turn it into a dashboard.

## Scanning and file identity

- Recursively scan selected roots on a background thread.
- First compare path/size/modified time; calculate full content hash lazily in the background.
- Deduplicate identical content while allowing multiple editions/formats of the same title.
- Never delete original files.
- File watcher events are debounced and coalesced.
- If a file moves within a root, attempt hash-based relinking without losing notes/progress.
- If missing, retain all metadata and user data indefinitely until the user explicitly removes the library record.
- Caches are disposable and rebuildable.

## Backup and export

- Automatic rotating local backup of the SQLite database before migrations and periodically after meaningful changes.
- Atomic writes and migration rollback/failure recovery.
- “Export my reading data” creates a human-readable folder or archive containing JSON plus Markdown Commonplace files. It must not copy copyrighted book files unless the user explicitly asks for a full library backup.
- “Import reading data” validates schema/version and previews conflicts.

## Reminder design

Reminders are optional, local, and singular.

- The user may choose one stable cue time.
- Copy: “The room is ready.”
- If dismissed, do not repeat that day.
- No streak status or guilt.
- Clicking opens the current book, not a dashboard.
- Do not enable reminders by default.

## Error copy

Use calm, exact language:

- “This file moved. Find it to restore the book.”
- “This PDF page contains no selectable text.”
- “This book appears to be protected and cannot be opened here.”
- “Lectorium could not read this file. Your original was not changed.”

Never say “Oops!”, blame the user, or show a raw stack trace in the main UI. Keep diagnostics in a copyable details drawer and local logs.

## Accessibility

- WCAG 2.2 AA for application UI.
- Reflowable text can scale to at least 200% without horizontal scrolling.
- Keyboard-complete flows and visible focus.
- Screen-reader labels and semantic headings/navigation.
- Reduced-motion and 2D-room alternatives.
- Never encode annotation kind only by color.
- All selection tools accessible without a mouse.
- RTL and non-Latin EPUB content must not be corrupted even if initial typography calibration is English-only.
- Malayalam is explicitly supported across reading, metadata, search, selection, annotations, vocabulary/context capture, Commonplace, Markdown/JSON export, and backup/restore. Do not treat glyph display alone as complete language support.

## Performance budgets

Measure rather than merely claim:

- Warm launch to Room or direct-resume shell: target under 2 seconds on a typical Windows 11 laptop.
- Resume previously opened normal-sized EPUB: target visible text under 1 second after shell.
- Page turn once adjacent page is prepared: under 100ms response, excluding deliberate animation.
- UI remains responsive while scanning 10,000 files.
- PDF memory is bounded through virtualization and LRU caching.
- 3D Room idles near zero GPU work when visually static and does not render while Reader is open.

Record measurements in `docs/PERFORMANCE.md`, including hardware and test data. If a budget cannot be met, document the measured result and bottleneck; do not fake success.

## Required tests and fixtures

Include legal local fixtures or scripts that download public-domain fixtures only when explicitly run:

- one normal EPUB with chapters, images, footnotes, and TOC;
- one Malayalam EPUB fixture containing headings, body paragraphs, conjuncts/chillus, footnotes, TOC, mixed English–Malayalam text, and searchable/selectable passages; create an original fixture or use a clearly licensed/public-domain source;
- one additional RTL EPUB if licensing permits, because Malayalam support does not substitute for RTL testing;
- one normal text PDF;
- one correctly encoded Malayalam text PDF with an embedded Malayalam font, plus a deliberately problematic/custom-encoded Malayalam PDF fixture if it can be created legally;
- one scanned/image-only PDF;
- one malformed/unsupported file;
- TXT and Markdown samples.

Test:

- import/rescan/dedup/move/relink;
- exact resume across restarts and layout changes;
- switching a suitable PDF between Original and Reflow without losing the passage, and refusing/flagging unreliable reflow for complex or scanned pages;
- EPUB CFI and text-quote annotation restoration;
- PDF page/coordinate annotation restoration;
- Malayalam rendering, shaping, TOC, search, selection, copy, annotation restoration, PDF Reflow where supported, and Markdown/JSON export without Unicode corruption;
- database migration and backup recovery;
- theme never flashes white in Ember;
- keyboard-only book opening, page navigation, selection tools, appearance, and exit;
- 200% scaling/reflow;
- reduced motion and 2D fallback;
- large-library virtualization;
- 2560×1440 and 1920×1080 visual regression, including Windows 125% scaling assumptions;
- malicious EPUB content: script, external resource, dangerous URL, and malformed CSS isolation.

## Build order

Do not begin with 3D polish. Implement in this order:

### Milestone 0 — Repository and product contract

- Inspect environment and official current docs.
- Create architecture decision records for Tauri, EPUB engine, PDF engine, locator model, and security boundaries.
- Scaffold the Tauri/React/TypeScript app.
- Establish design tokens, database migrations, logging, tests, and CI-friendly commands.
- Create `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/TESTING.md`, and `docs/ROADMAP.md`.

Acceptance: development app launches on Windows-compatible WebView setup; typecheck, lint, unit tests, Rust fmt/clippy pass.

### Milestone 1 — Library core and complete plain reader shell

- Folder selection, recursive scan, metadata queue, SQLite persistence, covers, deterministic fallback covers, Stacks search/filter, desk roles.
- EPUB/PDF/TXT/Markdown open and render, including explicit Malayalam font fallback and Unicode-safe metadata/search foundations.
- Stable location autosave and exact resume.
- Ember/Paper themes and three typography presets.
- Pagination and keyboard navigation.
- No 3D yet; use a high-quality static Room so the product is usable.

Acceptance: close and relaunch into the exact page/CFI for EPUB and PDF; missing files do not lose data; no white flash in Ember.

### Milestone 2 — Reader depth

- TOC/section map, spatial book edge, PDF Original/Reflow/night modes, cross-view PDF locators, text selection, search, highlight/note/bookmark, footnotes, dictionary adapter.
- Story/Study/Contemplative modes.
- Typography calibration.
- Accessibility, Malayalam EPUB/PDF end-to-end validation, and malicious-content hardening.

Acceptance: the Reader is good enough to use for a complete book before any 3D work proceeds.

### Milestone 3 — Commonplace and recall

- Typed entries, quotes with source locators, tags/headings, cross-links, Markdown/JSON export, optional Recall view.
- Chapter-end Study prompt and practical-book Action.

Acceptance: every exported excerpt can navigate back to its in-app source; Recall contains no scores or forced prompts.

### Milestone 4 — 3D Room

- Build/import optimized room assets, current-book cover/spine, desk roles, restrained transition, WebGL quality levels, static fallback.
- Ensure the scene unmounts/pauses in Reader and in Quiet Night as specified.

Acceptance: visual quality at 2560×1440, keyboard-accessible equivalents for every 3D action, measured GPU/CPU behavior, no continuous decorative animation.

### Milestone 5 — Hardening and Windows handoff

- Large-library and large-PDF testing, crash recovery, backup/restore, installer, app icon, first-run flow, direct-resume shortcut, documentation.
- Manual visual QA at every target resolution/theme and a clean-machine installation checklist.

Acceptance: produce a signed-off `docs/RELEASE_CHECKLIST.md` with commands and actual results. Do not claim code signing unless it is truly configured with a certificate.

## Definition of done

The first usable release is done only when:

- A user can install it on Windows 11, select a nested library folder, place one book on the desk, open EPUB/PDF, close the app, and return to the exact place.
- The target night flow never flashes a bright surface.
- The Reader can be operated without a mouse.
- Notes, vocabulary, and Commonplace export survive restart and file moves.
- The application works fully offline after installation, apart from explicitly enabled online dictionary behavior.
- No forbidden gamification or analytics exists.
- Automated tests pass, Rust and TypeScript checks pass, and the documented manual QA has actually been performed.

## Working style

- Keep a milestone checklist in `docs/ROADMAP.md` with evidence links to tests/files, not vague percentages.
- Before installing a dependency, confirm it is maintained/licensed and explain its role in `docs/DEPENDENCIES.md`.
- Prefer a small coherent dependency set.
- When a requirement is technically risky, implement the simplest secure version, record the trade-off, and leave a clear extension seam. Do not hide incomplete behavior behind a fake button.
- Use real local fixtures and real persistence, not hard-coded demo books.
- After each milestone, provide: changed files, commands run, test results, known limitations, and the next exact milestone.

Begin with Milestone 0. Then continue through the milestones autonomously while the environment permits. Stop only for a genuinely blocking user decision, unavailable platform dependency, or external credential. Do not ask aesthetic questions already answered by this specification.
```

---

## 4. Continuation prompts for Claude Code

Use these only if Claude Code stops between phases. Do not paste all of them at once.

### Continuation A — after scaffolding

```text
Continue Lectorium from the current repository state. Read every product/architecture/security/roadmap document and inspect actual code before changing anything. Complete Milestone 1 end-to-end: real folder import, persistence, desk roles, EPUB/PDF/TXT/Markdown reading, bundled Malayalam font fallback and Unicode-safe metadata/search, Paper/Ember themes, pagination, exact autosave/resume, and tests. Do not work on 3D. Run all checks and manually exercise the core flow using legal fixtures. Update the roadmap with evidence and report actual limitations.
```

### Continuation B — make the reader excellent

```text
Continue Lectorium. Complete Milestone 2 and treat the Reader as the product: stable spatial pagination, EPUB CFI resilience, PDF Original/Reflow/night modes with conservative layout detection and cross-view locators, table of contents, book-edge landmarks, selection tools, search, annotations, dictionary adapter, Story/Study/Contemplative modes, typography presets and calibration, first-class Malayalam EPUB/PDF rendering-search-selection-export tests, keyboard accessibility, 200% reflow, reduced motion, and malicious-publication hardening. Do not begin 3D until complete English and Malayalam books can realistically be read in the current build. Run and repair tests; update docs with measured results.
```

### Continuation C — build meaningful memory, then the room

```text
Continue Lectorium. Complete Milestone 3 first: Commonplace entries with source locators, headings/tags, cross-links, vocabulary, Markdown/JSON export, optional non-scored Recall, and natural-boundary Study prompts. Verify every excerpt can return to its source. Only after that passes, complete Milestone 4’s restrained 3D Reading Room with demand rendering, optimized assets, real covers, direct keyboard equivalents, Ember-safe transitions, Quiet Night behavior, and a polished static fallback. Measure CPU/GPU behavior and ensure the room does not render during reading.
```

### Continuation D — release hardening

```text
Finish Lectorium as a Windows 11 release candidate. Perform Milestone 5, not a superficial cleanup: test a large synthetic library, large PDFs, malformed files, moves/relinks, backups/migrations, exact restart resume, keyboard-only flows, reduced motion, 2D fallback, 2560×1440 and 1920×1080 at relevant scaling, and both themes with no white flashes. Build the installer, create the clean-machine checklist, run every automated check, fix failures, and write RELEASE_CHECKLIST.md with actual commands/results. Do not claim signing, performance, or compatibility that was not verified.
```

---

## 5. Personal setup after the app exists

The software alone should not pretend to cure the problem. The intended real-world setup is deliberately small:

1. Put only one main book, one contrasting companion, and one short book on the desk.
2. Launch the app at one stable time or stable cue, not whenever guilt appears.
3. Keep the phone physically out of reach and silence desktop notifications before opening the book.
4. At night, use Ember, the lowest comfortable hardware brightness, and a dim warm lamp rather than a bright monitor in a pitch-black room.
5. Start the first two weeks with an absorbing story plus one practical nonfiction book. Do not begin with an entire shelf of “books I should read.”
6. In nonfiction, keep only the ideas that genuinely change a decision, question, or action. Highlighting everything creates another unread library.
7. A book may return to the shelf. Finishing a poor or mistimed book is not automatically more intelligent than choosing a better one.

The goal is not to prove discipline for fourteen days. It is to make deep reading feel like a place your mind remembers how to enter.
