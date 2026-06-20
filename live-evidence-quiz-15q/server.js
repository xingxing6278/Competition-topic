const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const ADMIN_PIN = process.env.ADMIN_PIN || "2468";
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const DB_FILE = path.join(DATA_DIR, "submissions.json");
const QUESTION_FILE = path.join(PUBLIC_DIR, "questions.json");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

const questions = JSON.parse(fs.readFileSync(QUESTION_FILE, "utf8"));
const choiceQuestions = questions.filter((q) => q.type === "choice");
const shortQuestions = questions.filter((q) => q.type === "short");

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify({ submissions: [] }, null, 2));
}

let clients = new Set();

function readDb() {
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

function writeDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function normalizeName(name) {
  return String(name || "").trim().replace(/\s+/g, " ");
}

function scoreChoice(answers) {
  let score = 0;
  for (const question of choiceQuestions) {
    const answer = String(answers[question.id] || "").trim();
    if (answer && answer === question.correctAnswer) score += question.points;
  }
  return score;
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordCount(value) {
  const words = normalizeText(value).match(/[\p{L}\p{N}']+/gu);
  return words ? words.length : 0;
}

function phraseMatches(text, phrase) {
  const normalizedPhrase = normalizeText(phrase);
  if (!normalizedPhrase) return false;
  return text.includes(normalizedPhrase);
}

function scoreShortAnswer(question, answer) {
  const text = normalizeText(answer);
  const words = wordCount(answer);
  let score = 0;

  for (const phrase of question.zeroIfContains || []) {
    if (phraseMatches(text, phrase)) {
      return 0;
    }
  }

  if (words >= 10) score += 1;

  let keywordScore = 0;
  for (const group of question.keywordGroups || []) {
    if (group.some((phrase) => phraseMatches(text, phrase))) {
      keywordScore += 1;
    }
  }

  score += Math.min(3, keywordScore);
  return Math.min(question.points, score);
}

function scoreShort(answers) {
  const byQuestion = {};
  let total = 0;
  for (const question of shortQuestions) {
    const score = scoreShortAnswer(question, answers[question.id]);
    byQuestion[question.id] = score;
    total += score;
  }
  return { total, byQuestion };
}

function withCurrentScores(submission) {
  const answers = submission.answers || {};
  const shortResult = scoreShort(answers);
  return {
    ...submission,
    choiceScore: scoreChoice(answers),
    shortScore: shortResult.total,
    shortScores: shortResult.byQuestion
  };
}

function publicSubmission(submission) {
  const scored = withCurrentScores(submission);
  return {
    id: scored.id,
    name: scored.name,
    choiceScore: scored.choiceScore,
    shortScore: scored.shortScore,
    totalScore: scored.choiceScore + scored.shortScore,
    submittedAt: scored.submittedAt,
    reviewStatus: "Auto scored"
  };
}

function leaderboard() {
  const db = readDb();
  return db.submissions
    .map(publicSubmission)
    .sort((a, b) => {
      if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
      return new Date(a.submittedAt) - new Date(b.submittedAt);
    })
    .map((row, index) => ({ rank: index + 1, ...row }));
}

function broadcast() {
  const payload = `data: ${JSON.stringify({ type: "leaderboard", leaderboard: leaderboard() })}\n\n`;
  for (const res of clients) {
    res.write(payload);
  }
}

function sendJson(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(json);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON."));
      }
    });
  });
}

function isAdmin(req) {
  return req.headers["x-admin-pin"] === ADMIN_PIN;
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/" || pathname === "/leaderboard" || pathname === "/admin") {
    pathname = "/index.html";
  }

  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": [".html", ".js", ".css", ".json"].includes(ext) ? "no-store" : "public, max-age=3600"
    });
    res.end(data);
  });
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/api/leaderboard") {
    return sendJson(res, 200, { leaderboard: leaderboard() });
  }

  if (req.method === "GET" && url.pathname === "/api/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive"
    });
    res.write(`data: ${JSON.stringify({ type: "leaderboard", leaderboard: leaderboard() })}\n\n`);
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/submissions") {
    try {
      const body = await parseBody(req);
      const name = normalizeName(body.name);
      const participantId = String(body.participantId || "").trim();
      const answers = body.answers || {};

      if (name.length < 2 || name.length > 40) {
        return sendJson(res, 400, { error: "Please enter a display name between 2 and 40 characters." });
      }
      const db = readDb();
      const sameName = db.submissions.find((s) => s.name.toLowerCase() === name.toLowerCase());
      if (sameName) return sendJson(res, 409, { error: "This name has already submitted." });

      for (const question of questions) {
        if (typeof answers[question.id] !== "string" || !answers[question.id].trim()) {
          return sendJson(res, 400, { error: `Question ${question.number} is required.` });
        }
      }

      const shortResult = scoreShort(answers);
      const submission = {
        id: crypto.randomUUID(),
        participantId,
        name,
        answers,
        choiceScore: scoreChoice(answers),
        shortScore: shortResult.total,
        shortScores: shortResult.byQuestion,
        submittedAt: new Date().toISOString()
      };

      db.submissions.push(submission);
      writeDb(db);
      broadcast();
      return sendJson(res, 201, { submission: publicSubmission(submission), leaderboard: leaderboard() });
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  if (req.method === "GET" && url.pathname === "/api/admin/submissions") {
    if (!isAdmin(req)) return sendJson(res, 401, { error: "Invalid admin PIN." });
    const db = readDb();
    const rows = db.submissions
      .slice()
      .sort((a, b) => new Date(a.submittedAt) - new Date(b.submittedAt))
      .map((submission) => {
        const scored = withCurrentScores(submission);
        return {
          ...publicSubmission(scored),
          answers: scored.answers,
          shortScores: scored.shortScores || {}
        };
      });
    return sendJson(res, 200, { submissions: rows, shortQuestions });
  }

  if (req.method === "DELETE" && url.pathname === "/api/admin/submissions") {
    if (!isAdmin(req)) return sendJson(res, 401, { error: "Invalid admin PIN." });
    writeDb({ submissions: [] });
    broadcast();
    return sendJson(res, 200, { ok: true, leaderboard: leaderboard() });
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/admin/submissions/")) {
    if (!isAdmin(req)) return sendJson(res, 401, { error: "Invalid admin PIN." });
    const id = url.pathname.split("/").pop();
    const db = readDb();
    const before = db.submissions.length;
    db.submissions = db.submissions.filter((submission) => submission.id !== id);
    if (db.submissions.length === before) return sendJson(res, 404, { error: "Submission not found." });
    writeDb(db);
    broadcast();
    return sendJson(res, 200, { ok: true, leaderboard: leaderboard() });
  }

  return sendJson(res, 404, { error: "Not found." });
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) {
    handleApi(req, res);
  } else {
    serveStatic(req, res);
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Live quiz running at http://localhost:${PORT}`);
  console.log(`Admin PIN: ${ADMIN_PIN}`);
});
