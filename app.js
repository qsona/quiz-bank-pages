const state = {
  manifest: [],
  theme: null,
  questions: [],
  filteredQuestions: [],
  visibleAnswers: new Set(),
  focusedQuestionId: null,
  search: "",
  difficulty: "",
  tag: "",
  sort: "id",
  shuffleSeed: "",
};

const elements = {
  answerAllButton: document.querySelector("#answer-all-button"),
  breadcrumbTheme: document.querySelector("#breadcrumb-theme"),
  clearFiltersButton: document.querySelector("#clear-filters-button"),
  difficultySelect: document.querySelector("#difficulty-select"),
  emptyState: document.querySelector("#empty-state"),
  errorMessage: document.querySelector("#error-message"),
  errorState: document.querySelector("#error-state"),
  pageTitle: document.querySelector("#page-title"),
  quizList: document.querySelector("#quiz-list"),
  resultCount: document.querySelector("#result-count"),
  screenReaderStatus: document.querySelector("#screen-reader-status"),
  searchInput: document.querySelector("#search-input"),
  shuffleButton: document.querySelector("#shuffle-button"),
  sortSelect: document.querySelector("#sort-select"),
  sourceMeta: document.querySelector("#source-meta"),
  statChecked: document.querySelector("#stat-checked"),
  statDifficulty: document.querySelector("#stat-difficulty"),
  statTotal: document.querySelector("#stat-total"),
  tagSelect: document.querySelector("#tag-select"),
  themeSelect: document.querySelector("#theme-select"),
};

const collator = new Intl.Collator("ja", {
  numeric: true,
  sensitivity: "base",
});

function normalize(value) {
  return String(value ?? "").normalize("NFKC").toLocaleLowerCase("ja");
}

function isTypingTarget(target) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement ||
    target?.isContentEditable
  );
}

function formatDate(isoDate) {
  if (!isoDate) return "";
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeZone: "Asia/Tokyo",
  }).format(date);
}

function createElement(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function announce(message) {
  elements.screenReaderStatus.textContent = "";
  window.requestAnimationFrame(() => {
    elements.screenReaderStatus.textContent = message;
  });
}

function getViewStateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const sort = ["id", "difficulty-asc", "difficulty-desc", "shuffle"].includes(params.get("sort"))
    ? params.get("sort")
    : "id";
  return {
    theme: params.get("theme"),
    search: params.get("q") ?? "",
    difficulty: ["1", "2", "3", "4", "5"].includes(params.get("difficulty"))
      ? params.get("difficulty")
      : "",
    tag: params.get("tag") ?? "",
    sort,
    shuffleSeed: sort === "shuffle" ? params.get("seed") ?? "" : "",
  };
}

function setOptionalUrlParam(params, name, value) {
  if (value) {
    params.set(name, value);
  } else {
    params.delete(name);
  }
}

function syncViewStateToUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set("theme", state.theme.id);
  setOptionalUrlParam(url.searchParams, "q", state.search.trim());
  setOptionalUrlParam(url.searchParams, "difficulty", state.difficulty);
  setOptionalUrlParam(url.searchParams, "tag", state.tag);
  setOptionalUrlParam(url.searchParams, "sort", state.sort === "id" ? "" : state.sort);
  setOptionalUrlParam(
    url.searchParams,
    "seed",
    state.sort === "shuffle" ? state.shuffleSeed : ""
  );
  window.history.replaceState({}, "", url);
}

function generateShuffleSeed() {
  const values = new Uint32Array(2);
  window.crypto.getRandomValues(values);
  return `${values[0].toString(36)}${values[1].toString(36)}`;
}

function seedToUint32(seed) {
  let hash = 2166136261;
  for (const character of seed) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededShuffle(items, seed) {
  const shuffled = [...items];
  let randomState = seedToUint32(seed);
  const random = () => {
    randomState += 0x6d2b79f5;
    let value = randomState;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const targetIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[targetIndex]] = [shuffled[targetIndex], shuffled[index]];
  }
  return shuffled;
}

function populateThemeSelect() {
  elements.themeSelect.replaceChildren();
  for (const theme of state.manifest) {
    const option = document.createElement("option");
    option.value = theme.id;
    option.textContent = `${theme.title}（${theme.count}問）`;
    elements.themeSelect.append(option);
  }
  elements.themeSelect.value = state.theme.id;
}

function populateTagSelect() {
  const selectedTag = state.tag;
  const tags = [...new Set(state.questions.flatMap((question) => question.tags ?? []))]
    .sort(collator.compare);

  elements.tagSelect.replaceChildren();
  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = "タグ：すべて";
  elements.tagSelect.append(allOption);

  for (const tag of tags) {
    const option = document.createElement("option");
    option.value = tag;
    option.textContent = `タグ：${tag}`;
    elements.tagSelect.append(option);
  }

  state.tag = tags.includes(selectedTag) ? selectedTag : "";
  elements.tagSelect.value = state.tag;
}

function updateThemeSummary() {
  const difficulties = state.questions
    .map((question) => Number(question.difficulty))
    .filter(Number.isFinite);
  const averageDifficulty = difficulties.length
    ? difficulties.reduce((sum, value) => sum + value, 0) / difficulties.length
    : 0;
  const checkedCount = state.questions.filter((question) =>
    ["checked", "checked_with_note"].includes(question.source_status)
  ).length;
  const checkedRate = state.questions.length
    ? Math.round((checkedCount / state.questions.length) * 100)
    : 0;

  elements.pageTitle.textContent = state.theme.title;
  elements.breadcrumbTheme.textContent = state.theme.id;
  elements.sourceMeta.textContent = `questions.jsonl · ${formatDate(state.theme.updatedAt)} 更新`;
  elements.statTotal.textContent = state.questions.length.toLocaleString("ja-JP");
  elements.statDifficulty.textContent = averageDifficulty.toFixed(1);
  elements.statChecked.textContent = `${checkedRate}%`;
  document.title = `${state.theme.title} | Quiz Bank Browser`;
}

function matchesSearch(question) {
  const query = normalize(state.search.trim());
  if (!query) return true;

  const searchable = [
    question.id,
    question.text,
    question.answer,
    question.display_name,
    ...(question.alt_answers ?? []),
    ...(question.tags ?? []),
  ];

  return searchable.some((value) => normalize(value).includes(query));
}

function compareQuestions(left, right) {
  if (state.sort === "difficulty-asc") {
    return Number(left.difficulty) - Number(right.difficulty) || collator.compare(left.id, right.id);
  }
  if (state.sort === "difficulty-desc") {
    return Number(right.difficulty) - Number(left.difficulty) || collator.compare(left.id, right.id);
  }
  return collator.compare(left.id, right.id);
}

function orderQuestions(questions) {
  if (state.sort === "shuffle") {
    const stableQuestions = [...questions].sort((left, right) => {
      const leftId = String(left.id);
      const rightId = String(right.id);
      return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
    });
    return seededShuffle(stableQuestions, state.shuffleSeed);
  }
  return [...questions].sort(compareQuestions);
}

function updateShuffleControls() {
  const isShuffled = state.sort === "shuffle";
  elements.shuffleButton.textContent = isShuffled ? "再シャッフル" : "シャッフル";
  elements.shuffleButton.title = isShuffled
    ? `現在のseed: ${state.shuffleSeed}`
    : "現在の絞り込み条件を保ったまま順番をシャッフル";
}

function applyFilters() {
  const matchingQuestions = state.questions
    .filter(matchesSearch)
    .filter((question) => !state.difficulty || String(question.difficulty) === state.difficulty)
    .filter((question) => !state.tag || (question.tags ?? []).includes(state.tag));
  state.filteredQuestions = orderQuestions(matchingQuestions);

  if (!state.filteredQuestions.some((question) => question.id === state.focusedQuestionId)) {
    state.focusedQuestionId = null;
  }

  syncViewStateToUrl();
  updateShuffleControls();
  renderQuestions();
}

function detailItem(label, value) {
  const wrapper = createElement("div", "answer-panel__detail");
  const term = createElement("dt", "", label);
  const description = createElement("dd", "", value || "—");
  wrapper.append(term, description);
  return wrapper;
}

function answerPanel(question) {
  const panel = createElement("section", "answer-panel");
  panel.id = `answer-${question.id}`;
  panel.hidden = !state.visibleAnswers.has(question.id);

  const primary = createElement("div", "answer-panel__primary");
  primary.append(
    createElement("span", "answer-panel__label", "ANSWER"),
    createElement("strong", "answer-panel__answer", question.display_name || question.answer)
  );

  if (question.alt_answers?.length) {
    primary.append(
      createElement("span", "answer-panel__alt", `別解：${question.alt_answers.join("、")}`)
    );
  }

  const details = createElement("dl", "answer-panel__details");
  details.append(
    detailItem("難易度の理由", question.difficulty_reason),
    detailItem("確定ポイント", question.confirm_point),
    detailItem("注記", question.note && question.note !== "なし" ? question.note : "なし")
  );

  panel.append(primary, details);
  return panel;
}

function answerToggle(question) {
  const button = createElement("button", "answer-toggle");
  const isVisible = state.visibleAnswers.has(question.id);
  button.type = "button";
  button.dataset.questionId = question.id;
  button.setAttribute("aria-controls", `answer-${question.id}`);
  button.setAttribute("aria-expanded", String(isVisible));
  button.setAttribute("aria-label", `${question.id} の答えを${isVisible ? "隠す" : "表示"}`);
  button.title = isVisible ? "答えを隠す" : "答えを表示";
  button.append(createElement("span", "answer-toggle__icon"));
  return button;
}

function metadataChip(text, modifier = "") {
  return createElement("span", `chip${modifier ? ` ${modifier}` : ""}`, text);
}

function questionCard(question) {
  const isVisible = state.visibleAnswers.has(question.id);
  const card = createElement("article", "quiz-card");
  card.dataset.questionId = question.id;
  card.dataset.answerVisible = String(isVisible);
  card.tabIndex = 0;
  card.setAttribute("aria-labelledby", `question-${question.id}`);

  const main = createElement("div", "quiz-card__main");
  const numericSuffix = question.id.match(/(\d+)$/)?.[1];
  const id = createElement(
    "span",
    "quiz-card__id",
    numericSuffix ? `Q${numericSuffix}` : question.id
  );
  id.title = question.id;
  const text = createElement("p", "quiz-card__question", question.text);
  text.id = `question-${question.id}`;
  main.append(id, text, answerToggle(question));

  const meta = createElement("div", "quiz-card__meta");
  meta.append(metadataChip(`難易度 ${question.difficulty}`, "chip--difficulty"));

  for (const tag of question.tags ?? []) {
    const button = createElement("button", "chip", tag);
    button.type = "button";
    button.dataset.tag = tag;
    button.setAttribute("aria-label", `タグ「${tag}」で絞り込む`);
    meta.append(button);
  }

  const sourceStatus = question.source_status || "未設定";
  const sourceModifier = ["checked", "checked_with_note"].includes(sourceStatus)
    ? "chip--checked"
    : "chip--attention";
  meta.append(metadataChip(`✓ ${sourceStatus}`, sourceModifier));

  const summary = question.note && question.note !== "なし"
    ? question.note
    : question.confirm_point;
  if (summary) {
    const note = createElement("span", "quiz-card__summary-note", summary);
    note.title = summary;
    meta.append(note);
  }

  card.append(main, answerPanel(question), meta);
  return card;
}

function renderQuestions() {
  const fragment = document.createDocumentFragment();
  for (const question of state.filteredQuestions) {
    fragment.append(questionCard(question));
  }
  elements.quizList.replaceChildren(fragment);

  const visibleCount = state.filteredQuestions.length;
  elements.resultCount.textContent =
    `${state.questions.length.toLocaleString("ja-JP")}問中 ` +
    `${visibleCount.toLocaleString("ja-JP")}問を表示`;
  elements.emptyState.hidden = visibleCount !== 0;
  elements.quizList.hidden = visibleCount === 0;
  updateAnswerAllButton();
}

function updateAnswerAllButton() {
  const visibleIds = state.filteredQuestions.map((question) => question.id);
  const allVisible = visibleIds.length > 0 &&
    visibleIds.every((id) => state.visibleAnswers.has(id));
  elements.answerAllButton.textContent = allVisible
    ? "すべての答えを隠す"
    : "すべての答えを表示";
  elements.answerAllButton.dataset.action = allVisible ? "hide" : "show";
  elements.answerAllButton.disabled = visibleIds.length === 0;
}

function updateCardAnswer(questionId, shouldShow, shouldAnnounce = true) {
  if (shouldShow) {
    state.visibleAnswers.add(questionId);
  } else {
    state.visibleAnswers.delete(questionId);
  }

  const card = elements.quizList.querySelector(`[data-question-id="${CSS.escape(questionId)}"]`);
  if (!card) return;

  const panel = card.querySelector(".answer-panel");
  const toggle = card.querySelector(".answer-toggle");
  card.dataset.answerVisible = String(shouldShow);
  panel.hidden = !shouldShow;
  toggle.setAttribute("aria-expanded", String(shouldShow));
  toggle.setAttribute("aria-label", `${questionId} の答えを${shouldShow ? "隠す" : "表示"}`);
  toggle.title = shouldShow ? "答えを隠す" : "答えを表示";
  updateAnswerAllButton();

  if (shouldAnnounce) {
    announce(`${questionId} の答えを${shouldShow ? "表示しました" : "隠しました"}`);
  }
}

function toggleCardAnswer(questionId) {
  updateCardAnswer(questionId, !state.visibleAnswers.has(questionId));
}

function focusQuestionAt(index) {
  const questions = state.filteredQuestions;
  if (!questions.length) return;
  const boundedIndex = Math.max(0, Math.min(index, questions.length - 1));
  const questionId = questions[boundedIndex].id;
  const card = elements.quizList.querySelector(`[data-question-id="${CSS.escape(questionId)}"]`);
  if (!card) return;
  state.focusedQuestionId = questionId;
  card.focus({ preventScroll: true });
  card.scrollIntoView({ behavior: "smooth", block: "center" });
  announce(`${boundedIndex + 1}問目、${questionId}`);
}

function moveQuestionFocus(direction) {
  const currentIndex = state.filteredQuestions.findIndex(
    (question) => question.id === state.focusedQuestionId
  );
  const nextIndex = currentIndex === -1
    ? direction > 0 ? 0 : state.filteredQuestions.length - 1
    : currentIndex + direction;
  focusQuestionAt(nextIndex);
}

async function loadTheme(themeId, viewState = null) {
  const requestedTheme =
    state.manifest.find((theme) => theme.id === themeId) ?? state.manifest[0];
  if (!requestedTheme) throw new Error("公開できるテーマがありません。");

  const response = await fetch(requestedTheme.dataPath);
  if (!response.ok) {
    throw new Error(`${requestedTheme.title} のデータ取得に失敗しました。`);
  }

  const payload = await response.json();
  state.theme = requestedTheme;
  state.questions = Array.isArray(payload.questions) ? payload.questions : [];
  state.visibleAnswers.clear();
  state.focusedQuestionId = null;
  state.search = viewState?.search ?? "";
  state.difficulty = viewState?.difficulty ?? "";
  state.tag = viewState?.tag ?? "";
  state.sort = viewState?.sort ?? "id";
  state.shuffleSeed = state.sort === "shuffle"
    ? viewState?.shuffleSeed || generateShuffleSeed()
    : "";
  elements.searchInput.value = state.search;
  elements.difficultySelect.value = state.difficulty;
  elements.sortSelect.value = state.sort;
  populateThemeSelect();
  populateTagSelect();
  updateThemeSummary();
  applyFilters();
}

async function initialize() {
  try {
    const viewState = getViewStateFromUrl();
    const response = await fetch("./data/index.json");
    if (!response.ok) throw new Error("テーマ一覧の取得に失敗しました。");
    const payload = await response.json();
    state.manifest = Array.isArray(payload.themes) ? payload.themes : [];
    await loadTheme(viewState.theme, viewState);
  } catch (error) {
    elements.quizList.hidden = true;
    elements.emptyState.hidden = true;
    elements.errorState.hidden = false;
    elements.errorMessage.textContent = error instanceof Error
      ? error.message
      : "しばらくしてから再読み込みしてください。";
  }
}

elements.quizList.addEventListener("click", (event) => {
  const toggle = event.target.closest(".answer-toggle");
  if (toggle) {
    toggleCardAnswer(toggle.dataset.questionId);
    toggle.closest(".quiz-card")?.focus();
    return;
  }

  const tagButton = event.target.closest("[data-tag]");
  if (tagButton) {
    state.tag = tagButton.dataset.tag;
    elements.tagSelect.value = state.tag;
    applyFilters();
  }
});

elements.quizList.addEventListener("focusin", (event) => {
  const card = event.target.closest(".quiz-card");
  if (card) state.focusedQuestionId = card.dataset.questionId;
});

elements.searchInput.addEventListener("input", () => {
  state.search = elements.searchInput.value;
  applyFilters();
});

elements.difficultySelect.addEventListener("change", () => {
  state.difficulty = elements.difficultySelect.value;
  applyFilters();
});

elements.tagSelect.addEventListener("change", () => {
  state.tag = elements.tagSelect.value;
  applyFilters();
});

elements.sortSelect.addEventListener("change", () => {
  state.sort = elements.sortSelect.value;
  state.shuffleSeed = state.sort === "shuffle"
    ? state.shuffleSeed || generateShuffleSeed()
    : "";
  applyFilters();
});

elements.shuffleButton.addEventListener("click", () => {
  state.sort = "shuffle";
  state.shuffleSeed = generateShuffleSeed();
  elements.sortSelect.value = state.sort;
  applyFilters();
  announce(`${state.filteredQuestions.length}問をシャッフルしました`);
});

elements.themeSelect.addEventListener("change", async () => {
  try {
    await loadTheme(elements.themeSelect.value);
  } catch (error) {
    elements.errorState.hidden = false;
    elements.errorMessage.textContent = error instanceof Error ? error.message : "読み込みに失敗しました。";
  }
});

elements.answerAllButton.addEventListener("click", () => {
  const shouldShow = elements.answerAllButton.dataset.action !== "hide";
  for (const question of state.filteredQuestions) {
    updateCardAnswer(question.id, shouldShow, false);
  }
  announce(`表示中の${state.filteredQuestions.length}問の答えを${shouldShow ? "表示しました" : "隠しました"}`);
});

elements.clearFiltersButton.addEventListener("click", () => {
  state.search = "";
  state.difficulty = "";
  state.tag = "";
  elements.searchInput.value = "";
  elements.difficultySelect.value = "";
  elements.tagSelect.value = "";
  applyFilters();
  elements.searchInput.focus();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "/" && !isTypingTarget(event.target)) {
    event.preventDefault();
    elements.searchInput.focus();
    return;
  }

  if (event.key === "Escape" && document.activeElement === elements.searchInput) {
    elements.searchInput.blur();
    return;
  }

  if (isTypingTarget(event.target)) return;

  if (event.key === "ArrowDown" || event.key.toLowerCase() === "j") {
    event.preventDefault();
    moveQuestionFocus(1);
    return;
  }

  if (event.key === "ArrowUp" || event.key.toLowerCase() === "k") {
    event.preventDefault();
    moveQuestionFocus(-1);
    return;
  }

  const focusedCard = event.target.closest?.(".quiz-card");
  const questionId = focusedCard?.dataset.questionId ?? state.focusedQuestionId;
  const isCardItself = event.target === focusedCard;
  const isAnswerKey =
    event.key.toLowerCase() === "a" ||
    (isCardItself && (event.key === " " || event.key === "Enter"));
  if (questionId && isAnswerKey) {
    event.preventDefault();
    toggleCardAnswer(questionId);
  }
});

initialize();
