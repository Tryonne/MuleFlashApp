# MCD Questions Webapp

MuleSoft Certified Developer (MCD) Level 1 exam flashcard study application — 160 questions.

## Tech Stack

- Vanilla JavaScript (no framework)
- HTML5 + CSS3 (dark theme, CSS variables, responsive)
- Node.js HTTP server (`server.js`) — port 3000

## How to Run

```bash
node server.js
```

Opens at `http://localhost:3000`.

## Key Files

| File | Purpose |
|------|---------|
| `app.js` | All application logic: parser, rendering, exam mode, state, navigation (~1100 lines) |
| `index.html` | HTML shell with all UI elements and modals |
| `styles.css` | Complete styling (dark theme with CSS variables) |
| `server.js` | Node.js HTTP server with security headers, gzip, caching |
| `mcd_questions_answers/QuestionsStructure.md` | All 160 questions in markdown format |
| `mcd_questions_answers/*.png` | Question/exhibit images (UUID-named PNGs) |

## Constants (app.js top)

```js
const EXAM_PASS_THRESHOLD = 80; // percentage — change here to adjust pass mark
const STORAGE_KEY = 'mcd_app_state';
const IMAGE_BASE_PATH = 'mcd_questions_answers/';
const MD_FILE_PATH = 'mcd_questions_answers/QuestionsStructure.md';
```

## Architecture

### Question Data Flow

1. `QuestionsStructure.md` is fetched on page load
2. `parseMarkdown()` splits on `### Question N` headers
3. `parseQuestionBlock()` extracts per question: text, images, options, correct answer, explanation
4. Questions stored in `allQuestions[]`; `questions[]` is the working set (may be shuffled)

### Question Markdown Format

```markdown
### Question N

[Question text]

![image.png](uuid-filename.png)

- A. Option text
- B. Option text
- C. Option text
- D. Option text
- **Correct Answer:**

    > LETTER
    >

    [Optional explanation text]

    **Explained**

---
```

- Image-based options use numbered markers (`1.`) before each `![image.png](file.png)`
- The `**Explained**` line is always present — it acts as a section terminator
- Explanation text goes between the `>` answer line and `**Explained**`

### Parser Notes (`parseQuestionBlock`)

- Splits the block at `**Correct Answer:**` into `questionArea` and `answerArea`
- Correct answer regex: `/>\s*([A-Z](?:\s*(?:and|,|&)\s*[A-Z])*)/` — supports multi-answer (`A and C`)
- Text options regex: `/^-\s+([A-Z])\.\s+(.+)$/gm`
- Images are collected **only from before the first text option** to avoid contamination from explanations
- Image classification logic:
  - If text options exist → all images are exhibits (`questionImages`)
  - If no text options + numbered markers (`1.`) → first N images are exhibits, rest are option images
  - If no text options + single image → image is exhibit, generates 4 placeholder option buttons
  - If no text options + multiple images, no markers → first image = exhibit, rest = option images
- Explanation extraction: `answerArea.match(/>\s*\n\s*\n([\s\S]+?)(?=\n---|\n###|$)/)`
  - Falls back to `## Answer:` block format
  - Stripped if shorter than 20 characters
- Fallback question text if none found: `"Question N — Refer to the image(s)"`

### State Management

- Persisted in `localStorage` under key `mcd_app_state`
- `validateState()` sanitizes loaded state (type checks, bounds, format validation) before use
- State includes: `answered` (qId → {selected, correct}), `score`, `currentIndex`, `isShuffled`, `shuffleOrder`, `examHistory`
- `saveState()` / `restoreState()` / `clearSavedData()` handle serialization
- Exam history capped at 20 entries

### Rendering

- **Single render function**: `renderCard()` handles all three modes (study, exam, review)
- `getMode()` returns `'study'` | `'exam'` | `'review'`
- `renderQuestion()` is a backward-compatible alias for `renderCard()`
- **Event delegation**: one `click` listener on `#optionsContainer` handles all option clicks via `handleAnswer(letter)`
- Option states: `.correct` / `.wrong` / `.disabled` (study/review) or `.exam-selected` (exam)

### Modes

**Study Mode** (default)
- Navigate with Previous/Next buttons or touch swipe
- Click an option → immediate feedback (correct/wrong) + explanation shown
- Progress tracked in `answered{}` and `score`

**Exam Mode** (triggered by "Exam Mode" button)
- Configurable question count and time limit
- `examMode` object: `{ questions, answers, startTime, timeLimit, reviewing, result, _autoAdvanceTimer }`
- Auto-advances to next question 400ms after selection (clears previous timer to avoid race conditions)
- No feedback shown during exam; options show `.exam-selected` for current pick (re-selectable)
- Timer: counts up (no limit) or counts down; warning style when < 5 min; auto-submits at 0
- Submit shows confirmation modal if unanswered questions remain
- UI state managed by `enterExamUI()` / `exitExamUI()`

**Exam Review** (after submitting)
- `examMode.reviewing = true`; uses `examMode.result.answers` as answer source
- Shows correct/wrong highlighting same as study mode
- "Back to Results" button (`#btnBackToResults`) returns to score overlay via `backToResults()`
- `< N >` nav arrows (`#navArrowLeft`, `#navArrowRight`) visible during exam and review

### Key UI Components

- **Toolbar**: Shuffle, Reset, All Questions, Exam Mode buttons
- **All Questions Panel**: Side panel — filters (All / Unanswered / Correct / Wrong), search, **Clear Data button at panel footer**
- **Flashcard**: question badge, image(s), question text, option images grid, option buttons, feedback, explanation
- **Nav Bar** (fixed bottom): Previous / `< counter >` / Next; exam adds nav arrows and Back to Results
- **Exam Results overlay**: pass/fail badge, percentage, score bar with pass-mark marker, per-question list

### Server (`server.js`)

- Only allows `GET` and `HEAD` (405 for others)
- Path traversal protection: `path.normalize()` + ROOT boundary check
- Security headers on every response: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Content-Security-Policy`
- Gzip compression for `.html`, `.css`, `.js`, `.json`, `.svg`, `.md` (when client sends `Accept-Encoding: gzip`)
- Cache: 7 days for images, 5 min for HTML/JS/CSS
- Directories return 404 (not directory listing)

### Touch & Keyboard

- Swipe left/right on mobile: threshold 100px horizontal, must exceed 2× vertical movement to avoid triggering on scroll
- Keyboard not explicitly bound beyond browser defaults
