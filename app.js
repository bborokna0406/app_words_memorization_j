// 이 키는 앱 업데이트 후에도 기존 단어를 유지하기 위해 변경하지 않습니다.
const STORAGE_KEY = "japanese-words-memorization-v1";
const APP_VERSION = "2026.06.30.1";

let wordStore = null;
const duplicateIndexes = {};

const state = {
  words: [],
  editingId: null,
  currentQuestion: null,
  studyQueue: [],
  completedCycles: 0,
  cycleComplete: false,
  sortMode: "newest",
};

const icons = {
  save: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8M7 3v5h8"/></svg>`,
  edit: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`,
  play: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7V5Z"/></svg>`,
  next: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>`,
};

const fields = [
  { key: "word", label: "단어" },
  { key: "pronunciation", label: "발음" },
  { key: "meaning", label: "뜻" },
];

const elements = {
  summaryText: document.querySelector("#summaryText"),
  appVersion: document.querySelector("#appVersion"),
  wordForm: document.querySelector("#wordForm"),
  wordInput: document.querySelector("#wordInput"),
  meaningInput: document.querySelector("#meaningInput"),
  pronunciationInput: document.querySelector("#pronunciationInput"),
  exampleInput: document.querySelector("#exampleInput"),
  wordDuplicate: document.querySelector("#wordDuplicate"),
  pronunciationDuplicate: document.querySelector("#pronunciationDuplicate"),
  meaningDuplicate: document.querySelector("#meaningDuplicate"),
  saveButton: document.querySelector("#saveButton"),
  cancelEditButton: document.querySelector("#cancelEditButton"),
  editBadge: document.querySelector("#editBadge"),
  wordList: document.querySelector("#wordList"),
  emptyText: document.querySelector("#emptyText"),
  searchInput: document.querySelector("#searchInput"),
  sortSelect: document.querySelector("#sortSelect"),
  studyButton: document.querySelector("#studyButton"),
  answerButton: document.querySelector("#answerButton"),
  quizLabel: document.querySelector("#quizLabel"),
  quizText: document.querySelector("#quizText"),
  answerBlock: document.querySelector("#answerBlock"),
  studyModeText: document.querySelector("#studyModeText"),
  exportButton: document.querySelector("#exportButton"),
  importButton: document.querySelector("#importButton"),
  fileInput: document.querySelector("#fileInput"),
  toast: document.querySelector("#toast"),
};

function createId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeForComparison(value) {
  return normalizeText(value).normalize("NFKC").replace(/\s+/g, " ").toLocaleLowerCase();
}

function normalizeWordItem(item) {
  return {
    id: item.id || createId(),
    word: normalizeText(item.word),
    pronunciation: normalizeText(item.pronunciation),
    meaning: normalizeText(item.meaning),
    example: normalizeText(item.example),
    createdAt: Number(item.createdAt) || Date.now(),
  };
}

function isCompleteWord(item) {
  return item.word && item.meaning && item.pronunciation;
}

function duplicateFields() {
  return [
    { key: "word", input: elements.wordInput, message: elements.wordDuplicate },
    { key: "pronunciation", input: elements.pronunciationInput, message: elements.pronunciationDuplicate },
    { key: "meaning", input: elements.meaningInput, message: elements.meaningDuplicate },
  ];
}

function rebuildDuplicateIndexes() {
  duplicateFields().forEach(({ key }) => {
    const index = new Map();
    state.words.forEach((item) => {
      const value = normalizeForComparison(item[key]);
      if (!value) return;
      if (!index.has(value)) index.set(value, new Set());
      index.get(value).add(item.id);
    });
    duplicateIndexes[key] = index;
  });
}

function updateDuplicateWarnings() {
  duplicateFields().forEach(({ key, input, message }) => {
    const value = normalizeForComparison(input.value);
    const ids = duplicateIndexes[key]?.get(value);
    const isDuplicate = Boolean(value && ids && Array.from(ids).some((id) => id !== state.editingId));
    input.classList.toggle("is-duplicate", isDuplicate);
    message.hidden = !isDuplicate;
    if (isDuplicate) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
  });
}

async function loadWords() {
  wordStore = createWordStore({
    storageKey: STORAGE_KEY,
    normalizeItem: normalizeWordItem,
    isValidItem: isCompleteWord,
    normalizeForComparison,
    indexFields: ["word", "pronunciation", "meaning"],
  });
  const result = await wordStore.initialize();
  state.words = result.words;
  rebuildDuplicateIndexes();
  if (result.migrated) showToast("기존 단어를 안전하게 이전했습니다.");
}

async function saveWords() {
  await wordStore.requestPersistence();
  await wordStore.replaceAll(state.words);
  rebuildDuplicateIndexes();
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");

  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    elements.toast.classList.remove("show");
  }, 1800);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderSummary() {
  elements.summaryText.textContent = `저장된 일본어 단어 ${state.words.length}개`;
  elements.appVersion.textContent = `버전 ${APP_VERSION}`;
}

function renderList() {
  const query = normalizeText(elements.searchInput.value).toLowerCase();
  const filteredWords = state.words.filter((item) => {
    return fields.some(({ key }) => item[key].toLowerCase().includes(query))
      || item.example.toLowerCase().includes(query);
  });

  if (state.sortMode === "pronunciation") {
    const collator = new Intl.Collator(["ja", "ko"], { sensitivity: "base", numeric: true });
    filteredWords.sort((a, b) => {
      return collator.compare(a.pronunciation, b.pronunciation)
        || collator.compare(a.word, b.word);
    });
  }

  elements.wordList.innerHTML = filteredWords.map((item) => `
    <li class="word-item" data-id="${escapeHtml(item.id)}">
      <div class="word-main">
        <strong>${escapeHtml(item.word)}</strong>
        <span class="word-pronunciation">${escapeHtml(item.pronunciation)}</span>
        <span>${escapeHtml(item.meaning)}</span>
        ${item.example ? `<span class="word-example">${escapeHtml(item.example)}</span>` : ""}
      </div>
      <div class="item-actions">
        <button type="button" data-action="edit" title="수정" aria-label="${escapeHtml(item.word)} 수정">
          ${icons.edit}
        </button>
        <button class="delete-button" type="button" data-action="delete" title="삭제" aria-label="${escapeHtml(item.word)} 삭제">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5M14 11v5"/></svg>
        </button>
      </div>
    </li>
  `).join("");

  elements.emptyText.hidden = filteredWords.length > 0;
  elements.emptyText.textContent = state.words.length === 0
    ? "아직 저장된 일본어 단어가 없습니다."
    : "검색 결과가 없습니다.";
}

function renderStudyControls() {
  const hasWords = state.words.length > 0;
  elements.studyButton.disabled = !hasWords;
  elements.answerButton.disabled = !state.currentQuestion;

  if (!hasWords) {
    elements.quizLabel.textContent = "문제";
    elements.quizText.textContent = "일본어 단어를 추가하면 바로 학습할 수 있습니다.";
    elements.answerBlock.hidden = true;
    elements.answerBlock.innerHTML = "";
    elements.studyModeText.textContent = "준비됨";
    elements.studyButton.innerHTML = `${icons.play}시작`;
    return;
  }

  if (state.cycleComplete) {
    elements.quizLabel.textContent = `${state.completedCycles}회독 완료`;
    elements.quizText.textContent = "목록의 모든 단어를 한 번씩 확인했습니다. 계속 학습할까요?";
    elements.answerBlock.hidden = true;
    elements.answerBlock.innerHTML = "";
    elements.studyModeText.textContent = `${state.completedCycles}회독 완료`;
    elements.studyButton.innerHTML = `${icons.next}다음`;
    return;
  }

  if (!state.currentQuestion) {
    elements.quizLabel.textContent = "문제";
    elements.quizText.textContent = "시작을 누르면 단어, 뜻, 발음 중 하나가 무작위로 나옵니다.";
    elements.answerBlock.hidden = true;
    elements.answerBlock.innerHTML = "";
    elements.studyModeText.textContent = "대기 중";
    elements.studyButton.innerHTML = `${icons.play}시작`;
  }
}

function resetStudySession() {
  state.currentQuestion = null;
  state.studyQueue = [];
  state.completedCycles = 0;
  state.cycleComplete = false;
}

function createShuffledStudyQueue() {
  const queue = state.words.map((item) => item.id);

  for (let index = queue.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [queue[index], queue[randomIndex]] = [queue[randomIndex], queue[index]];
  }

  return queue;
}

function render() {
  renderSummary();
  renderList();
  renderStudyControls();
}

function clearForm() {
  state.editingId = null;
  elements.wordInput.value = "";
  elements.meaningInput.value = "";
  elements.pronunciationInput.value = "";
  elements.exampleInput.value = "";
  elements.editBadge.hidden = true;
  elements.cancelEditButton.hidden = true;
  elements.saveButton.innerHTML = `${icons.save}저장`;
  updateDuplicateWarnings();
}

async function upsertWord(event) {
  event.preventDefault();

  let word = normalizeText(elements.wordInput.value);
  const meaning = normalizeText(elements.meaningInput.value);
  let pronunciation = normalizeText(elements.pronunciationInput.value);
  const example = normalizeText(elements.exampleInput.value);

  if (!word && !pronunciation) {
    showToast("단어 또는 발음을 입력하세요.");
    return;
  }

  if (!meaning) {
    showToast("뜻을 입력하세요.");
    return;
  }

  if (!word) {
    word = pronunciation;
    elements.wordInput.value = word;
  }

  if (!pronunciation) {
    pronunciation = word;
    elements.pronunciationInput.value = pronunciation;
  }

  const duplicate = state.words.find((item) => {
    return normalizeForComparison(item.word) === normalizeForComparison(word)
      && item.id !== state.editingId;
  });

  const previousWords = state.words.map((item) => ({ ...item }));
  let successMessage = "일본어 단어를 저장했습니다.";

  if (duplicate) {
    duplicate.meaning = meaning;
    duplicate.pronunciation = pronunciation;
    duplicate.example = example;
    successMessage = "이미 있는 단어의 뜻과 발음을 수정했습니다.";
  } else if (state.editingId) {
    const target = state.words.find((item) => item.id === state.editingId);
    if (target) {
      target.word = word;
      target.meaning = meaning;
      target.pronunciation = pronunciation;
      target.example = example;
      successMessage = "단어를 수정했습니다.";
    }
  } else {
    state.words.unshift({ id: createId(), word, pronunciation, meaning, example, createdAt: Date.now() });
  }

  try {
    await saveWords();
  } catch {
    state.words = previousWords;
    rebuildDuplicateIndexes();
    showToast("저장하지 못했습니다. 저장공간을 확인하세요.");
    return;
  }
  resetStudySession();
  clearForm();
  render();
  showToast(successMessage);
}

function editWord(id) {
  const target = state.words.find((item) => item.id === id);
  if (!target) {
    return;
  }

  state.editingId = id;
  elements.wordInput.value = target.word;
  elements.meaningInput.value = target.meaning;
  elements.pronunciationInput.value = target.pronunciation;
  elements.exampleInput.value = target.example || "";
  elements.editBadge.hidden = false;
  elements.cancelEditButton.hidden = false;
  elements.saveButton.innerHTML = `${icons.edit}수정`;
  updateDuplicateWarnings();
  elements.wordInput.focus();
}

async function deleteWord(id) {
  const target = state.words.find((item) => item.id === id);
  if (!target) {
    return;
  }

  const confirmed = confirm(`'${target.word}' 단어를 삭제할까요?`);
  if (!confirmed) {
    return;
  }

  const previousWords = state.words;
  state.words = state.words.filter((item) => item.id !== id);
  resetStudySession();

  try {
    await saveWords();
  } catch {
    state.words = previousWords;
    rebuildDuplicateIndexes();
    showToast("삭제 내용을 저장하지 못했습니다.");
    return;
  }
  clearForm();
  render();
  showToast("단어를 삭제했습니다.");
}

function pickQuestion() {
  if (state.words.length === 0) {
    return;
  }

  if (state.currentQuestion && state.studyQueue.length === 0) {
    state.completedCycles += 1;
    state.currentQuestion = null;
    state.cycleComplete = true;
    renderStudyControls();
    return;
  }

  if (state.cycleComplete || (!state.currentQuestion && state.studyQueue.length === 0)) {
    state.studyQueue = createShuffledStudyQueue();
    state.cycleComplete = false;
  }

  const nextId = state.studyQueue.shift();
  const item = state.words.find((word) => word.id === nextId);
  if (!item) {
    resetStudySession();
    renderStudyControls();
    return;
  }

  const questionField = fields[Math.floor(Math.random() * fields.length)];
  const answerFields = fields.filter((field) => field.key !== questionField.key);
  const answers = answerFields.map((field) => ({
    label: field.label,
    value: item[field.key],
  }));

  if (item.example) {
    answers.push({
      label: "\uC608\uBB38",
      value: item.example,
    });
  }

  state.currentQuestion = {
    id: item.id,
    prompt: item[questionField.key],
    label: `${questionField.label}을 보고 맞혀보세요`,
    answers,
  };

  elements.quizLabel.textContent = state.currentQuestion.label;
  elements.quizText.textContent = state.currentQuestion.prompt;
  elements.answerBlock.hidden = true;
  elements.answerBlock.innerHTML = "";
  elements.studyModeText.textContent = `${state.completedCycles + 1}회독 중`;
  elements.studyButton.innerHTML = `${icons.next}다음`;
  elements.answerButton.disabled = false;
}

function showAnswer() {
  if (!state.currentQuestion) {
    return;
  }

  elements.answerBlock.innerHTML = state.currentQuestion.answers.map((answer) => `
    <p class="answer-line">${escapeHtml(answer.label)}: ${escapeHtml(answer.value)}</p>
  `).join("");
  elements.answerBlock.hidden = false;
}

function exportWords() {
  const data = {
    app: "japanese-words-memorization",
    exportedAt: new Date().toISOString(),
    words: state.words,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = "japanese-words-backup.json";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast("백업 파일을 만들었습니다.");
}

function importWords(file) {
  const reader = new FileReader();

  reader.addEventListener("load", async () => {
    try {
      const parsed = JSON.parse(String(reader.result));
      const sourceWords = Array.isArray(parsed) ? parsed : parsed.words;

      if (!Array.isArray(sourceWords)) {
        throw new Error("Invalid backup");
      }

      const imported = sourceWords.map(normalizeWordItem).filter(isCompleteWord);
      const byWord = new Map(state.words.map((item) => [item.word, item]));
      imported.forEach((item) => byWord.set(item.word, item));
      state.words = Array.from(byWord.values());

      await saveWords();
      resetStudySession();
      render();
      showToast(`${imported.length}개 단어를 가져왔습니다.`);
    } catch {
      showToast("가져올 수 없는 파일입니다.");
    }
  });

  reader.readAsText(file);
}

function handleListClick(event) {
  const button = event.target.closest("button");
  const item = event.target.closest(".word-item");
  if (!button || !item) {
    return;
  }

  const action = button.dataset.action;
  const id = item.dataset.id;

  if (action === "edit") {
    editWord(id);
  }

  if (action === "delete") {
    deleteWord(id);
  }
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") {
    return;
  }

  const alreadyInstalled = Boolean(navigator.serviceWorker.controller);
  let reloading = false;

  const reloadWithNewVersion = () => {
    if (reloading) return;
    reloading = true;
    showToast("새 버전을 적용합니다.");
    setTimeout(() => location.reload(), 350);
  };

  const checkVersion = async () => {
    try {
      const response = await fetch(`./version.json?t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) return;
      const remote = await response.json();
      if (remote.version && remote.version !== APP_VERSION) {
        reloadWithNewVersion();
      }
    } catch {
      // 오프라인에서는 현재 캐시 버전을 계속 사용합니다.
    }
  };

  if (alreadyInstalled) {
    navigator.serviceWorker.addEventListener("controllerchange", reloadWithNewVersion);
  }

  navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" })
    .then((registration) => {
      const checkForUpdate = () => {
        registration.update().catch(() => {});
        checkVersion();
      };

      checkForUpdate();
      window.addEventListener("focus", checkForUpdate);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
          checkForUpdate();
        }
      });
    })
    .catch(() => {});
}

elements.wordForm.addEventListener("submit", upsertWord);
elements.wordInput.addEventListener("input", updateDuplicateWarnings);
elements.pronunciationInput.addEventListener("input", updateDuplicateWarnings);
elements.meaningInput.addEventListener("input", updateDuplicateWarnings);
elements.cancelEditButton.addEventListener("click", () => {
  clearForm();
  showToast("수정을 취소했습니다.");
});
elements.wordList.addEventListener("click", handleListClick);
elements.searchInput.addEventListener("input", renderList);
elements.sortSelect.addEventListener("change", () => {
  state.sortMode = elements.sortSelect.value;
  renderList();
});
elements.studyButton.addEventListener("click", pickQuestion);
elements.answerButton.addEventListener("click", showAnswer);
elements.exportButton.addEventListener("click", exportWords);
elements.importButton.addEventListener("click", () => elements.fileInput.click());
elements.fileInput.addEventListener("change", () => {
  const [file] = elements.fileInput.files;
  if (file) {
    importWords(file);
  }
  elements.fileInput.value = "";
});

async function initializeApp() {
  elements.saveButton.disabled = true;
  await loadWords();
  updateDuplicateWarnings();
  render();
  registerServiceWorker();
  elements.saveButton.disabled = false;
}

initializeApp();
