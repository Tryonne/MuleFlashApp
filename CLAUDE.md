# MCD Questions Webapp

MuleSoft Certified Developer (MCD) Level 1 exam flashcard study application.

## Tech Stack

- Vanilla JavaScript (no framework)
- HTML5 + CSS3 (dark theme, responsive)
- Node.js HTTP server (`server.js`) for local development on port 3000

## How to Run

```bash
node server.js
```

Opens at `http://localhost:3000`.

## Key Files

| File | Purpose |
|------|---------|
| `app.js` | Core application logic: markdown parser, question rendering, exam mode, state management, navigation |
| `index.html` | HTML shell with all UI elements, modals, navigation bar |
| `styles.css` | Complete styling (dark theme with CSS variables) |
| `server.js` | Simple Node.js HTTP server with MIME type handling and security checks |
| `mcd_questions_answers/QuestionsStructure.md` | All 160 questions in markdown format |
| `mcd_questions_answers/*.png` | Question/exhibit images (UUID-named PNGs) |

## Architecture

### Question Data Flow

1. `QuestionsStructure.md` is fetched on page load
2. `parseMarkdown()` splits on `### Question N` headers
3. `parseQuestionBlock()` extracts: question text, images, options (`- LETTER. text`), correct answer (`**Correct Answer:** > LETTER`), and optional explanation
4. Questions stored in `allQuestions[]` array; `questions[]` is the working set (may be shuffled)

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

---
```

Image-based options use numbered items (`1.`) with `![image.png](file.png)` instead of `- LETTER. text`.

### State Management

- User progress persisted in `localStorage` under key `mcd_app_state`
- State includes: answered questions, scores, current index, shuffle state, exam history
- `saveState()` / `restoreState()` handle serialization

### Modes

- **Study Mode**: Navigate questions, answer immediately with feedback, see explanations
- **Exam Mode**: Timed practice exam, no feedback until submission, results with pass/fail
- **Exam Review**: After exam submission, review all questions with correct/wrong highlighting; "Back to Results" button returns to score screen

### Key UI Components

- **Toolbar**: Shuffle, Reset, All Questions, Exam Mode
- **All Questions Panel**: Side panel with filters (All/Unanswered/Correct/Wrong), search, and Clear Data button
- **Flashcard**: Question display with images, options, feedback, explanation
- **Nav Bar**: Fixed bottom bar with Previous/Next buttons; exam mode adds `< N >` navigation arrows
- **Exam Results**: Overlay with pass/fail, percentage, breakdown, per-question review list

### Parser Notes

- The parser regex for correct answers is: `**Correct Answer:**[\s\S]*?>\s*([A-Z])`
- Multiple correct answers supported: `> A and C`
- If a question has no text options but has images, the parser generates image-based options automatically
- `## Answer:` blocks inside answer sections are extracted as explanations
