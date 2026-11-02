const $ = (s) => document.querySelector(s);
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Tiny DOM builder (uses textContent, so user text is never parsed as HTML)
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value' || k === 'checked' || k === 'disabled') el[k] = v;
    else if (k === 'style') el.style.cssText = v;
    else if (v != null && v !== false) el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
}

async function api(method, url, body) {
  const r = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && url !== '/api/login') { showLogin(); throw new Error('Not logged in'); }
  if (!r.ok) throw new Error(data.error || r.statusText);
  return data;
}

const state = {
  me: null, users: [],
  month: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  date: ymd(new Date()),
  viewUser: null,
  scores: {},
  day: null,     // { items, note, saved }
  dirty: false,
};

// ---------------- Auth ----------------
function showLogin() { $('#app-view').hidden = true; $('#login-view').hidden = false; }

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  $('#login-error').textContent = '';
  try {
    await api('POST', '/api/login', { username: f.get('username'), password: f.get('password') });
    e.target.reset();
    start();
  } catch (err) { $('#login-error').textContent = err.message; }
});

$('#logout').addEventListener('click', async () => {
  if (!confirmLeave()) return;
  await api('POST', '/api/logout');
  showLogin();
});

async function start() {
  try { Object.assign(state, await api('GET', '/api/me').then((m) => ({ me: m, users: m.users }))); }
  catch { return showLogin(); }
  state.viewUser = state.me.id;
  $('#hello').textContent = state.me.name;
  $('#login-view').hidden = true;
  $('#app-view').hidden = false;
  renderLegend();
  await loadMonth();
  await loadDay();
}

// ---------------- Calendar ----------------
const userClass = (uid) => `u${state.users.findIndex((u) => u.id === uid) % 2}`;

function renderLegend() {
  $('#legend').replaceChildren(
    ...state.users.map((u) => h('span', { class: 'label' }, h('i', { class: `swatch ${userClass(u.id)}` }), u.id === state.me.id ? `${u.name} (you)` : u.name)),
    h('span', { class: 'label', style: 'margin-left:auto' }, 'Bar = % complete'),
  );
}

async function loadMonth() {
  const ym = `${state.month.getFullYear()}-${pad(state.month.getMonth() + 1)}`;
  state.scores = await api('GET', `/api/month?ym=${ym}`);
  renderCalendar();
}

function renderCalendar() {
  const m = state.month;
  $('#month-label').textContent = m.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const offset = (m.getDay() + 6) % 7; // Monday first
  const daysIn = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
  const today = ymd(new Date());
  const cells = [];
  for (let i = 0; i < offset; i++) cells.push(h('div', { class: 'cell empty' }));
  for (let d = 1; d <= daysIn; d++) {
    const date = ymd(new Date(m.getFullYear(), m.getMonth(), d));
    const tips = [];
    const bars = state.users.map((u) => {
      const s = state.scores[u.id]?.[date];
      const pct = s ? (s.total ? (100 * s.done) / s.total : 100) : 0;
      tips.push(`${u.name}: ${s ? `${s.done}/${s.total}${s.note ? ' + note' : ''}` : '—'}`);
      return h('span', { class: 'bar' }, h('i', { class: userClass(u.id), style: `width:${pct}%` }));
    });
    const cls = ['cell', date === today && 'today', date > today && 'future', date === state.date && 'selected'].filter(Boolean).join(' ');
    cells.push(h('button', { class: cls, title: tips.join('\n'), onclick: () => selectDate(date) },
      h('span', { class: 'num' }, d), h('span', { class: 'bars' }, bars)));
  }
  $('#cal-grid').replaceChildren(...cells);
}

function shiftMonth(delta) {
  state.month = new Date(state.month.getFullYear(), state.month.getMonth() + delta, 1);
  loadMonth();
}
$('#prev-month').addEventListener('click', () => shiftMonth(-1));
$('#next-month').addEventListener('click', () => shiftMonth(1));
$('#today-btn').addEventListener('click', async () => {
  const now = new Date();
  state.month = new Date(now.getFullYear(), now.getMonth(), 1);
  await loadMonth();
  selectDate(ymd(now));
});

function confirmLeave() {
  return !state.dirty || confirm('Discard unsaved changes for this day?');
}

async function selectDate(date) {
  if (date === state.date || !confirmLeave()) return;
  state.date = date;
  renderCalendar();
  await loadDay();
}

// ---------------- Day panel ----------------
async function loadDay() {
  state.day = await api('GET', `/api/day?date=${state.date}&user=${state.viewUser}`);
  state.dirty = false;
  renderDay();
}

function setStatus(text, dirty = false) {
  const el = $('#save-status');
  el.textContent = text;
  el.classList.toggle('dirty', dirty);
}

function setDirty() {
  state.dirty = true;
  setStatus('Unsaved', true);
  renderProgress();
}

function renderProgress() {
  const items = state.day.items;
  const done = items.filter((i) => i.checked).length;
  $('#progress-bar').style.width = items.length ? `${(100 * done) / items.length}%` : '0';
  $('#progress-text').textContent = items.length ? `${done}/${items.length} · ${Math.round((100 * done) / items.length)}%` : '0/0';
  for (const type of ['do', 'dont']) {
    const list = items.filter((i) => i.type === type);
    const el = $(`#count-${type}`);
    if (el) el.textContent = `${list.filter((i) => i.checked).length}/${list.length}`;
  }
}

function renderDay() {
  const editable = state.viewUser === state.me.id;
  const day = state.day;
  const viewName = state.users.find((u) => u.id === state.viewUser)?.name;
  const dt = new Date(state.date + 'T00:00');
  const weekday = dt.toLocaleDateString(undefined, { weekday: 'long' });
  const dateLabel = dt.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

  const tabs = h('div', { class: 'tabs' }, state.users.map((u) =>
    h('button', {
      class: u.id === state.viewUser ? 'active' : '',
      onclick: async () => {
        if (u.id === state.viewUser || !confirmLeave()) return;
        state.viewUser = u.id;
        await loadDay();
      },
    }, u.id === state.me.id ? 'Me' : u.name)));

  const section = (type) => {
    const list = day.items.filter((item) => item.type === type);
    const cls = type === 'do' ? 'do' : 'avoid';
    const ul = h('ul', { class: 'checklist' }, list.map((item) =>
      h('li', { class: `${cls}-item${item.checked ? ' checked' : ''}` },
        h('label', {},
          h('input', {
            type: 'checkbox', checked: item.checked, disabled: !editable,
            onchange: (e) => { item.checked = e.target.checked; e.target.closest('li').classList.toggle('checked', item.checked); setDirty(); },
          }),
          h('span', { class: 'txt' }, item.text)))));
    if (!list.length) ul.append(h('li', {}, h('p', { class: 'empty-state', style: 'padding:9px 0' }, 'No items.')));

    return h('div', { class: 'block' },
      h('div', { class: 'block-head' },
        h('span', { class: `label ${cls}` }, type === 'do' ? 'Do' : 'Avoid — tick if avoided'),
        h('span', { class: 'label', id: `count-${type}` })),
      ul);
  };

  const noteBlock = editable
    ? h('textarea', { id: 'note', placeholder: 'Write about the day…', value: day.note, oninput: (e) => { day.note = e.target.value; setDirty(); } })
    : (day.note ? h('p', { class: 'note-view' }, day.note) : h('p', { class: 'empty-state' }, 'No note.'));

  const status = day.saved
    ? (day.savedAt ? `Saved ${new Date(day.savedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}` : 'Saved')
    : (editable ? 'Not saved' : `${viewName} hasn't logged this day`);

  $('#day').replaceChildren(...[
    h('div', { class: 'day-head' },
      h('div', {}, h('div', { class: 'label' }, dateLabel), h('h2', {}, weekday)),
      tabs),
    h('div', { class: 'stat-row' },
      h('div', { class: 'progress' }, h('div', { id: 'progress-bar' })),
      h('span', { id: 'progress-text', class: 'mono muted' })),
    !day.items.length && editable
      ? h('div', { class: 'block' }, h('p', { class: 'empty-state' }, 'Your checklist is empty. Use "Edit checklist" to set the items that appear every day.'))
      : null,
    section('do'),
    section('dont'),
    h('div', { class: 'block' }, h('div', { class: 'block-head' }, h('span', { class: 'label' }, 'Note')), noteBlock),
    h('div', { class: 'save-row' },
      editable && h('button', { class: 'primary', onclick: saveDay }, 'Save'),
      h('span', { id: 'save-status', class: 'mono muted status' }, status),
      editable && h('span', { class: 'label kbd-hint', style: 'margin-left:auto' }, 'Ctrl+S')),
  ].filter(Boolean));
  renderProgress();
}


async function saveDay() {
  setStatus('Saving…');
  try {
    state.day = await api('PUT', `/api/day?date=${state.date}`, { items: state.day.items, note: state.day.note });
    state.dirty = false;
    renderDay();
    loadMonth();
  } catch (err) { setStatus(`Save failed: ${err.message}`, true); }
}

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's' && state.viewUser === state.me?.id && !$('#template-dialog').open) {
    e.preventDefault();
    saveDay();
  }
});
window.addEventListener('beforeunload', (e) => { if (state.dirty) e.preventDefault(); });

// ---------------- Template editor ----------------
const tpl = { do: [], dont: [] };

function renderTplList(type) {
  $(`#tpl-${type}`).replaceChildren(...tpl[type].map((text, i) =>
    h('li', {},
      h('input', { value: text, oninput: (e) => { tpl[type][i] = e.target.value; } }),
      h('button', { type: 'button', class: 'remove', title: 'Remove', 'aria-label': 'Remove', onclick: () => { tpl[type].splice(i, 1); renderTplList(type); } }, '×'))));
}

$('#edit-template').addEventListener('click', async () => {
  Object.assign(tpl, await api('GET', '/api/template'));
  renderTplList('do');
  renderTplList('dont');
  $('#template-dialog').showModal();
});

for (const type of ['do', 'dont']) {
  const input = $(`#tpl-${type}-input`);
  const add = () => {
    if (!input.value.trim()) return;
    tpl[type].push(input.value.trim());
    input.value = '';
    renderTplList(type);
    input.focus();
  };
  document.querySelector(`[data-add="${type}"]`).addEventListener('click', add);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
}

$('#tpl-save').addEventListener('click', async () => {
  await api('PUT', '/api/template', tpl);
  $('#template-dialog').close();
  // Show the updated checklist right away (keeping any unsaved ticks/note on the open day)
  if (state.viewUser === state.me.id) {
    const { items, note } = state.day, wasDirty = state.dirty;
    await loadDay();
    if (wasDirty) {
      const ticked = new Set(items.filter((i) => i.checked).map((i) => i.type + '\n' + i.text));
      for (const i of state.day.items) i.checked = ticked.has(i.type + '\n' + i.text);
      state.day.note = note;
      renderDay();
      setDirty();
    }
  }
  loadMonth();
});

start();
