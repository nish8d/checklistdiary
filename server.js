// Daily checklist + diary for two people. Zero dependencies: `node server.js`
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---- Config: edit these two logins ----------------------------------------
// Placeholder logins. Set USER1_PASSWORD / USER2_PASSWORD in the environment to override.
const USERS = {
  sample1: { name: 'Sample 1', password: process.env.USER1_PASSWORD || 'sample1' },
  sample2: { name: 'Sample 2', password: process.env.USER2_PASSWORD || 'sample2' },
};
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || __dirname;
// ---------------------------------------------------------------------------

const DATA_FILE = path.join(DATA_DIR, 'data.json');
const SECRET_FILE = path.join(DATA_DIR, '.secret');
const PUBLIC_DIR = path.join(__dirname, 'public');

// Session signing secret persists across restarts so people stay logged in.
let SECRET = process.env.SECRET;
if (!SECRET) {
  try { SECRET = fs.readFileSync(SECRET_FILE, 'utf8').trim(); }
  catch { SECRET = crypto.randomBytes(32).toString('hex'); fs.writeFileSync(SECRET_FILE, SECRET, { mode: 0o600 }); }
}

// ---- Storage ---------------------------------------------------------------
let data = { templates: {}, entries: {} };
try { data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch {}
for (const id of Object.keys(USERS)) {
  data.templates[id] ??= { do: [], dont: [] };
  data.entries[id] ??= {};
}
function persist() {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DATA_FILE); // atomic replace
}

// ---- Helpers ---------------------------------------------------------------
const sign = (user) => crypto.createHmac('sha256', SECRET).update(user).digest('hex');
const safeEq = (a, b) => {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
};
function currentUser(req) {
  const m = /(?:^|;\s*)session=([^;]+)/.exec(req.headers.cookie || '');
  if (!m) return null;
  const [user, sig] = decodeURIComponent(m[1]).split('.');
  return USERS[user] && sig && safeEq(sig, sign(user)) ? user : null;
}
function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (c) => { s += c; if (s.length > 1e6) { reject(new Error('Body too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const cleanText = (t, max) => String(t ?? '').trim().slice(0, max);
const cleanList = (arr) => (Array.isArray(arr) ? arr : []).map((t) => cleanText(t, 200)).filter(Boolean).slice(0, 50);
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const key = (i) => `${i?.type}\n${i?.text}`;

// Take the item list `base` and copy the ticks over from `ticks` (matched by type + text).
function withTicks(base, ticks) {
  const checked = new Set((Array.isArray(ticks) ? ticks : []).filter((i) => i?.checked).map(key));
  return base.map((i) => ({ text: i.text, type: i.type, checked: checked.has(key(i)) }));
}
function templateItems(user) {
  const t = data.templates[user];
  return [...t.do.map((text) => ({ text, type: 'do' })), ...t.dont.map((text) => ({ text, type: 'dont' }))];
}
// The checklist for a day is always the user's current checklist,
// except past days that were saved: those keep the checklist they had then (history).
function baseItems(user, date) {
  const saved = data.entries[user][date];
  return saved && date < todayStr() ? saved.items : templateItems(user);
}
function dayFor(user, date) {
  const saved = data.entries[user][date];
  return {
    items: withTicks(baseItems(user, date), saved?.items),
    note: saved?.note || '',
    savedAt: saved?.savedAt,
    saved: !!saved,
  };
}

// ---- Static files ----------------------------------------------------------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep) || !MIME[path.extname(file)]) return send(res, 404, { error: 'Not found' });
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)], 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

// ---- API -------------------------------------------------------------------
async function api(req, res, url) {
  const route = `${req.method} ${url.pathname}`;

  if (route === 'POST /api/login') {
    const { username, password } = await readBody(req);
    const id = String(username || '').toLowerCase().trim();
    if (!USERS[id] || !safeEq(password || '', USERS[id].password)) return send(res, 401, { error: 'Wrong username or password' });
    const cookie = `session=${encodeURIComponent(id + '.' + sign(id))}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 60}`;
    return send(res, 200, { ok: true }, { 'Set-Cookie': cookie });
  }
  if (route === 'POST /api/logout') {
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
  }

  const me = currentUser(req);
  if (!me) return send(res, 401, { error: 'Not logged in' });

  if (route === 'GET /api/me') {
    return send(res, 200, { id: me, name: USERS[me].name, users: Object.entries(USERS).map(([id, u]) => ({ id, name: u.name })) });
  }
  if (route === 'GET /api/template') return send(res, 200, data.templates[me]);
  if (route === 'PUT /api/template') {
    const body = await readBody(req);
    data.templates[me] = { do: cleanList(body.do), dont: cleanList(body.dont) };
    persist();
    return send(res, 200, data.templates[me]);
  }
  if (route === 'GET /api/month') {
    const ym = url.searchParams.get('ym') || '';
    if (!/^\d{4}-\d{2}$/.test(ym)) return send(res, 400, { error: 'Bad month' });
    const out = {};
    for (const id of Object.keys(USERS)) {
      out[id] = {};
      for (const date of Object.keys(data.entries[id])) {
        if (!date.startsWith(ym)) continue;
        const day = dayFor(id, date);
        out[id][date] = { done: day.items.filter((i) => i.checked).length, total: day.items.length, note: !!day.note };
      }
    }
    return send(res, 200, out);
  }
  if (url.pathname === '/api/day') {
    const date = url.searchParams.get('date') || '';
    if (!DATE_RE.test(date)) return send(res, 400, { error: 'Bad date' });
    if (req.method === 'GET') {
      const user = url.searchParams.get('user') || me;
      if (!USERS[user]) return send(res, 404, { error: 'No such user' });
      return send(res, 200, dayFor(user, date));
    }
    if (req.method === 'PUT') { // you can only write your own day
      const body = await readBody(req);
      // Only the ticks come from the client; the items themselves come from the checklist.
      data.entries[me][date] = { items: withTicks(baseItems(me, date), body.items), note: cleanText(body.note, 10000), savedAt: new Date().toISOString() };
      persist();
      return send(res, 200, dayFor(me, date));
    }
  }
  send(res, 404, { error: 'Not found' });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else if (req.method === 'GET') serveStatic(res, url.pathname);
    else send(res, 405, { error: 'Method not allowed' });
  } catch (e) {
    send(res, 400, { error: e.message || 'Bad request' });
  }
}).listen(PORT, () => console.log(`Checklist running at http://localhost:${PORT}`));
