// ===== MCD Flashcard Study App =====

const IMAGE_BASE_PATH = 'mcd_questions_answers/';
const MD_FILE_PATH = 'mcd_questions_answers/QuestionsStructure.md';
const STORAGE_KEY = 'mcd_app_state';
const EXAM_PASS_THRESHOLD = 80; // percentage

// ===== State =====
let allQuestions = [];
let questions = []; // current working set (may be shuffled)
let currentIndex = 0;
let answered = {}; // questionId -> { selected, correct }
let score = { correct: 0, wrong: 0 };
let isShuffled = false;
let panelFilter = 'all';

// ===== Utilities =====
function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function debounce(fn, delay) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
    };
}

// ===== Exam State =====
let examMode = null;
// When active: { questions: [...], answers: {qId: letter}, startTime, timeLimit, currentIndex, reviewing: false }
let examHistory = [];
let examTimerInterval = null;

// ===== Persistence =====
function saveState() {
    const state = {
        version: 1,
        answered,
        score,
        currentIndex,
        isShuffled,
        shuffleOrder: questions.map(q => q.id),
        examHistory,
    };
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
        console.warn('Failed to save state:', e);
    }
}

function loadState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch (e) {
        console.warn('Failed to load state:', e);
        return null;
    }
}

function validateState(state) {
    if (!state || typeof state !== 'object') return null;
    // Validate answered: must be object with numeric keys and {selected, correct} values
    if (state.answered && typeof state.answered === 'object') {
        const clean = {};
        for (const [key, val] of Object.entries(state.answered)) {
            const id = Number(key);
            if (Number.isInteger(id) && id > 0 && val &&
                typeof val.selected === 'string' && /^[A-Z]$/.test(val.selected) &&
                typeof val.correct === 'boolean') {
                clean[id] = { selected: val.selected, correct: val.correct };
            }
        }
        state.answered = clean;
    } else {
        state.answered = null;
    }
    // Validate score
    if (state.score && typeof state.score === 'object') {
        state.score = {
            correct: Math.max(0, Math.floor(Number(state.score.correct) || 0)),
            wrong: Math.max(0, Math.floor(Number(state.score.wrong) || 0)),
        };
    } else {
        state.score = null;
    }
    // Validate currentIndex
    if (typeof state.currentIndex !== 'number' || state.currentIndex < 0) {
        state.currentIndex = 0;
    }
    // Validate shuffleOrder
    if (state.shuffleOrder && !Array.isArray(state.shuffleOrder)) {
        state.shuffleOrder = null;
    }
    // Validate examHistory
    if (!Array.isArray(state.examHistory)) {
        state.examHistory = [];
    }
    return state;
}

function restoreState() {
    const state = validateState(loadState());
    if (!state) return;

    if (state.answered) answered = state.answered;
    if (state.score) score = state.score;
    if (typeof state.currentIndex === 'number') currentIndex = state.currentIndex;
    if (state.isShuffled) {
        isShuffled = true;
        els.btnShuffle.classList.add('active');
        if (state.shuffleOrder && state.shuffleOrder.length > 0) {
            const idMap = new Map(allQuestions.map(q => [q.id, q]));
            const restored = state.shuffleOrder.map(id => idMap.get(id)).filter(Boolean);
            if (restored.length === allQuestions.length) {
                questions = restored;
            }
        }
    }
    if (state.examHistory.length > 0) {
        examHistory = state.examHistory.slice(-20);
    }
    // Ensure currentIndex is in bounds
    if (currentIndex >= questions.length) currentIndex = 0;
}

function clearSavedData() {
    localStorage.removeItem(STORAGE_KEY);
    answered = {};
    score = { correct: 0, wrong: 0 };
    currentIndex = 0;
    isShuffled = false;
    examHistory = [];
    questions = [...allQuestions];
    els.btnShuffle.classList.remove('active');
    renderQuestion();
    scrollToTop();
}

// ===== DOM Elements =====
const els = {};
function initElements() {
    const ids = [
        'loadingScreen', 'flashcard', 'questionBadge', 'questionCategory',
        'questionImageContainer', 'questionImage', 'questionText',
        'optionImagesContainer', 'optionsContainer', 'feedback',
        'feedbackIcon', 'feedbackText', 'explanation',
        'btnPrev', 'btnNext', 'navCounter', 'progressText', 'progressFill',
        'scoreCorrect', 'scoreWrong', 'btnShuffle', 'btnReset', 'btnShowAll',
        'questionPanel', 'panelOverlay', 'panelClose', 'panelList', 'panelSearch',
        // Exam elements
        'btnExamMode', 'examConfigModal', 'examQuestionCount', 'examTimeLimit',
        'btnExamCancel', 'btnExamStart', 'examTimer', 'examTimerText',
        'btnExamSubmit', 'examResults', 'examResultsHeader', 'examResultsScore',
        'examResultsBreakdown', 'examResultsList', 'btnExamReview', 'btnExamClose',
        'examSubmitModal', 'btnSubmitCancel', 'btnSubmitConfirm',
        // Clear data
        'btnClearData', 'clearDataModal', 'btnClearCancel', 'btnClearConfirm',
        // Nav arrows & back to results
        'navArrowLeft', 'navArrowRight', 'btnBackToResults'
    ];
    ids.forEach(id => els[id] = document.getElementById(id));
}

// ===== Markdown Parser =====
function parseMarkdown(md) {
    const questions = [];
    const questionRegex = /###\s*Question\s+(\d+)/g;
    const matches = [...md.matchAll(questionRegex)];

    for (let i = 0; i < matches.length; i++) {
        const match = matches[i];
        const qNum = parseInt(match[1]);
        const startIdx = match.index + match[0].length;
        const endIdx = i + 1 < matches.length ? matches[i + 1].index : md.length;
        const block = md.substring(startIdx, endIdx);

        const question = parseQuestionBlock(block, qNum);
        if (question) {
            questions.push(question);
        }
    }

    return questions;
}

function parseQuestionBlock(block, qNum) {
    // ── 1. Split at answer boundary first ────────────────────────────────
    // Everything before **Correct Answer:** is the question area.
    // Everything after is the answer/explanation area.
    // This prevents images or text in explanations from contaminating question parsing.
    const answerMarkerIdx = block.indexOf('**Correct Answer:**');
    if (answerMarkerIdx === -1) return null;
    const questionArea = block.substring(0, answerMarkerIdx);
    const answerArea   = block.substring(answerMarkerIdx);

    // ── 2. Parse correct answer from answer area only ────────────────────
    const correctMatch = answerArea.match(/>\s*([A-Z](?:\s*(?:and|,|&)\s*[A-Z])*)/);
    if (!correctMatch) return null;
    const correctLetters = correctMatch[1]
        .replace(/\s*(and|,|&)\s*/g, ',').split(',').map(l => l.trim());

    // ── 3. Parse text options from question area ─────────────────────────
    const optionRegex = /^-\s+([A-Z])\.\s+(.+)$/gm;
    const options = [];
    let optMatch;
    while ((optMatch = optionRegex.exec(questionArea)) !== null) {
        options.push({ letter: optMatch[1], text: optMatch[2].trim() });
    }

    // ── 4. Determine the image search boundary ───────────────────────────
    // Images should only come from before the first text option.
    // If there are no text options, all of questionArea is the image search area.
    const firstOptMatch = questionArea.match(/^-\s+[A-Z]\.\s+/m);
    const firstOptPos   = firstOptMatch ? questionArea.indexOf(firstOptMatch[0]) : questionArea.length;
    const imageSearchArea = questionArea.substring(0, firstOptPos);

    // ── 5. Collect images from imageSearchArea only ──────────────────────
    const imageRegex = /!\[.*?\]\(([^)]+)\)/g;
    const images = [];
    let imgMatch;
    while ((imgMatch = imageRegex.exec(imageSearchArea)) !== null) {
        // Strip trailing junk characters (e.g. stray ~ in source)
        const imgPath = imgMatch[1].replace(/[~\s]+$/, '').trim();
        if (/^[a-zA-Z0-9_\-]+\.\w+$/.test(imgPath)) images.push(imgPath);
    }

    // ── 6. Extract question text ─────────────────────────────────────────
    let questionTextArea = imageSearchArea
        .replace(/!\[.*?\]\([^)]+\)/g, '')               // strip image refs
        .replace(/^\s*image\.png\s*$/gm, '')              // strip bare image.png lines
        .replace(/^\s*\*\(Refer to exhibits?.*?\)\*\s*$/gm, '') // strip exhibit notes
        .replace(/^\s*\d+\.\s*$/gm, '')                   // strip standalone numbered markers
        .replace(/^---\s*$/gm, '')                        // strip HR lines
        .trim();
    const exhibitMatch = imageSearchArea.match(/\*\(Refer to exhibits?.*?\)\*/);
    const exhibitText  = exhibitMatch
        ? exhibitMatch[0].replace(/\*/g, '').replace(/[()]/g, '')
        : '';

    // ── 7. Split images into exhibit (questionImages) vs option images ───
    let questionImages = [];
    let optionImages   = [];

    if (options.length > 0) {
        // Text options exist: every image in imageSearchArea is an exhibit diagram
        questionImages = images;
    } else if (images.length > 0) {
        // No text options: detect whether images are exhibits or image-based answer choices
        // Numbered-list markers (standalone "1.") indicate image-based options
        const hasNumberedItems = /^\s*\d+\.\s*$/m.test(imageSearchArea);
        const numberedCount    = (imageSearchArea.match(/^\s*\d+\.\s*$/gm) || []).length;

        if (hasNumberedItems) {
            // Each numbered marker corresponds to one image-option
            const exhibitCount = Math.max(0, images.length - numberedCount);
            questionImages = images.slice(0, exhibitCount);
            optionImages   = images.slice(exhibitCount);
        } else if (images.length === 1) {
            // Single image — the image itself shows all options (Q62-style)
            questionImages = images;
        } else {
            // Multiple images, no markers: first image = exhibit, rest = image options (Q64/Q82/Q86-style)
            questionImages = [images[0]];
            optionImages   = images.slice(1);
        }

        // Generate labeled option buttons for image-based options
        if (optionImages.length > 0) {
            const letters = 'ABCDEFGH';
            for (let i = 0; i < optionImages.length; i++) {
                options.push({
                    letter: letters[i] || String(i + 1),
                    text: `Option ${letters[i] || (i + 1)}`,
                    isImageOption: true
                });
            }
        } else if (images.length === 1) {
            // Single-image question: create placeholder buttons A–D
            const letters = 'ABCDEFGH';
            for (let i = 0; i < 4; i++) {
                options.push({ letter: letters[i], text: `Option ${letters[i]} (see image)`, isImageOption: true });
            }
        }
    }

    // ── 8. Extract explanation from answer area ──────────────────────────
    let explanation = '';
    const explanationMatch = answerArea.match(/>\s*\n\s*\n([\s\S]+?)(?=\n---|\n###|$)/);
    if (explanationMatch) {
        explanation = explanationMatch[1].trim().replace(/^\s{4}/gm, '');
        if (explanation.length < 20) explanation = '';
    }
    if (!explanation) {
        const answerBlockMatch = block.match(/## Answer:\s*\*\*([^*]+)\*\*[\s\S]*?(?=---)/);
        if (answerBlockMatch) {
            const ansBlock = block.substring(block.indexOf(answerBlockMatch[0]));
            const endPos   = ansBlock.indexOf('\n---');
            explanation = (endPos > 0 ? ansBlock.substring(0, endPos) : ansBlock)
                .replace(/^## Answer:.*$/m, '').trim();
        }
    }

    return {
        id: qNum, number: qNum,
        text: questionTextArea || exhibitText || `Question ${qNum} — Refer to the image(s)`,
        options, correctAnswers: correctLetters,
        images: questionImages, optionImages, explanation
    };
}

// ===== Sanitize & Format =====
function sanitize(text) {
    if (!text) return '';
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function formatText(text) {
    if (!text) return '';
    text = sanitize(text);
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
    text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
    text = text.replace(/\n/g, '<br>');
    return text;
}

function formatExplanation(text) {
    if (!text) return '';
    text = sanitize(text);
    text = text.replace(/\|(.+)\|\n\|\s*---[\s|:-]*\|\n([\s\S]*?)(?=\n\n|\n###|$)/g, (match, header, body) => {
        const headers = header.split('|').map(h => h.trim()).filter(Boolean);
        const rows = body.trim().split('\n').map(row => row.split('|').map(c => c.trim()).filter(Boolean));
        let table = '<table><thead><tr>';
        headers.forEach(h => table += `<th>${h}</th>`);
        table += '</tr></thead><tbody>';
        rows.forEach(row => { table += '<tr>'; row.forEach(c => table += `<td>${c}</td>`); table += '</tr>'; });
        table += '</tbody></table>';
        return table;
    });
    text = text.replace(/^###\s+(.+)$/gm, '<strong>$1</strong>');
    text = text.replace(/^##\s+(.+)$/gm, '<strong>$1</strong>');
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/```[\s\S]*?```/g, m => { const code = m.replace(/```\w*\n?/g, '').trim(); return `<code>${code}</code>`; });
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
    text = text.replace(/^>\s*(.+)$/gm, '<em>$1</em>');
    text = text.replace(/^-\s+(.+)$/gm, '• $1');
    text = text.replace(/\n/g, '<br>');
    return text;
}


// ===== Unified Render =====
function getMode() {
    if (examMode && examMode.reviewing) return 'review';
    if (examMode) return 'exam';
    return 'study';
}

function renderCard() {
    const mode = getMode();

    if (mode === 'study' && questions.length === 0) {
        els.questionText.textContent = 'No questions available.';
        return;
    }

    const q = mode === 'study' ? questions[currentIndex] : examMode.questions[currentIndex];

    // Animate card
    els.flashcard.style.animation = 'none';
    requestAnimationFrame(() => { els.flashcard.style.animation = 'fadeIn 0.3s ease'; });

    // Badge
    if (mode === 'exam') {
        const answeredCount = Object.keys(examMode.answers).length;
        els.questionBadge.textContent = `Exam — ${answeredCount}/${examMode.questions.length} answered`;
    } else {
        els.questionBadge.textContent = `Question ${q.number}`;
    }

    // Question images
    if (q.images.length > 0) {
        els.questionImageContainer.style.display = 'block';
        if (q.images.length === 1) {
            els.questionImage.src = IMAGE_BASE_PATH + q.images[0];
            els.questionImage.style.display = 'block';
        } else {
            els.questionImageContainer.innerHTML = q.images.map(img =>
                `<img src="${IMAGE_BASE_PATH}${img}" class="question-image" alt="Question diagram" />`
            ).join('');
        }
    } else {
        els.questionImageContainer.style.display = 'none';
        els.questionImage.src = '';
    }

    els.questionText.innerHTML = formatText(q.text);

    // Option images
    if (q.optionImages.length > 0) {
        els.optionImagesContainer.style.display = 'grid';
        els.optionImagesContainer.innerHTML = q.optionImages.map((img, i) => {
            const letter = 'ABCDEFGH'[i] || String(i + 1);
            return `<div class="option-image-item">
                <div class="option-image-label">Option ${letter}</div>
                <img src="${IMAGE_BASE_PATH}${img}" alt="Option ${letter}" />
            </div>`;
        }).join('');
    } else {
        els.optionImagesContainer.style.display = 'none';
        els.optionImagesContainer.innerHTML = '';
    }

    // Options
    if (mode === 'exam') {
        const selectedLetter = examMode.answers[q.id] || null;
        els.optionsContainer.innerHTML = q.options.map(opt => {
            const classes = 'option-btn' + (selectedLetter === opt.letter ? ' exam-selected' : '');
            return `<button class="${classes}" data-letter="${opt.letter}">
                <span class="option-letter">${opt.letter}</span>
                <span class="option-text">${formatText(opt.text)}</span>
            </button>`;
        }).join('');
    } else {
        const answerSource = mode === 'review' ? examMode.result.answers : answered;
        const isAnswered = answerSource[q.id] !== undefined;

        els.optionsContainer.innerHTML = q.options.map(opt => {
            let classes = 'option-btn';
            if (isAnswered) {
                classes += ' disabled';
                const ans = answerSource[q.id];
                if (q.correctAnswers.includes(opt.letter)) classes += ' correct';
                if (ans.selected === opt.letter && !q.correctAnswers.includes(opt.letter)) classes += ' wrong';
            }
            return `<button class="${classes}" data-letter="${opt.letter}" ${isAnswered ? 'disabled' : ''}>
                <span class="option-letter">${opt.letter}</span>
                <span class="option-text">${formatText(opt.text)}</span>
            </button>`;
        }).join('');
    }

    // Feedback & explanation (hidden during active exam)
    if (mode === 'exam') {
        els.feedback.style.display = 'none';
        els.explanation.style.display = 'none';
    } else {
        const answerSource = mode === 'review' ? examMode.result.answers : answered;
        const isAnswered = answerSource[q.id] !== undefined;
        if (isAnswered) {
            showFeedback(answerSource[q.id].correct);
            if (q.explanation) {
                els.explanation.style.display = 'block';
                els.explanation.innerHTML = formatExplanation(q.explanation);
            } else {
                els.explanation.style.display = 'none';
            }
        } else {
            els.feedback.style.display = 'none';
            els.explanation.style.display = 'none';
        }
    }

    // Nav & progress
    if (mode === 'exam') {
        updateExamNav();
        updateExamProgress();
    } else {
        updateNav();
        if (mode === 'study') updateProgress();
    }
}

// Backward-compatible alias
function renderQuestion() { renderCard(); }

function showFeedback(isCorrect) {
    els.feedback.style.display = 'flex';
    els.feedback.className = `feedback ${isCorrect ? 'correct' : 'wrong'}`;
    els.feedbackIcon.textContent = isCorrect ? '✓' : '✗';
    els.feedbackText.textContent = isCorrect ? 'Correct!' : 'Wrong answer';
}

// ===== Event Handlers =====
function handleAnswer(letter) {
    if (examMode && !examMode.reviewing) {
        handleExamAnswer(letter);
        return;
    }

    const q = questions[currentIndex];
    const isCorrect = q.correctAnswers.includes(letter);
    answered[q.id] = { selected: letter, correct: isCorrect };
    if (isCorrect) score.correct++;
    else score.wrong++;

    saveState();
    renderQuestion();
}

function goNext() {
    const maxIdx = (examMode ? examMode.questions.length : questions.length) - 1;
    if (currentIndex < maxIdx) {
        currentIndex++;
        if (examMode && !examMode.reviewing) examMode.currentIndex = currentIndex;
        renderQuestion();
        scrollToTop();
    }
}

function goPrev() {
    if (currentIndex > 0) {
        currentIndex--;
        if (examMode && !examMode.reviewing) examMode.currentIndex = currentIndex;
        renderQuestion();
        scrollToTop();
    }
}

function shuffleQuestions() {
    if (examMode) return;
    isShuffled = !isShuffled;
    els.btnShuffle.classList.toggle('active', isShuffled);
    questions = isShuffled ? shuffleArray([...allQuestions]) : [...allQuestions];
    currentIndex = 0;
    saveState();
    renderQuestion();
    scrollToTop();
}

function resetSession() {
    if (examMode) return;
    answered = {};
    score = { correct: 0, wrong: 0 };
    currentIndex = 0;
    questions = isShuffled ? shuffleArray([...allQuestions]) : [...allQuestions];
    saveState();
    renderQuestion();
    scrollToTop();
}

// ===== Exam Mode =====
function openExamConfig() {
    if (examMode) return;
    els.examConfigModal.style.display = 'flex';
}

function closeExamConfig() {
    els.examConfigModal.style.display = 'none';
}

function startExam() {
    const countValue = els.examQuestionCount.value;
    const timeLimitMin = parseInt(els.examTimeLimit.value);
    const totalCount = countValue === 'all' ? allQuestions.length : parseInt(countValue);

    // Select random questions
    const examQuestions = shuffleArray([...allQuestions]).slice(0, Math.min(totalCount, allQuestions.length));

    examMode = {
        questions: examQuestions,
        answers: {}, // qId -> letter (just the selected letter during exam)
        startTime: Date.now(),
        timeLimit: timeLimitMin > 0 ? timeLimitMin * 60 * 1000 : 0, // ms, 0 = no limit
        currentIndex: 0,
        reviewing: false,
        result: null
    };

    currentIndex = 0;
    closeExamConfig();
    enterExamUI();
    renderCard();
    startExamTimer();
}

function enterExamUI() {
    document.body.classList.add('exam-active');
    els.examTimer.style.display = 'flex';
    els.btnExamSubmit.style.display = 'flex';
    els.btnNext.style.display = 'none';
    els.navArrowLeft.style.display = '';
    els.navArrowRight.style.display = '';
    updateExamNav();
}

function exitExamUI() {
    document.body.classList.remove('exam-active');
    els.examTimer.style.display = 'none';
    els.btnExamSubmit.style.display = 'none';
    els.btnNext.style.display = 'flex';
    els.navArrowLeft.style.display = 'none';
    els.navArrowRight.style.display = 'none';
    els.btnBackToResults.style.display = 'none';
    stopExamTimer();
}


function handleExamAnswer(letter) {
    const q = examMode.questions[currentIndex];
    examMode.answers[q.id] = letter;
    renderCard();
    // Auto-advance after brief delay so user sees their selection
    if (examMode._autoAdvanceTimer) clearTimeout(examMode._autoAdvanceTimer);
    const maxIdx = examMode.questions.length - 1;
    if (currentIndex < maxIdx) {
        examMode._autoAdvanceTimer = setTimeout(() => {
            if (examMode && !examMode.reviewing) goNext();
        }, 400);
    }
}

function updateExamNav() {
    els.btnPrev.disabled = currentIndex === 0;
    els.navCounter.textContent = `${currentIndex + 1} / ${examMode.questions.length}`;
}

function updateExamProgress() {
    const total = examMode.questions.length;
    const answeredCount = Object.keys(examMode.answers).length;
    const pct = total > 0 ? (answeredCount / total) * 100 : 0;

    els.progressText.textContent = `${answeredCount} / ${total}`;
    els.progressFill.style.width = `${pct}%`;
    els.scoreCorrect.textContent = '';
    els.scoreWrong.textContent = '';
}

// ===== Exam Timer =====
function startExamTimer() {
    updateTimerDisplay();
    examTimerInterval = setInterval(updateTimerDisplay, 1000);
}

function stopExamTimer() {
    if (examTimerInterval) {
        clearInterval(examTimerInterval);
        examTimerInterval = null;
    }
}

function updateTimerDisplay() {
    if (!examMode || examMode.reviewing) { stopExamTimer(); return; }

    if (examMode.timeLimit === 0) {
        // No time limit — show elapsed time
        const elapsed = Math.floor((Date.now() - examMode.startTime) / 1000);
        const min = Math.floor(elapsed / 60);
        const sec = elapsed % 60;
        els.examTimerText.textContent = `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
        els.examTimer.classList.remove('timer-warning');
        return;
    }

    const remaining = Math.max(0, examMode.timeLimit - (Date.now() - examMode.startTime));
    const totalSec = Math.ceil(remaining / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    els.examTimerText.textContent = `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;

    // Warning when under 5 minutes
    els.examTimer.classList.toggle('timer-warning', totalSec <= 300);

    // Auto-submit when time runs out
    if (remaining <= 0) {
        submitExam();
    }
}

// ===== Exam Submission =====
function confirmSubmitExam() {
    const unanswered = examMode.questions.length - Object.keys(examMode.answers).length;
    if (unanswered > 0) {
        // Show confirmation modal
        document.getElementById('submitUnansweredCount').textContent = unanswered;
        els.examSubmitModal.style.display = 'flex';
    } else {
        submitExam();
    }
}

function submitExam() {
    stopExamTimer();
    els.examSubmitModal.style.display = 'none';

    const timeUsed = Date.now() - examMode.startTime;

    // Score all answers
    let correct = 0;
    let wrong = 0;
    const scoredAnswers = {};

    examMode.questions.forEach(q => {
        const selected = examMode.answers[q.id] || null;
        const isCorrect = selected ? q.correctAnswers.includes(selected) : false;
        scoredAnswers[q.id] = { selected: selected || '-', correct: isCorrect };
        if (isCorrect) correct++;
        else wrong++;
    });

    const total = examMode.questions.length;
    const percentage = total > 0 ? Math.round((correct / total) * 100) : 0;
    const passed = percentage >= EXAM_PASS_THRESHOLD;

    const result = {
        id: Date.now(),
        date: new Date().toISOString(),
        totalQuestions: total,
        correct,
        wrong,
        percentage,
        passed,
        timeUsed: Math.floor(timeUsed / 1000),
        timeLimit: examMode.timeLimit > 0 ? Math.floor(examMode.timeLimit / 1000) : 0,
        answers: scoredAnswers,
        questionIds: examMode.questions.map(q => q.id)
    };

    examMode.result = result;

    // Save to history
    examHistory.push(result);
    if (examHistory.length > 20) examHistory = examHistory.slice(-20);
    saveState();

    // Show results
    renderExamResults(result);
}

function renderExamResults(result) {
    exitExamUI();

    // Header — pass/fail
    const passClass = result.passed ? 'exam-pass' : 'exam-fail';
    const passText = result.passed ? 'PASSED' : 'FAILED';
    const passIcon = result.passed ? '✓' : '✗';
    els.examResultsHeader.innerHTML = `
        <div class="exam-result-badge ${passClass}">
            <span class="exam-result-icon">${passIcon}</span>
            <span>${passText}</span>
        </div>
    `;

    // Score
    const timeMin = Math.floor(result.timeUsed / 60);
    const timeSec = result.timeUsed % 60;
    els.examResultsScore.innerHTML = `
        <div class="exam-score-big">${result.percentage}%</div>
        <div class="exam-score-detail">
            ${result.correct} correct out of ${result.totalQuestions} questions
        </div>
    `;

    // Breakdown
    els.examResultsBreakdown.innerHTML = `
        <div class="exam-breakdown-row">
            <div class="exam-breakdown-item correct">
                <span class="exam-breakdown-num">${result.correct}</span>
                <span class="exam-breakdown-label">Correct</span>
            </div>
            <div class="exam-breakdown-item wrong">
                <span class="exam-breakdown-num">${result.wrong}</span>
                <span class="exam-breakdown-label">Wrong</span>
            </div>
            <div class="exam-breakdown-item">
                <span class="exam-breakdown-num">${timeMin}:${String(timeSec).padStart(2, '0')}</span>
                <span class="exam-breakdown-label">Time Used</span>
            </div>
            <div class="exam-breakdown-item">
                <span class="exam-breakdown-num">${EXAM_PASS_THRESHOLD}%</span>
                <span class="exam-breakdown-label">Pass Mark</span>
            </div>
        </div>
        <div class="exam-score-bar-track">
            <div class="exam-score-bar-fill ${passClass}" style="width: ${result.percentage}%"></div>
            <div class="exam-score-bar-marker" style="left: ${EXAM_PASS_THRESHOLD}%"></div>
        </div>
    `;

    // Per-question list
    const idMap = new Map(allQuestions.map(q => [q.id, q]));
    els.examResultsList.innerHTML = result.questionIds.map((qId, i) => {
        const q = idMap.get(qId);
        const ans = result.answers[qId];
        if (!q || !ans) return '';
        const statusClass = ans.correct ? 'status-correct' : 'status-wrong';
        const statusIcon = ans.correct ? '✓' : '✗';
        const preview = q.text.length > 70 ? q.text.substring(0, 70) + '...' : q.text;
        const correctLetter = q.correctAnswers.join(', ');
        return `<div class="exam-result-item ${statusClass}">
            <span class="exam-result-item-num">${i + 1}</span>
            <span class="exam-result-item-text">${sanitize(preview)}</span>
            <span class="exam-result-item-answer">
                ${ans.selected !== '-' ? ans.selected : '—'}${!ans.correct ? ` → ${correctLetter}` : ''}
            </span>
            <span class="exam-result-item-icon">${statusIcon}</span>
        </div>`;
    }).join('');

    els.examResults.style.display = 'flex';
}

function startExamReview() {
    if (!examMode || !examMode.result) return;
    examMode.reviewing = true;
    currentIndex = 0;
    els.examResults.style.display = 'none';

    // Show nav buttons for review
    document.body.classList.add('exam-review');
    els.btnNext.style.display = 'flex';
    els.btnExamSubmit.style.display = 'none';
    els.navArrowLeft.style.display = '';
    els.navArrowRight.style.display = '';
    els.btnBackToResults.style.display = 'flex';

    renderQuestion();
}

function backToResults() {
    if (!examMode || !examMode.result) return;
    examMode.reviewing = false;
    document.body.classList.remove('exam-review');
    els.btnBackToResults.style.display = 'none';
    els.navArrowLeft.style.display = 'none';
    els.navArrowRight.style.display = 'none';
    renderExamResults(examMode.result);
}

function exitExamMode() {
    els.examResults.style.display = 'none';
    examMode = null;
    exitExamUI();
    document.body.classList.remove('exam-review');

    // Restore study mode
    currentIndex = 0;
    renderQuestion();
    updateProgress();
    scrollToTop();
}

// ===== Question List Panel =====
function openPanel() {
    if (examMode && !examMode.reviewing) return; // no panel during active exam
    els.questionPanel.classList.add('open');
    els.panelOverlay.classList.add('open');
    els.btnShowAll.classList.add('active');
    renderPanelList();
    setTimeout(() => {
        const activeItem = els.panelList.querySelector('.panel-item.active');
        if (activeItem) activeItem.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 50);
}

function closePanel() {
    els.questionPanel.classList.remove('open');
    els.panelOverlay.classList.remove('open');
    els.btnShowAll.classList.remove('active');
}

function togglePanel() {
    if (els.questionPanel.classList.contains('open')) closePanel();
    else openPanel();
}

function renderPanelList() {
    const searchTerm = (els.panelSearch?.value || '').toLowerCase();
    let filtered = questions.map((q, idx) => ({ question: q, index: idx }));

    if (panelFilter === 'unanswered') {
        filtered = filtered.filter(item => !answered[item.question.id]);
    } else if (panelFilter === 'correct') {
        filtered = filtered.filter(item => answered[item.question.id]?.correct === true);
    } else if (panelFilter === 'wrong') {
        filtered = filtered.filter(item => answered[item.question.id]?.correct === false);
    }

    if (searchTerm) {
        filtered = filtered.filter(item => {
            const q = item.question;
            return q.text.toLowerCase().includes(searchTerm) ||
                   String(q.number).includes(searchTerm) ||
                   q.options.some(o => o.text.toLowerCase().includes(searchTerm));
        });
    }

    if (filtered.length === 0) {
        els.panelList.innerHTML = '<div class="panel-empty">No questions match your filter.</div>';
        return;
    }

    els.panelList.innerHTML = filtered.map(item => {
        const q = item.question;
        const ans = answered[q.id];
        let statusClass = '';
        let statusIcon = '';
        if (ans) {
            statusClass = ans.correct ? 'status-correct' : 'status-wrong';
            statusIcon = ans.correct ? '✓' : '✗';
        }
        const isActive = item.index === currentIndex;
        const preview = q.text.length > 80 ? q.text.substring(0, 80) + '...' : q.text;
        return `<div class="panel-item ${statusClass} ${isActive ? 'active' : ''}" data-index="${item.index}">
            <span class="panel-item-number">${q.number}</span>
            <span class="panel-item-text">${sanitize(preview)}</span>
            ${statusIcon ? `<span class="panel-item-status">${statusIcon}</span>` : ''}
        </div>`;
    }).join('');
}

function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ===== Update UI =====
function updateNav() {
    const maxIdx = examMode && examMode.reviewing ? examMode.questions.length - 1 : questions.length - 1;
    els.btnPrev.disabled = currentIndex === 0;
    els.btnNext.disabled = currentIndex >= maxIdx;

    if (examMode && examMode.reviewing) {
        els.navCounter.textContent = `Review ${currentIndex + 1} / ${examMode.questions.length}`;
    } else {
        els.navCounter.textContent = `${currentIndex + 1} / ${questions.length}`;
    }
}

function updateProgress() {
    const total = allQuestions.length;
    const answeredCount = Object.keys(answered).length;
    const pct = total > 0 ? (answeredCount / total) * 100 : 0;

    els.progressText.textContent = `${answeredCount} / ${total}`;
    els.progressFill.style.width = `${pct}%`;
    els.scoreCorrect.textContent = `${score.correct} ✓`;
    els.scoreWrong.textContent = `${score.wrong} ✗`;
}

// ===== Image Zoom =====
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('question-image') || e.target.closest('.option-image-item img')) {
        const img = e.target.tagName === 'IMG' ? e.target : e.target.closest('img');
        if (img) img.classList.toggle('zoomed');
    }
});

// ===== Keyboard Navigation =====
document.addEventListener('keydown', (e) => {
    // Close modals/panel on Escape
    if (e.key === 'Escape') {
        if (els.examConfigModal.style.display === 'flex') { closeExamConfig(); return; }
        if (els.examSubmitModal.style.display === 'flex') { els.examSubmitModal.style.display = 'none'; return; }
        if (els.clearDataModal.style.display === 'flex') { els.clearDataModal.style.display = 'none'; return; }
        if (els.examResults.style.display === 'flex') return; // don't close results with Escape
        closePanel();
        return;
    }
    // Don't handle shortcuts if input is focused
    if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'SELECT') return;

    if (e.key === 'ArrowRight' || e.key === 'n') goNext();
    if (e.key === 'ArrowLeft' || e.key === 'p') goPrev();

    // Number/letter keys for options
    const activeQ = examMode && !examMode.reviewing
        ? examMode.questions[currentIndex]
        : (examMode && examMode.reviewing ? examMode.questions[currentIndex] : questions[currentIndex]);

    if (!activeQ) return;

    // In exam review mode, don't allow answering
    if (examMode && examMode.reviewing) return;

    // In study mode, only if not already answered
    const alreadyAnswered = !examMode && answered[activeQ.id];
    if (alreadyAnswered) return;

    if (e.key >= '1' && e.key <= '9') {
        const idx = parseInt(e.key) - 1;
        if (idx < activeQ.options.length) {
            handleAnswer(activeQ.options[idx].letter);
        }
    }
    const letterKeys = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    if (letterKeys.includes(e.key.toLowerCase()) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const letter = e.key.toUpperCase();
        if (activeQ.options.find(o => o.letter === letter)) {
            handleAnswer(letter);
        }
    }
});

// ===== Initialize =====
async function init() {
    initElements();

    // Option click delegation — single listener handles all modes
    els.optionsContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('.option-btn');
        if (!btn || btn.disabled) return;
        handleAnswer(btn.dataset.letter);
    });

    // Bind study mode events
    els.btnNext.addEventListener('click', goNext);
    els.btnPrev.addEventListener('click', goPrev);
    els.btnShuffle.addEventListener('click', shuffleQuestions);
    els.btnReset.addEventListener('click', resetSession);
    els.btnShowAll.addEventListener('click', togglePanel);
    els.panelClose.addEventListener('click', closePanel);
    els.panelOverlay.addEventListener('click', closePanel);
    els.panelSearch.addEventListener('input', debounce(renderPanelList, 200));

    // Panel item clicks — single delegated listener
    els.panelList.addEventListener('click', (e) => {
        const item = e.target.closest('.panel-item');
        if (!item) return;
        currentIndex = parseInt(item.dataset.index);
        renderQuestion();
        closePanel();
        scrollToTop();
    });

    // Panel filter buttons
    document.querySelectorAll('.panel-filter').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.panel-filter').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            panelFilter = btn.dataset.filter;
            renderPanelList();
        });
    });

    // Exam mode events
    els.btnExamMode.addEventListener('click', openExamConfig);
    els.btnExamCancel.addEventListener('click', closeExamConfig);
    els.btnExamStart.addEventListener('click', startExam);
    els.btnExamSubmit.addEventListener('click', confirmSubmitExam);
    els.btnExamReview.addEventListener('click', startExamReview);
    els.btnExamClose.addEventListener('click', exitExamMode);
    els.btnSubmitCancel.addEventListener('click', () => { els.examSubmitModal.style.display = 'none'; });
    els.btnSubmitConfirm.addEventListener('click', submitExam);

    // Nav arrow events
    els.navArrowLeft.addEventListener('click', goPrev);
    els.navArrowRight.addEventListener('click', goNext);
    els.btnBackToResults.addEventListener('click', backToResults);

    // Clear data events
    els.btnClearData.addEventListener('click', () => { els.clearDataModal.style.display = 'flex'; });
    els.btnClearCancel.addEventListener('click', () => { els.clearDataModal.style.display = 'none'; });
    els.btnClearConfirm.addEventListener('click', () => { els.clearDataModal.style.display = 'none'; clearSavedData(); });

    // Touch swipe support
    let touchStartX = 0;
    let touchStartY = 0;
    document.addEventListener('touchstart', (e) => {
        touchStartX = e.changedTouches[0].screenX;
        touchStartY = e.changedTouches[0].screenY;
    }, { passive: true });
    document.addEventListener('touchend', (e) => {
        const diffX = e.changedTouches[0].screenX - touchStartX;
        const diffY = e.changedTouches[0].screenY - touchStartY;
        // Only trigger on horizontal swipes (ignore vertical scrolling)
        if (Math.abs(diffX) > 100 && Math.abs(diffX) > Math.abs(diffY) * 2) {
            if (diffX < 0) goNext(); else goPrev();
        }
    }, { passive: true });

    // Load markdown
    try {
        const response = await fetch(MD_FILE_PATH);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const md = await response.text();
        allQuestions = parseMarkdown(md);
        questions = [...allQuestions];

        if (allQuestions.length === 0) throw new Error('No questions parsed');

        // Restore saved state
        restoreState();

        // Hide loading, render first question
        els.loadingScreen.classList.add('hidden');
        setTimeout(() => els.loadingScreen.style.display = 'none', 300);
        renderQuestion();
    } catch (err) {
        console.error('Failed to load questions:', err);
        els.loadingScreen.innerHTML = `
            <div style="text-align:center; padding: 20px;">
                <p style="color: var(--wrong); font-size: 1.1rem; margin-bottom: 10px;">Failed to load questions</p>
                <p style="color: var(--text-muted); font-size: 0.85rem;">${sanitize(err.message)}</p>
                <p style="color: var(--text-muted); font-size: 0.8rem; margin-top: 16px;">
                    Make sure <code style="background:#222;padding:2px 6px;border-radius:3px;">mcd_questions_answers/QuestionsStructure.md</code> exists in the app directory.
                </p>
            </div>`;
    }
}

document.addEventListener('DOMContentLoaded', init);
