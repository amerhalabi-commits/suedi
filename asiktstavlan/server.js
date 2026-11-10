import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { dirname, join, extname, normalize as normPath } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { moderate } from "./moderation.js";

// ---------- Inställningar (miljövariabler) ----------
const PORT = Number(process.env.PORT || 3000);
const DB_PATH = process.env.DB_PATH || "./data/tavlan.db";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const QUESTION = process.env.BOARD_QUESTION || "Vad tycker du?";
const MAX_AGE_DAYS = 30;
const MAX_TEXT = 280;
const MAX_ALIAS = 30;
const REPORTS_TO_HIDE = 3;
const POST_COOLDOWN_MS = 30_000;
const POSTS_PER_DAY = 20;

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, "public");

// ---------- Databas ----------
mkdirSync(dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    alias TEXT NOT NULL,
    text TEXT NOT NULL,
    color INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('approved','pending','rejected')),
    reason TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS posts_status ON posts(status, created_at);
  CREATE TABLE IF NOT EXISTS likes (
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    voter TEXT NOT NULL,
    PRIMARY KEY (post_id, voter)
  );
  CREATE TABLE IF NOT EXISTS reports (
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    voter TEXT NOT NULL,
    PRIMARY KEY (post_id, voter)
  );
`);

const q = {
  publicPosts: db.prepare(`
    SELECT p.id, p.alias, p.text, p.color, p.created_at AS createdAt,
      (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS likes,
      EXISTS(SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.voter = ?) AS liked
    FROM posts p WHERE p.status = 'approved' AND p.created_at > ?
    ORDER BY likes DESC, p.created_at DESC LIMIT 500`),
  adminPosts: db.prepare(`
    SELECT p.id, p.alias, p.text, p.status, p.reason, p.created_at AS createdAt,
      (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS likes,
      (SELECT COUNT(*) FROM reports r WHERE r.post_id = p.id) AS reports
    FROM posts p WHERE p.status = ? ORDER BY p.created_at DESC LIMIT 500`),
  counts: db.prepare(`SELECT status, COUNT(*) AS n FROM posts GROUP BY status`),
  insert: db.prepare(`INSERT INTO posts (alias, text, color, status, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)`),
  get: db.prepare(`SELECT * FROM posts WHERE id = ?`),
  setStatus: db.prepare(`UPDATE posts SET status = ?, reason = ? WHERE id = ?`),
  del: db.prepare(`DELETE FROM posts WHERE id = ?`),
  hasLike: db.prepare(`SELECT 1 FROM likes WHERE post_id = ? AND voter = ?`),
  addLike: db.prepare(`INSERT OR IGNORE INTO likes (post_id, voter) VALUES (?, ?)`),
  delLike: db.prepare(`DELETE FROM likes WHERE post_id = ? AND voter = ?`),
  likeCount: db.prepare(`SELECT COUNT(*) AS n FROM likes WHERE post_id = ?`),
  addReport: db.prepare(`INSERT OR IGNORE INTO reports (post_id, voter) VALUES (?, ?)`),
  reportCount: db.prepare(`SELECT COUNT(*) AS n FROM reports WHERE post_id = ?`),
  clearReports: db.prepare(`DELETE FROM reports WHERE post_id = ?`),
  expire: db.prepare(`DELETE FROM posts WHERE created_at <= ?`),
};

const cutoff = () => Date.now() - MAX_AGE_DAYS * 24 * 3600 * 1000;
function expireOld() {
  const r = q.expire.run(cutoff());
  if (r.changes) console.log(`Rensade ${r.changes} inlägg äldre än ${MAX_AGE_DAYS} dagar`);
}
expireOld();
setInterval(expireOld, 60 * 60 * 1000).unref();

// ---------- Hjälpfunktioner ----------
function clientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (xff) return String(xff).split(",").pop().trim();
  return req.socket.remoteAddress || "okänd";
}
const hash = (s) => createHash("sha256").update(s).digest("hex").slice(0, 24);

function getCookie(req, name) {
  const m = (req.headers.cookie || "").match(new RegExp("(?:^|;\\s*)" + name + "=([a-f0-9]{32})"));
  return m ? m[1] : null;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 8192) throw new Error("för stor");
    chunks.push(c);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return {}; }
}

function clean(s, max) {
  return String(s ?? "")
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F​-‏‪-‮⁦-⁩]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

// Enkla minnesbaserade hastighetsgränser
const buckets = new Map();
function limit(key, max, windowMs) {
  const now = Date.now();
  const arr = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { buckets.set(key, arr); return false; }
  arr.push(now);
  buckets.set(key, arr);
  return true;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, arr] of buckets) if (!arr.some((t) => now - t < 86_400_000)) buckets.delete(k);
}, 600_000).unref();

function isAdmin(req, ip) {
  if (!ADMIN_PASSWORD) return false;
  const h = String(req.headers.authorization || "");
  const given = Buffer.from(h.startsWith("Bearer ") ? h.slice(7) : "");
  const want = Buffer.from(ADMIN_PASSWORD);
  const ok = given.length === want.length && timingSafeEqual(given, want);
  if (!ok) limit("adminfail:" + ip, 1e9, 900_000);
  return ok;
}
function adminLocked(ip) {
  const arr = (buckets.get("adminfail:" + ip) || []).filter((t) => Date.now() - t < 900_000);
  return arr.length >= 10;
}

// ---------- Statiska filer ----------
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".png": "image/png" };
const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "content-security-policy": "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

async function serveStatic(req, res, pathname) {
  if (pathname === "/") pathname = "/index.html";
  if (pathname === "/admin") pathname = "/admin.html";
  const file = normPath(join(PUBLIC, pathname));
  if (!file.startsWith(PUBLIC)) return send(res, 404, { error: "Hittades inte" });
  try {
    const data = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "cache-control": "no-cache", ...SECURITY_HEADERS });
    res.end(data);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Sidan finns inte");
  }
}

// ---------- API ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const path = url.pathname;
  const ip = clientIp(req);

  // Anonym besökar-id i cookie (för likes/anmälningar)
  let vid = getCookie(req, "vid");
  const setCookie = {};
  if (!vid) {
    vid = randomBytes(16).toString("hex");
    const secure = req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
    setCookie["set-cookie"] = `vid=${vid}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${secure}`;
  }
  const out = (status, body) => send(res, status, body, { ...setCookie, ...SECURITY_HEADERS });

  try {
    if (!path.startsWith("/api/")) {
      if (req.method !== "GET" && req.method !== "HEAD") return out(405, { error: "Ej tillåtet" });
      return serveStatic(req, res, path);
    }
    if (!limit("api:" + ip, 300, 60_000)) return out(429, { error: "För många förfrågningar, vänta en stund." });

    if (req.method === "GET" && path === "/api/config") {
      return out(200, { question: QUESTION, maxText: MAX_TEXT, maxAlias: MAX_ALIAS, maxAgeDays: MAX_AGE_DAYS });
    }

    if (req.method === "GET" && path === "/api/posts") {
      const rows = q.publicPosts.all(vid, cutoff()).map((r) => ({ ...r, liked: !!r.liked }));
      return out(200, { posts: rows });
    }

    if (req.method === "POST" && path === "/api/posts") {
      const body = await readJson(req);
      const alias = clean(body.alias, MAX_ALIAS).replace(/\s+/g, " ") || "Anonym";
      const text = clean(body.text, MAX_TEXT + 1);
      if (text.length < 2) return out(400, { error: "Skriv minst två tecken." });
      if (text.length > MAX_TEXT) return out(400, { error: `Max ${MAX_TEXT} tecken.` });
      if (!limit("postday:" + ip, POSTS_PER_DAY, 86_400_000)) return out(429, { error: "Du har skrivit många inlägg idag. Kom tillbaka imorgon!" });
      if (!limit("post:" + ip, 1, POST_COOLDOWN_MS)) return out(429, { error: "Vänta en halv minut mellan inläggen." });

      const verdict = await moderate(alias, text);
      const status = verdict.decision === "ok" ? "approved" : "pending";
      const color = Math.floor(Math.random() * 8);
      q.insert.run(alias, text, color, status, verdict.reason, Date.now());
      return out(201, {
        status,
        message: status === "approved"
          ? "Ditt inlägg är publicerat!"
          : "Tack! Ditt inlägg granskas av en moderator innan det visas.",
      });
    }

    let m = path.match(/^\/api\/posts\/(\d+)\/(like|report)$/);
    if (m && req.method === "POST") {
      const id = Number(m[1]);
      const post = q.get.get(id);
      if (!post || post.status !== "approved") return out(404, { error: "Inlägget finns inte." });

      if (m[2] === "like") {
        if (!limit("like:" + ip, 120, 3_600_000)) return out(429, { error: "Lugn i stormen – för många likes just nu." });
        let liked;
        if (q.hasLike.get(id, vid)) { q.delLike.run(id, vid); liked = false; }
        else { q.addLike.run(id, vid); liked = true; }
        return out(200, { liked, likes: q.likeCount.get(id).n });
      }

      // anmälan: räknas per besökare, och per IP för att försvåra fusk
      if (!limit("report:" + ip, 20, 3_600_000)) return out(429, { error: "För många anmälningar." });
      q.addReport.run(id, hash(ip));
      if (q.reportCount.get(id).n >= REPORTS_TO_HIDE) q.setStatus.run("pending", "Anmält av besökare", id);
      return out(200, { ok: true });
    }

    // ----- Admin -----
    if (path.startsWith("/api/admin/")) {
      if (adminLocked(ip)) return out(429, { error: "För många felaktiga försök. Vänta 15 minuter." });
      if (!ADMIN_PASSWORD) return out(503, { error: "ADMIN_PASSWORD är inte satt på servern." });
      if (!isAdmin(req, ip)) return out(401, { error: "Fel lösenord." });

      if (req.method === "GET" && path === "/api/admin/posts") {
        const status = ["pending", "approved", "rejected"].includes(url.searchParams.get("status")) ? url.searchParams.get("status") : "pending";
        const counts = Object.fromEntries(q.counts.all().map((r) => [r.status, r.n]));
        return out(200, { posts: q.adminPosts.all(status), counts });
      }
      m = path.match(/^\/api\/admin\/posts\/(\d+)$/);
      if (m && req.method === "POST") {
        const id = Number(m[1]);
        const { action } = await readJson(req);
        if (!q.get.get(id)) return out(404, { error: "Finns inte." });
        if (action === "approve") { q.setStatus.run("approved", "", id); q.clearReports.run(id); }
        else if (action === "reject") q.setStatus.run("rejected", "Avvisat av moderator", id);
        else if (action === "delete") q.del.run(id);
        else return out(400, { error: "Okänd åtgärd" });
        return out(200, { ok: true });
      }
    }

    return out(404, { error: "Hittades inte" });
  } catch (e) {
    console.error(e);
    return out(500, { error: "Något gick fel på servern." });
  }
});

server.listen(PORT, () => {
  console.log(`Åsiktstavlan körs på http://localhost:${PORT}`);
  if (!ADMIN_PASSWORD) console.warn("OBS: ADMIN_PASSWORD saknas – adminsidan är avstängd.");
  if (!process.env.ANTHROPIC_API_KEY) console.warn("OBS: ANTHROPIC_API_KEY saknas – alla inlägg hamnar i godkännandekön.");
});
