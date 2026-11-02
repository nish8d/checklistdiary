// Daily checklist + diary for two people — Cloudflare Worker + D1.
// Static files in /public are served by Workers Assets; this handles /api/*.
//
// Configuration (set as secrets/vars in Cloudflare, or in .dev.vars locally):
//   USER1_PASSWORD, USER2_PASSWORD  (required — a user without a password can't log in)
//   USER1_ID, USER2_ID              (login usernames, default sample1 / sample2)
//   USER1_NAME, USER2_NAME          (display names, default Sample 1 / Sample 2)
//   SESSION_SECRET                  (optional extra secret for signing login cookies)

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const enc = new TextEncoder();

function getUsers(env) {
  const users = {};
  for (const n of [1, 2]) {
    const id = String(env[`USER${n}_ID`] || `sample${n}`).toLowerCase().trim();
    users[id] = { name: env[`USER${n}_NAME`] || `Sample ${n}`, password: env[`USER${n}_PASSWORD`] || '' };
  }
  return users;
}

// ---- Crypto helpers ----------------------------------------------------------
// Cookie signing key comes from the passwords (+ optional secret), so changing a password logs everyone out.
const hmacKey = (env) => crypto.subtle.importKey(
  'raw', enc.encode(`${env.SESSION_SECRET || ''}|${env.USER1_PASSWORD || ''}|${env.USER2_PASSWORD || ''}`),
  { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sign = async (env, user) => hex(await crypto.subtle.sign('HMAC', await hmacKey(env), enc.encode(user)));
async function safeEq(a, b) {
  const [ha, hb] = await Promise.all([a, b].map((x) => crypto.subtle.digest('SHA-256', enc.encode(String(x)))));
  return crypto.subtle.timingSafeEqual(ha, hb);
}
async function currentUser(request, env, users) {
  const m = /(?:^|;\s*)session=([^;]+)/.exec(request.headers.get('Cookie') || '');
  if (!m) return null;
  const [user, sig] = decodeURIComponent(m[1]).split('.');
  return users[user]?.password && sig && (await safeEq(sig, await sign(env, user))) ? user : null;
}

// ---- Data helpers ------------------------------------------------------------
const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const cleanText = (t, max) => String(t ?? '').trim().slice(0, max);
const cleanList = (arr) => (Array.isArray(arr) ? arr : []).map((t) => cleanText(t, 200)).filter(Boolean).slice(0, 50);
const key = (i) => `${i?.type}\n${i?.text}`;

// "Today" comes from the browser (X-Today header) so it matches the user's own time zone.
function todayFrom(request) {
  const t = request.headers.get('X-Today') || '';
  return DATE_RE.test(t) ? t : new Date().toISOString().slice(0, 10);
}
async function readBody(request) {
  if (Number(request.headers.get('Content-Length') || 0) > 1e6) throw new Error('Body too large');
  try { return await request.json(); } catch { return {}; }
}

// Take the item list `base` and copy the ticks over from `ticks` (matched by type + text).
function withTicks(base, ticks) {
  const checked = new Set((Array.isArray(ticks) ? ticks : []).filter((i) => i?.checked).map(key));
  return base.map((i) => ({ text: i.text, type: i.type, checked: checked.has(key(i)) }));
}
const templateItems = (t) => [...t.do.map((text) => ({ text, type: 'do' })), ...t.dont.map((text) => ({ text, type: 'dont' }))];

// The checklist for a day is always the user's current checklist,
// except past days that were saved: those keep the checklist they had then (history).
const baseItems = (template, saved, date, today) => (saved && date < today ? saved.items : templateItems(template));
function dayFor(template, saved, date, today) {
  return {
    items: withTicks(baseItems(template, saved, date, today), saved?.items),
    note: saved?.note || '',
    savedAt: saved?.savedAt,
    saved: !!saved,
  };
}

async function getTemplate(env, user) {
  const row = await env.DB.prepare('SELECT data FROM templates WHERE user = ?').bind(user).first();
  return row ? JSON.parse(row.data) : { do: [], dont: [] };
}
async function getEntry(env, user, date) {
  const row = await env.DB.prepare('SELECT items, note, saved_at FROM entries WHERE user = ? AND date = ?').bind(user, date).first();
  return row ? { items: JSON.parse(row.items), note: row.note, savedAt: row.saved_at } : null;
}

// ---- API ---------------------------------------------------------------------
async function api(request, env, url) {
  const users = getUsers(env);
  const route = `${request.method} ${url.pathname}`;
  const secure = url.protocol === 'https:' ? '; Secure' : '';

  if (route === 'POST /api/login') {
    const { username, password } = await readBody(request);
    const id = String(username || '').toLowerCase().trim();
    const ok = users[id]?.password && (await safeEq(password || '', users[id].password));
    if (!ok) return json({ error: 'Wrong username or password' }, 401);
    const cookie = `session=${encodeURIComponent(`${id}.${await sign(env, id)}`)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 60}${secure}`;
    return json({ ok: true }, 200, { 'Set-Cookie': cookie });
  }
  if (route === 'POST /api/logout') {
    return json({ ok: true }, 200, { 'Set-Cookie': `session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}` });
  }

  const me = await currentUser(request, env, users);
  if (!me) return json({ error: 'Not logged in' }, 401);
  const today = todayFrom(request);

  if (route === 'GET /api/me') {
    return json({ id: me, name: users[me].name, users: Object.entries(users).map(([id, u]) => ({ id, name: u.name })) });
  }
  if (route === 'GET /api/template') return json(await getTemplate(env, me));
  if (route === 'PUT /api/template') {
    const body = await readBody(request);
    const t = { do: cleanList(body.do), dont: cleanList(body.dont) };
    await env.DB.prepare('INSERT INTO templates (user, data) VALUES (?, ?) ON CONFLICT(user) DO UPDATE SET data = excluded.data')
      .bind(me, JSON.stringify(t)).run();
    return json(t);
  }
  if (route === 'GET /api/month') {
    const ym = url.searchParams.get('ym') || '';
    if (!/^\d{4}-\d{2}$/.test(ym)) return json({ error: 'Bad month' }, 400);
    const { results } = await env.DB.prepare('SELECT user, date, items, note, saved_at FROM entries WHERE date BETWEEN ? AND ?')
      .bind(`${ym}-01`, `${ym}-31`).all();
    const templates = Object.fromEntries(await Promise.all(Object.keys(users).map(async (id) => [id, await getTemplate(env, id)])));
    const out = Object.fromEntries(Object.keys(users).map((id) => [id, {}]));
    for (const r of results) {
      if (!out[r.user]) continue;
      const day = dayFor(templates[r.user], { items: JSON.parse(r.items), note: r.note }, r.date, today);
      out[r.user][r.date] = { done: day.items.filter((i) => i.checked).length, total: day.items.length, note: !!day.note };
    }
    return json(out);
  }
  if (url.pathname === '/api/day') {
    const date = url.searchParams.get('date') || '';
    if (!DATE_RE.test(date)) return json({ error: 'Bad date' }, 400);
    if (request.method === 'GET') {
      const user = url.searchParams.get('user') || me;
      if (!users[user]) return json({ error: 'No such user' }, 404);
      return json(dayFor(await getTemplate(env, user), await getEntry(env, user, date), date, today));
    }
    if (request.method === 'PUT') { // you can only write your own day
      const body = await readBody(request);
      const [template, saved] = await Promise.all([getTemplate(env, me), getEntry(env, me, date)]);
      // Only the ticks come from the client; the items themselves come from the checklist.
      const entry = { items: withTicks(baseItems(template, saved, date, today), body.items), note: cleanText(body.note, 10000), savedAt: new Date().toISOString() };
      await env.DB.prepare(`INSERT INTO entries (user, date, items, note, saved_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user, date) DO UPDATE SET items = excluded.items, note = excluded.note, saved_at = excluded.saved_at`)
        .bind(me, date, JSON.stringify(entry.items), entry.note, entry.savedAt).run();
      return json(dayFor(template, entry, date, today));
    }
  }
  return json({ error: 'Not found' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      return await api(request, env, url);
    } catch (e) {
      return json({ error: e.message || 'Bad request' }, 400);
    }
  },
};
