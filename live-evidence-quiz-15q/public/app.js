const state = {
  questions: [],
  leaderboard: [],
  submissions: [],
  shortQuestions: [],
  participantId: localStorage.getItem("participantId") || makeParticipantId(),
  adminPin: localStorage.getItem("adminPin") || ""
};

localStorage.removeItem("hasSubmitted");
localStorage.setItem("participantId", state.participantId);

function makeParticipantId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  window.crypto?.getRandomValues?.(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("") || `${Date.now()}-${Math.random()}`;
}

const views = {
  quiz: document.getElementById("quizView"),
  leaderboard: document.getElementById("leaderboardView"),
  admin: document.getElementById("adminView")
};

const toast = document.getElementById("toast");

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 2600);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function activeViewFromPath() {
  if (location.pathname === "/leaderboard") return "leaderboard";
  if (location.pathname === "/admin") return "admin";
  return location.hash.replace("#", "") || "quiz";
}

function setView(name, push = true) {
  const viewName = views[name] ? name : "quiz";
  for (const [key, el] of Object.entries(views)) {
    el.classList.toggle("active", key === viewName);
  }
  document.querySelectorAll(".nav-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === viewName);
  });
  if (push) {
    if (viewName === "leaderboard") history.pushState(null, "", "/leaderboard");
    else if (viewName === "admin") history.pushState(null, "", "/admin");
    else history.pushState(null, "", "/");
  }
  if (viewName === "admin") loadAdmin();
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}

async function loadQuestions() {
  const response = await fetch("/questions.json", { cache: "no-store" });
  state.questions = await response.json();
}

function renderQuiz() {
  const totalPoints = state.questions.reduce((sum, q) => sum + q.points, 0);
  const autoCount = state.questions.filter((q) => q.type === "choice").length;
  const shortCount = state.questions.filter((q) => q.type === "short").length;
  const scoringNote =
    shortCount > 0
      ? `${autoCount} choice questions and ${shortCount} short-answer questions are scored automatically.`
      : `${autoCount} choice questions are scored automatically.`;

  views.quiz.innerHTML = `
    <div class="hero-row">
      <div class="panel">
        <h2>Enter Your Display Name</h2>
        <p class="helper">You can change your answers before submitting. Each display name can submit once, and this device can submit again with a different name.</p>
        <div class="form-grid">
          <label>
            Display name
            <input id="playerName" maxlength="40" autocomplete="name" placeholder="e.g. Alex Tan" />
          </label>
        </div>
      </div>
      <div class="panel stat-grid" aria-label="Quiz summary">
        <div class="stat"><span>Questions</span><strong>${state.questions.length}</strong></div>
        <div class="stat"><span>Total points</span><strong>${totalPoints}</strong></div>
        <div class="stat"><span>Choice questions</span><strong>${autoCount}</strong></div>
      </div>
    </div>
    <form id="quizForm" class="question-list">
      ${state.questions.map(renderQuestion).join("")}
      <div class="panel">
        <p class="helper">${scoringNote}</p>
        <div class="actions">
          <button class="primary" type="submit">Submit Answers</button>
          <button class="secondary" type="button" id="saveDraft">Save Draft</button>
          <button class="secondary" type="button" data-go="leaderboard">View Leaderboard</button>
        </div>
      </div>
    </form>
  `;

  restoreDraft();
  document.getElementById("saveDraft").addEventListener("click", () => {
    saveDraft();
    showToast("Draft saved on this device.");
  });
  document.getElementById("quizForm").addEventListener("submit", submitQuiz);
}

function renderQuestion(question) {
  const prompt = escapeHtml(question.prompt);
  const image = question.image ? `<img class="question-image" src="${question.image}" alt="Question ${question.number} evidence image" loading="lazy" />` : "";
  const input =
    question.type === "choice"
      ? `<div class="options">${question.options
          .map(
            (option) => `
              <label class="option">
                <input type="radio" name="${question.id}" value="${escapeHtml(option)}" required />
                <span>${escapeHtml(option)}</span>
              </label>`
          )
          .join("")}</div>`
      : `<label>
          Your answer
          <textarea name="${question.id}" required placeholder="Write your answer here."></textarea>
        </label>`;

  return `
    <article class="question">
      ${image}
      <div class="question-body">
        <div class="question-title">
          <span class="question-number">${question.number}</span>
          <p class="question-prompt">${prompt}</p>
        </div>
        ${input}
      </div>
    </article>
  `;
}

function collectAnswers() {
  const form = document.getElementById("quizForm");
  const formData = new FormData(form);
  return Object.fromEntries(state.questions.map((q) => [q.id, String(formData.get(q.id) || "").trim()]));
}

function saveDraft() {
  const name = document.getElementById("playerName")?.value || "";
  const answers = collectAnswers();
  localStorage.setItem("quizDraft", JSON.stringify({ name, answers }));
}

function restoreDraft() {
  const draft = JSON.parse(localStorage.getItem("quizDraft") || "{}");
  if (draft.name) document.getElementById("playerName").value = draft.name;
  for (const [id, value] of Object.entries(draft.answers || {})) {
    const radio = document.querySelector(`input[name="${CSS.escape(id)}"][value="${CSS.escape(value)}"]`);
    const textarea = document.querySelector(`textarea[name="${CSS.escape(id)}"]`);
    if (radio) radio.checked = true;
    if (textarea) textarea.value = value;
  }
}

async function submitQuiz(event) {
  event.preventDefault();
  const name = document.getElementById("playerName").value.trim();
  const answers = collectAnswers();
  try {
    await api("/api/submissions", {
      method: "POST",
      body: JSON.stringify({ participantId: state.participantId, name, answers })
    });
    localStorage.removeItem("quizDraft");
    document.getElementById("quizForm")?.reset();
    document.getElementById("playerName").value = "";
    setView("leaderboard");
    showToast("Submission received.");
  } catch (error) {
    showToast(error.message);
  }
}

function renderLeaderboard() {
  const rows = state.leaderboard;
  views.leaderboard.innerHTML = `
    <div class="leaderboard-shell">
      <div class="leaderboard-head">
        <div>
          <h2>Live Leaderboard</h2>
          <p class="helper">Higher score ranks first. If scores are tied, the earlier submission ranks first.</p>
        </div>
        <span class="live-dot">Live</span>
      </div>
      ${
        rows.length
          ? `<div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Name</th>
                    <th>Total</th>
                    <th>Choice</th>
                    <th>Short Answer</th>
                    <th>Status</th>
                    <th>Submitted</th>
                  </tr>
                </thead>
                <tbody>
                  ${rows
                    .map(
                      (row) => `
                        <tr>
                          <td class="rank">#${row.rank}</td>
                          <td><strong>${escapeHtml(row.name)}</strong></td>
                          <td><strong>${row.totalScore}</strong></td>
                          <td>${row.choiceScore}</td>
                          <td>${row.shortScore}</td>
                          <td><span class="badge ${row.reviewStatus === "Pending review" ? "pending" : ""}">${row.reviewStatus}</span></td>
                          <td>${formatTime(row.submittedAt)}</td>
                        </tr>`
                    )
                    .join("")}
                </tbody>
              </table>
            </div>`
          : `<div class="empty">No submissions yet.</div>`
      }
    </div>
  `;
}

function renderAdmin() {
  views.admin.innerHTML = `
    <div class="panel">
      <h2>Admin Review</h2>
      <p class="helper">Enter the admin PIN to view submitted answers and automatic short-answer scores.</p>
      <div class="form-grid">
        <label>
          Admin PIN
          <input id="adminPin" type="password" value="${escapeHtml(state.adminPin)}" placeholder="Enter PIN" />
        </label>
        <div class="actions">
          <button class="primary" type="button" id="loadAdmin">Load Submissions</button>
          <button class="danger" type="button" id="clearLeaderboard">Clear Leaderboard</button>
        </div>
      </div>
    </div>
    <div id="adminList" class="admin-grid"></div>
  `;
  document.getElementById("loadAdmin").addEventListener("click", loadAdmin);
  document.getElementById("clearLeaderboard").addEventListener("click", clearLeaderboard);
}

async function loadAdmin() {
  if (!views.admin.classList.contains("active")) return;
  const pinInput = document.getElementById("adminPin");
  if (!pinInput) {
    renderAdmin();
    return;
  }
  state.adminPin = pinInput.value.trim();
  if (!state.adminPin) return;
  localStorage.setItem("adminPin", state.adminPin);

  try {
    const data = await api("/api/admin/submissions", {
      headers: { "X-Admin-PIN": state.adminPin }
    });
    state.submissions = data.submissions;
    state.shortQuestions = data.shortQuestions;
    renderAdminList();
  } catch (error) {
    showToast(error.message);
  }
}

function renderAdminList() {
  const container = document.getElementById("adminList");
  if (!container) return;
  if (!state.submissions.length) {
    container.innerHTML = `<div class="empty">No submissions yet.</div>`;
    return;
  }

  container.innerHTML = state.submissions
    .map((submission) => {
      const blocks = state.shortQuestions
        .map((question) => {
          const score = submission.shortScores?.[question.id] ?? 0;
          return `
            <div class="answer-block">
              <p><strong>Q${question.number}.</strong> ${escapeHtml(question.prompt)}</p>
              <p class="helper"><strong>Participant answer:</strong> ${escapeHtml(submission.answers[question.id])}</p>
              <p class="helper"><strong>Ideal answer:</strong> ${escapeHtml(question.idealAnswer)}</p>
              <p><span class="badge">Auto score: ${score}/${question.points}</span></p>
            </div>
          `;
        })
        .join("");

      return `
        <article class="admin-card">
          <div class="admin-card-head">
            <div>
              <h3>${escapeHtml(submission.name)} · ${submission.totalScore} points</h3>
              <p class="helper">Submitted at ${formatTime(submission.submittedAt)} · Choice score ${submission.choiceScore} · Short-answer score ${submission.shortScore}</p>
            </div>
            <button class="danger" type="button" data-delete-submission="${submission.id}">Delete This Participant</button>
          </div>
          ${blocks}
        </article>
      `;
    })
    .join("");

  container.querySelectorAll("[data-delete-submission]").forEach((button) => {
    button.addEventListener("click", () => deleteSubmission(button.dataset.deleteSubmission));
  });
}

async function clearLeaderboard() {
  const pinInput = document.getElementById("adminPin");
  state.adminPin = pinInput?.value.trim() || state.adminPin;
  if (!state.adminPin) {
    showToast("Enter the admin PIN first.");
    return;
  }
  if (!confirm("Clear all submissions and reset the leaderboard?")) return;
  try {
    await api("/api/admin/submissions", {
      method: "DELETE",
      headers: { "X-Admin-PIN": state.adminPin }
    });
    state.submissions = [];
    renderAdminList();
    showToast("Leaderboard cleared.");
  } catch (error) {
    showToast(error.message);
  }
}

async function deleteSubmission(id) {
  if (!confirm("Delete this submission from the leaderboard?")) return;
  try {
    await api(`/api/admin/submissions/${id}`, {
      method: "DELETE",
      headers: { "X-Admin-PIN": state.adminPin }
    });
    showToast("Submission deleted.");
    await loadAdmin();
  } catch (error) {
    showToast(error.message);
  }
}

function setupRealtime() {
  const events = new EventSource("/api/events");
  events.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === "leaderboard") {
      state.leaderboard = data.leaderboard;
      renderLeaderboard();
    }
  };
  events.onerror = () => {
    showToast("Live connection is reconnecting.");
  };
}

document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-view], [data-go]");
  if (!target) return;
  const next = target.dataset.view || target.dataset.go;
  if (next) setView(next);
});

window.addEventListener("popstate", () => setView(activeViewFromPath(), false));

async function init() {
  await loadQuestions();
  renderQuiz();
  renderLeaderboard();
  renderAdmin();
  setupRealtime();
  setView(activeViewFromPath(), false);
}

init().catch((error) => {
  document.body.innerHTML = `<main><div class="panel"><h1>Unable to start</h1><p>${escapeHtml(error.message)}</p></div></main>`;
});
