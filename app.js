// ============================================================
//  Storage keys
// ============================================================
// UI preferences kept in localStorage (not sensitive)
const STORE_VIEW    = 'tb_view';
const STORE_GROUPBY = 'tb_groupby';
// Per-user task data is cached under namespaced keys: tb_<uid>_tasks etc.

// ============================================================
//  State
// ============================================================
const PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];
const PRIO_RANK  = { Critical: 0, High: 1, Medium: 2, Low: 3 };

let tasks = [];
let columns = [];
let groups = [];
let currentView = 'kanban';
let groupBy = false;
let sideSelectedPrio = 'Medium';
let modalSelectedPrio = 'Medium';
let modalSelectedColor = '#6161ff';
let modalSubtasks = [];          // working copy during modal session
let editingTaskId = null;
let editingColId  = null;
let editingGroupId = null;

// Drag state
let dragKind = null;             // 'card' | 'column' | null

// Supabase / cloud sync state
let sb = null;                   // Supabase client
let USER_ID = null;
let USER_EMAIL = '';
let syncStatus = 'idle';         // 'idle'|'saving'|'synced'|'error'
let saveTimer = null;
let pullTimer = null;
let pendingSave = false;
let lastPushAt = 0;
let rtChannel = null;
const dirty = { tasks: false, columns: false, groups: false };
let seenCols = new Set();
let seenGroups = new Set();
let dragIndicator = null;        // card drop placeholder
let dragTarget = { colId: null, beforeCardId: null };
let columnDragId = null;         // id of column being dragged

let filters = {
  priorities: new Set(PRIORITIES),
  cols: new Set(),
  groups: new Set(),
  deadline: 'all',
};

const PALETTE = [
  '#1a8cff', '#e08a00', '#00a65a', '#e2445c',
  '#6161ff', '#ff6b9d', '#00bcd4', '#9c27b0',
  '#607d8b', '#34495e', '#16a085', '#d35400'
];

// ============================================================
//  Defaults + seed
// ============================================================
const DEFAULT_COLS = [
  { id: 'todo',    name: 'To Do',   color: '#1a8cff' },
  { id: 'pending', name: 'Pending', color: '#e08a00' },
  { id: 'done',    name: 'Done',    color: '#00a65a' },
];


// ============================================================
//  Local cache (per user) + save scheduling
// ============================================================
const STORE_COLLAPSED = 'tb_collapsed';
let collapsedGroups = new Set();

function cacheKey(name) { return 'tb_' + (USER_ID || 'anon') + '_' + name; }
function cacheGet(name) {
  try { const r = localStorage.getItem(cacheKey(name)); return r ? JSON.parse(r) : null; } catch (e) { return null; }
}
function cacheSet(name, val) {
  try { localStorage.setItem(cacheKey(name), JSON.stringify(val)); } catch (e) {}
}
function cacheClearUser() {
  const prefix = 'tb_' + (USER_ID || 'anon') + '_';
  Object.keys(localStorage).filter(k => k.startsWith(prefix)).forEach(k => localStorage.removeItem(k));
}

// Instant paint from cache before the network round-trip.
function loadFromCache() {
  const c = cacheGet('columns'); columns = Array.isArray(c) ? c : [];
  const g = cacheGet('groups');  groups  = Array.isArray(g) ? g : [];
  const t = cacheGet('tasks');   tasks   = Array.isArray(t) ? t : [];
  tasks.forEach(x => { if (!Array.isArray(x.subtasks)) x.subtasks = []; if (x.group === undefined) x.group = ''; });
}

function getGroup(id) { return groups.find(g => g.id === id); }

// Save = write cache immediately, then debounce a cloud push.
function saveColumns() { cacheSet('columns', columns); scheduleCloudSave('columns'); }
function saveGroups()  { cacheSet('groups',  groups);  scheduleCloudSave('groups'); }
function saveTasks()   { cacheSet('tasks',   tasks);   scheduleCloudSave('tasks'); }

function loadGroupBy() { groupBy = localStorage.getItem(STORE_GROUPBY) === '1'; }
function saveGroupBy() { localStorage.setItem(STORE_GROUPBY, groupBy ? '1' : '0'); }

function loadCollapsed() {
  try { const a = JSON.parse(localStorage.getItem(STORE_COLLAPSED) || '[]'); if (Array.isArray(a)) collapsedGroups = new Set(a); } catch (e) {}
}
function saveCollapsed() { localStorage.setItem(STORE_COLLAPSED, JSON.stringify([...collapsedGroups])); }

function loadView() {
  const v = localStorage.getItem(STORE_VIEW);
  if (v === 'kanban' || v === 'table' || v === 'cards' || v === 'calendar') currentView = v;
}
function saveView() { localStorage.setItem(STORE_VIEW, currentView); }

// New columns/groups created on another device should auto-appear instead of
// being hidden by an existing filter selection.
function noteSeen() { columns.forEach(c => seenCols.add(c.id)); groups.forEach(g => seenGroups.add(g.id)); }
function addNewToFilters() {
  columns.forEach(c => { if (!seenCols.has(c.id)) filters.cols.add(c.id); });
  groups.forEach(g => { if (!seenGroups.has(g.id)) filters.groups.add(g.id); });
  filters.groups.add('');
  noteSeen();
}

// ============================================================
//  Utils
// ============================================================
function escHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function uid() { return 't_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7); }
function getCol(id) { return columns.find(c => c.id === id); }

// ---- Rich text helpers ----
function isHtmlContent(s) { return /<[a-z][\s\S]*>/i.test(s || ''); }
function stripHtml(html) {
  if (!html) return '';
  if (!isHtmlContent(html)) return html;
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return (tmp.textContent || tmp.innerText || '').replace(/\s+/g, ' ').trim();
}
function sanitizeHtml(html) {
  const ALLOWED = new Set(['B','STRONG','I','EM','U','H1','H2','H3','UL','OL','LI','P','BR','SPAN','A','DIV','BLOCKQUOTE','FONT']);
  const tmp = document.createElement('div');
  tmp.innerHTML = html || '';
  (function clean(node) {
    let i = 0;
    while (i < node.childNodes.length) {
      const child = node.childNodes[i];
      if (child.nodeType === 8) { child.remove(); continue; }       // comment
      if (child.nodeType !== 1) { i++; continue; }                  // text/other
      if (!ALLOWED.has(child.tagName)) {                            // unwrap unknown tag
        while (child.firstChild) node.insertBefore(child.firstChild, child);
        child.remove();
        continue;
      }
      [...child.attributes].forEach(attr => {
        const n = attr.name.toLowerCase();
        if (n === 'style') {
          const color = child.style.color;
          child.removeAttribute('style');
          if (color) child.style.color = color;
        } else if (n === 'color' && child.tagName === 'FONT') {
          // keep font color
        } else if (n === 'href' && child.tagName === 'A') {
          if (/^\s*(javascript|data):/i.test(attr.value)) child.removeAttribute('href');
          else { child.setAttribute('rel', 'noopener'); child.setAttribute('target', '_blank'); }
        } else {
          child.removeAttribute(attr.name);
        }
      });
      clean(child);
      i++;
    }
  })(tmp);
  return tmp.innerHTML;
}
function richToStored(editor) {
  const html = sanitizeHtml(editor.innerHTML);
  return stripHtml(html).trim() ? html.trim() : '';
}
function setupRichEditor(editor, toolbar) {
  try { document.execCommand('styleWithCSS', false, true); } catch (e) {}
  const currentBlockTag = () => {
    const sel = window.getSelection();
    if (!sel.rangeCount) return '';
    let node = sel.getRangeAt(0).startContainer;
    while (node && node !== editor) {
      if (node.nodeType === 1 && /^(H1|H2|H3|P|DIV|LI|BLOCKQUOTE)$/.test(node.tagName)) return node.tagName;
      node = node.parentNode;
    }
    return '';
  };
  toolbar.addEventListener('mousedown', e => {
    if (e.target.closest('button, .rich-color')) e.preventDefault();
  });
  toolbar.addEventListener('click', e => {
    const colorEl = e.target.closest('.rich-color');
    if (colorEl) {
      editor.focus();
      try { document.execCommand('styleWithCSS', false, true); } catch (_) {}
      document.execCommand('foreColor', false, colorEl.dataset.color);
      return;
    }
    const btn = e.target.closest('button');
    if (!btn) return;
    editor.focus();
    if (btn.dataset.cmd) {
      document.execCommand(btn.dataset.cmd, false, null);
    } else if (btn.dataset.block) {
      const tag = btn.dataset.block.toUpperCase();
      if (currentBlockTag() === tag) document.execCommand('formatBlock', false, '<div>');
      else document.execCommand('formatBlock', false, '<' + btn.dataset.block + '>');
    } else if (btn.dataset.link) {
      const url = prompt('URL do link:');
      if (url) document.execCommand('createLink', false, url);
    }
  });
  editor.addEventListener('keydown', e => {
    if (e.key !== ' ') return;
    const sel = window.getSelection();
    if (!sel.rangeCount || !sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) return;
    const before = node.textContent.slice(0, range.startOffset);
    const headingMap = { '###': 'h3', '##': 'h2', '#': 'h1' };
    const consume = () => {
      const r = document.createRange();
      r.setStart(node, 0); r.setEnd(node, range.startOffset);
      r.deleteContents();
    };
    if (headingMap[before]) { e.preventDefault(); consume(); document.execCommand('formatBlock', false, '<' + headingMap[before] + '>'); }
    else if (before === '-' || before === '*') { e.preventDefault(); consume(); document.execCommand('insertUnorderedList'); }
    else if (before === '1.') { e.preventDefault(); consume(); document.execCommand('insertOrderedList'); }
  });
}
function richEditorMarkup(id) {
  return `
    <div class="rich-toolbar" id="${id}-toolbar">
      <button type="button" data-cmd="bold" title="Negrito (Ctrl+B)"><b>B</b></button>
      <button type="button" data-cmd="italic" title="Itálico (Ctrl+I)"><i>I</i></button>
      <button type="button" data-cmd="underline" title="Sublinhado"><u>U</u></button>
      <span class="rich-sep"></span>
      <button type="button" data-block="h1" title="Título">H1</button>
      <button type="button" data-block="h2" title="Subtítulo">H2</button>
      <button type="button" data-cmd="insertUnorderedList" title="Lista">•</button>
      <button type="button" data-cmd="insertOrderedList" title="Lista numerada">1.</button>
      <span class="rich-sep"></span>
      <span class="rich-color" data-color="#e2445c" style="background:#e2445c" title="Vermelho"></span>
      <span class="rich-color" data-color="#fdab3d" style="background:#fdab3d" title="Laranja"></span>
      <span class="rich-color" data-color="#00c875" style="background:#00c875" title="Verde"></span>
      <span class="rich-color" data-color="#579bfc" style="background:#579bfc" title="Azul"></span>
      <span class="rich-color" data-color="#6161ff" style="background:#6161ff" title="Roxo"></span>
      <span class="rich-sep"></span>
      <button type="button" data-link="1" title="Inserir link">🔗</button>
      <button type="button" data-cmd="removeFormat" title="Limpar formatação">⌫</button>
    </div>
    <div class="rich-editor" id="${id}" contenteditable="true" data-placeholder="Adicione uma descrição detalhada… (aceita # título, - lista, **negrito**)"></div>
  `;
}
function subtaskCounts(t) {
  const arr = t.subtasks || [];
  return { done: arr.filter(s => s.done).length, total: arr.length };
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00');
  const today = new Date(); today.setHours(0,0,0,0);
  return Math.round((d - today) / 86400000);
}
function formatDeadline(dateStr, isDone) {
  if (!dateStr) return null;
  if (isDone) {
    const d = new Date(dateStr + 'T00:00:00');
    return { text: '✓ ' + d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), cls: 'done' };
  }
  const days = daysUntil(dateStr);
  if (days < 0) {
    const n = Math.abs(days);
    return { text: n + ' day' + (n === 1 ? '' : 's') + ' overdue', cls: 'over' };
  }
  if (days === 0) return { text: 'Today',    cls: 'warn' };
  if (days === 1) return { text: 'Tomorrow', cls: 'warn' };
  if (days <= 7)  return { text: 'In ' + days + 'd', cls: 'warn' };
  const d = new Date(dateStr + 'T00:00:00');
  return { text: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), cls: '' };
}

// ============================================================
//  Filter + sort
// ============================================================
function filterMatches(t) {
  if (!filters.priorities.has(t.priority)) return false;
  if (filters.cols.size && !filters.cols.has(t.col)) return false;
  if (filters.groups.size && !filters.groups.has(t.group || '')) return false;
  const d = filters.deadline;
  if (d !== 'all') {
    const days = daysUntil(t.deadline);
    if (d === 'none' && t.deadline) return false;
    if (d === 'overdue'  && (!t.deadline || days >= 0))  return false;
    if (d === 'this_week' && (!t.deadline || days < 0 || days > 7)) return false;
    if (d === 'later'    && (!t.deadline || days <= 7))  return false;
  }
  return true;
}
function activeFilterCount() {
  let n = 0;
  if (filters.priorities.size < PRIORITIES.length) n++;
  if (filters.cols.size && filters.cols.size < columns.length) n++;
  if (filters.groups.size && filters.groups.size < groups.length + 1) n++;
  if (filters.deadline !== 'all') n++;
  return n;
}
function resetFilters() {
  filters.priorities = new Set(PRIORITIES);
  filters.cols       = new Set(columns.map(c => c.id));
  filters.groups     = new Set([...groups.map(g => g.id), '']);
  filters.deadline   = 'all';
}
function getFilteredSorted() {
  const q = document.getElementById('search').value.trim().toLowerCase();
  const sortBy = document.getElementById('sort').value;
  let list = tasks.slice();
  if (q) list = list.filter(t =>
    (t.title || '').toLowerCase().includes(q) ||
    (t.desc  || '').toLowerCase().includes(q)
  );
  list = list.filter(filterMatches);
  if (sortBy === 'manual') return list;
  list.sort((a, b) => {
    if (sortBy === 'deadline') {
      if (!a.deadline && !b.deadline) return b.created - a.created;
      if (!a.deadline) return 1;
      if (!b.deadline) return -1;
      return a.deadline.localeCompare(b.deadline);
    }
    if (sortBy === 'priority') {
      const d = PRIO_RANK[a.priority] - PRIO_RANK[b.priority];
      if (d !== 0) return d;
      return b.created - a.created;
    }
    if (sortBy === 'title') return (a.title || '').localeCompare(b.title || '');
    return b.created - a.created;
  });
  return list;
}

// ============================================================
//  Subtask chip helper
// ============================================================
function subtaskChipHtml(t) {
  const { done, total } = subtaskCounts(t);
  if (!total) return '';
  const cls = (done === total) ? ' complete' : '';
  return `<span class="chip chip-subtask${cls}">☑ ${done}/${total}</span>`;
}

// ============================================================
//  Top-level render
// ============================================================
function renderBoard() {
  const board = document.getElementById('board');
  board.className = 'board view-' + currentView + ((groupBy && currentView === 'cards') ? ' grouped' : '');
  if      (currentView === 'kanban')   renderKanban(board);
  else if (currentView === 'table')    renderTable(board);
  else if (currentView === 'calendar') renderCalendar(board);
  else                                 renderCards(board);
  renderOverview();
  renderGroupsList();
  refreshFilterBadge();
  const gb = document.getElementById('groupby-btn');
  if (gb) gb.classList.toggle('active', groupBy);
}

// Build ordered group sections from a task list (real groups + "No group")
function groupOrder() {
  return [...groups, { id: '', name: 'No group', color: '#9aa0b0' }];
}
function groupHeaderHtml(g, count) {
  const collapsed = collapsedGroups.has(g.id);
  return `<div class="group-header${collapsed ? ' collapsed' : ''}" data-group="${escHtml(g.id)}" style="--gc:${escHtml(g.color)}">
      <span class="group-toggle">${collapsed ? '▸' : '▾'}</span>
      <span class="group-name">${escHtml(g.name)}</span>
      <span class="group-count">${count}</span>
    </div>`;
}
function renderGroupedCards(items, showColChip) {
  return groupOrder().map(g => {
    const sect = items.filter(t => (t.group || '') === g.id);
    if (!sect.length) return '';
    const cards = collapsedGroups.has(g.id) ? '' : sect.map(t => cardHtml(t, showColChip)).join('');
    return `<div class="group-section">${groupHeaderHtml(g, sect.length)}${cards}</div>`;
  }).join('');
}

// ---------- Kanban ----------
function renderKanban(board) {
  const list = getFilteredSorted();
  const byCol = {};
  columns.forEach(c => byCol[c.id] = []);
  list.forEach(t => { if (byCol[t.col]) byCol[t.col].push(t); });

  board.innerHTML = columns.map(c => {
    const items = byCol[c.id] || [];
    let cards;
    if (!items.length) cards = '<div class="col-empty">☁ No tasks here</div>';
    else if (groupBy)  cards = renderGroupedCards(items, false);
    else               cards = items.map(t => cardHtml(t, false)).join('');
    return `
      <section class="col" data-col="${escHtml(c.id)}">
        <div class="col-header" data-col-header="${escHtml(c.id)}" draggable="true" style="background:${escHtml(c.color)}">
          <div class="col-header-left">
            <span class="col-header-grip">⋮⋮</span>
            <span class="col-header-name">${escHtml(c.name)}</span>
          </div>
          <div class="col-header-right">
            <span class="col-badge">${items.length}</span>
            <button class="col-menu-btn" data-edit-col="${escHtml(c.id)}" title="Edit column">⋯</button>
          </div>
        </div>
        <div class="col-body" data-col-body="${escHtml(c.id)}">${cards}</div>
        <button class="add-task-btn" data-add-col="${escHtml(c.id)}">+ Add task</button>
      </section>
    `;
  }).join('');

  attachCardHandlers(true);
  attachColumnHandlers();
}

// ---------- Cards (grid) ----------
function renderCards(board) {
  const list = getFilteredSorted();
  if (!list.length) {
    board.innerHTML = '<div class="table-empty">No tasks match your filters.</div>';
    return;
  }
  if (groupBy) {
    board.innerHTML = groupOrder().map(g => {
      const sect = list.filter(t => (t.group || '') === g.id);
      if (!sect.length) return '';
      const grid = collapsedGroups.has(g.id) ? '' : `<div class="cards-grid">${sect.map(t => cardHtml(t, true)).join('')}</div>`;
      return `<div class="group-section-wide">${groupHeaderHtml(g, sect.length)}${grid}</div>`;
    }).join('');
  } else {
    board.innerHTML = list.map(t => cardHtml(t, true)).join('');
  }
  attachCardHandlers(false);
}

// ---------- Calendar ----------
let calYear = null, calMonth = null;
function ensureCalInit() {
  if (calYear == null) { const d = new Date(); calYear = d.getFullYear(); calMonth = d.getMonth(); }
}
function pad2(n) { return String(n).padStart(2, '0'); }
function ymdLocal(y, m, d) { return y + '-' + pad2(m + 1) + '-' + pad2(d); }

function renderCalendar(board) {
  ensureCalInit();
  const list = getFilteredSorted();
  const byDate = {};
  list.forEach(t => { if (t.deadline) (byDate[t.deadline] = byDate[t.deadline] || []).push(t); });
  const undated = list.filter(t => !t.deadline).length;

  const first = new Date(calYear, calMonth, 1);
  const startDay = first.getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const today = new Date();
  const todayStr = ymdLocal(today.getFullYear(), today.getMonth(), today.getDate());
  const monthLabel = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const WD = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];

  let cells = '';
  for (let i = 0; i < startDay; i++) cells += '<div class="cal-cell cal-blank"></div>';
  for (let day = 1; day <= daysInMonth; day++) {
    const ds = ymdLocal(calYear, calMonth, day);
    const dayTasks = byDate[ds] || [];
    const isToday = ds === todayStr;
    const shown = dayTasks.slice(0, 4);
    const more = dayTasks.length - shown.length;
    const chips = shown.map(t => {
      const overdue = ds < todayStr && t.col !== 'done';
      const done = t.col === 'done';
      return '<div class="cal-task priority-' + escHtml(t.priority) + (overdue ? ' over' : '') + (done ? ' done' : '') +
             '" data-edit="' + escHtml(t.id) + '" title="' + escHtml(t.title) + '">' + escHtml(t.title) + '</div>';
    }).join('');
    const moreEl = more > 0 ? '<div class="cal-more">+' + more + '</div>' : '';
    cells += '<div class="cal-cell' + (isToday ? ' cal-today' : '') + '" data-cal-day="' + ds + '">' +
             '<div class="cal-daynum">' + day + '</div>' +
             '<div class="cal-tasks">' + chips + moreEl + '</div></div>';
  }
  const trailing = (startDay + daysInMonth) % 7;
  if (trailing) for (let i = trailing; i < 7; i++) cells += '<div class="cal-cell cal-blank"></div>';

  board.innerHTML =
    '<div class="cal-wrap">' +
      '<div class="cal-toolbar">' +
        '<div class="cal-nav">' +
          '<button class="icon-btn" id="cal-prev" title="Mes anterior">&#8249;</button>' +
          '<button class="btn-ghost" id="cal-today" style="padding:6px 12px">Hoje</button>' +
          '<button class="icon-btn" id="cal-next" title="Proximo mes">&#8250;</button>' +
        '</div>' +
        '<div class="cal-month">' + escHtml(monthLabel) + '</div>' +
        '<div class="cal-legend">' + (undated ? undated + ' sem prazo' : '') + '</div>' +
      '</div>' +
      '<div class="cal-weekdays">' + WD.map(d => '<div>' + d + '</div>').join('') + '</div>' +
      '<div class="cal-grid">' + cells + '</div>' +
    '</div>';

  document.getElementById('cal-prev').addEventListener('click', () => { calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; } renderBoard(); });
  document.getElementById('cal-next').addEventListener('click', () => { calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; } renderBoard(); });
  document.getElementById('cal-today').addEventListener('click', () => { const d = new Date(); calYear = d.getFullYear(); calMonth = d.getMonth(); renderBoard(); });
  board.querySelectorAll('[data-edit]').forEach(el => el.addEventListener('click', e => { e.stopPropagation(); openTaskModal(el.dataset.edit); }));
  board.querySelectorAll('[data-cal-day]').forEach(cell => cell.addEventListener('click', e => {
    if (e.target.closest('[data-edit]')) return;
    openTaskModalWithDate(cell.dataset.calDay);
  }));
}
function openTaskModalWithDate(ds) {
  openTaskModal(null);
  const dl = document.getElementById('m-deadline');
  if (dl) dl.value = ds;
}

// ---------- Table ----------
function renderTable(board) {
  const list = getFilteredSorted();
  if (!list.length) {
    board.innerHTML = '<div class="table-empty">No tasks match your filters.</div>';
    return;
  }
  const sortBy = document.getElementById('sort').value;
  const sortMark = (key) => sortBy === key ? 'active-sort' : '';
  let bodyRows;
  if (groupBy) {
    bodyRows = groupOrder().map(g => {
      const sect = list.filter(t => (t.group || '') === g.id);
      if (!sect.length) return '';
      const collapsed = collapsedGroups.has(g.id);
      const head = `<tr class="group-row${collapsed ? ' collapsed' : ''}" data-group="${escHtml(g.id)}"><td colspan="6" style="--gc:${escHtml(g.color)}"><span class="group-toggle">${collapsed ? '▸' : '▾'}</span>${escHtml(g.name)} <span class="group-count">${sect.length}</span></td></tr>`;
      const rows = collapsed ? '' : sect.map(t => tableRowHtml(t)).join('');
      return head + rows;
    }).join('');
  } else {
    bodyRows = list.map(t => tableRowHtml(t)).join('');
  }
  board.innerHTML = `
    <table class="task-table">
      <thead>
        <tr>
          <th data-sort="title" class="${sortMark('title')}">Task</th>
          <th data-sort="priority" class="${sortMark('priority')}">Priority</th>
          <th data-sort="deadline" class="${sortMark('deadline')}">Deadline</th>
          <th>Status</th>
          <th data-sort="created" class="${sortMark('created')}">Added</th>
          <th></th>
        </tr>
      </thead>
      <tbody>${bodyRows}</tbody>
    </table>
  `;
  board.querySelectorAll('th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      document.getElementById('sort').value = th.dataset.sort;
      renderBoard();
    });
  });
  attachCardHandlers(false);
}

function tableRowHtml(t) {
  const col = getCol(t.col);
  const dl = formatDeadline(t.deadline, t.col === 'done');
  const createdStr = new Date(t.created).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const colChip = col
    ? `<span class="chip chip-col" style="background:${escHtml(col.color)}">${escHtml(col.name)}</span>`
    : `<span class="chip chip-deadline">—</span>`;
  const dlChip = dl
    ? `<span class="chip chip-deadline ${dl.cls}">${escHtml(dl.text)}</span>`
    : `<span class="chip chip-deadline">—</span>`;
  const descPlain = stripHtml(t.desc);
  const descHtml = descPlain ? `<div class="t-desc">${escHtml(descPlain)}</div>` : '';
  const stChip = subtaskChipHtml(t);
  const grp = (t.group && !groupBy) ? getGroup(t.group) : null;
  const groupChip = grp ? `<span class="chip chip-col" style="background:${escHtml(grp.color)}">${escHtml(grp.name)}</span>` : '';
  return `
    <tr class="t-row priority-${escHtml(t.priority)}" data-id="${escHtml(t.id)}">
      <td>
        <div class="t-title-row">
          <span class="t-title" data-edit="${escHtml(t.id)}">${escHtml(t.title)}</span>
          ${stChip}
          ${groupChip}
        </div>
        ${descHtml}
      </td>
      <td><span class="chip chip-prio" data-p="${escHtml(t.priority)}">${escHtml(t.priority)}</span></td>
      <td>${dlChip}</td>
      <td>${colChip}</td>
      <td style="color:var(--text-light);font-size:12px;">${createdStr}</td>
      <td class="t-actions">
        <button class="icon-btn" data-edit="${escHtml(t.id)}" title="Edit">✎</button>
        <button class="icon-btn" data-del="${escHtml(t.id)}" title="Delete">✕</button>
      </td>
    </tr>
  `;
}

// ---------- Card ----------
function cardHtml(t, showColumnChip) {
  const col = getCol(t.col);
  const colIdx = columns.findIndex(c => c.id === t.col);
  const dl = formatDeadline(t.deadline, t.col === 'done');
  const descPlain = stripHtml(t.desc);
  const descHtml = descPlain ? `<div class="card-desc">${escHtml(descPlain)}</div>` : '';
  const dlChip = dl ? `<span class="chip chip-deadline ${dl.cls}">${escHtml(dl.text)}</span>` : '';
  const colChip = (showColumnChip && col)
    ? `<span class="chip chip-col" style="background:${escHtml(col.color)}">${escHtml(col.name)}</span>` : '';
  const stChip = subtaskChipHtml(t);
  const grp = (t.group && !groupBy) ? getGroup(t.group) : null;
  const groupChip = grp ? `<span class="chip chip-col" style="background:${escHtml(grp.color)}">${escHtml(grp.name)}</span>` : '';
  const prevBtn = colIdx > 0
    ? `<button class="icon-btn" data-move="prev" data-id="${escHtml(t.id)}" title="Move left">←</button>` : '';
  const nextBtn = colIdx > -1 && colIdx < columns.length - 1
    ? `<button class="icon-btn" data-move="next" data-id="${escHtml(t.id)}" title="Move right">→</button>` : '';
  const draggable = currentView === 'kanban' ? 'draggable="true"' : '';
  return `
    <article class="card priority-${escHtml(t.priority)}" ${draggable} data-id="${escHtml(t.id)}">
      <div class="card-title" data-edit="${escHtml(t.id)}">${escHtml(t.title)}</div>
      ${descHtml}
      <div class="card-meta">
        <span class="chip chip-prio" data-p="${escHtml(t.priority)}">${escHtml(t.priority)}</span>
        ${dlChip}
        ${stChip}
        ${groupChip}
        ${colChip}
      </div>
      <div class="card-actions">
        ${prevBtn}${nextBtn}
        <button class="icon-btn" data-edit="${escHtml(t.id)}" title="Edit">✎</button>
        <button class="icon-btn" data-del="${escHtml(t.id)}" title="Delete">✕</button>
      </div>
    </article>
  `;
}

// ---------- Overview ----------
function renderOverview() {
  const counts = {};
  columns.forEach(c => counts[c.id] = 0);
  tasks.forEach(t => { if (counts[t.col] != null) counts[t.col]++; });
  document.getElementById('overview').innerHTML = columns.map(c => `
    <div class="overview-row" style="background:${escHtml(c.color)}">
      <span>${escHtml(c.name)}</span>
      <span class="count">${counts[c.id] || 0}</span>
    </div>
  `).join('');
}

// ---------- Groups list (sidebar) ----------
function renderGroupsList() {
  const el = document.getElementById('groups-list');
  if (!el) return;
  if (!groups.length) { el.innerHTML = '<div class="group-empty">No groups yet.</div>'; return; }
  const counts = {};
  groups.forEach(g => counts[g.id] = 0);
  tasks.forEach(t => { if (t.group && counts[t.group] != null) counts[t.group]++; });
  el.innerHTML = groups.map(g => `
    <div class="group-item" data-edit-group="${escHtml(g.id)}">
      <span class="g-dot" style="background:${escHtml(g.color)}"></span>
      <span class="g-name">${escHtml(g.name)}</span>
      <span class="group-count">${counts[g.id] || 0}</span>
      <button class="g-edit" data-edit-group="${escHtml(g.id)}" title="Edit group">⋯</button>
    </div>
  `).join('');
  el.querySelectorAll('[data-edit-group]').forEach(node => {
    node.addEventListener('click', e => { e.stopPropagation(); openGroupModal(node.dataset.editGroup); });
  });
}

// ============================================================
//  Card drag-and-drop (within / between columns)
// ============================================================
function ensureIndicator() {
  if (!dragIndicator) {
    dragIndicator = document.createElement('div');
    dragIndicator.className = 'drop-indicator';
  }
  return dragIndicator;
}
function removeIndicator() {
  if (dragIndicator && dragIndicator.parentNode) dragIndicator.parentNode.removeChild(dragIndicator);
}
function getInsertionPoint(colBody, clientY) {
  const cards = [...colBody.querySelectorAll('.card:not(.dragging)')];
  for (const card of cards) {
    const rect = card.getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) return card;
  }
  return null;
}
function moveTask(taskId, targetColId, beforeCardId) {
  const taskIdx = tasks.findIndex(t => t.id === taskId);
  if (taskIdx < 0) return;
  const [task] = tasks.splice(taskIdx, 1);
  task.col = targetColId;
  if (beforeCardId) {
    const refIdx = tasks.findIndex(t => t.id === beforeCardId);
    if (refIdx >= 0) { tasks.splice(refIdx, 0, task); }
    else tasks.push(task);
  } else {
    let lastIdx = -1;
    for (let i = 0; i < tasks.length; i++) if (tasks[i].col === targetColId) lastIdx = i;
    if (lastIdx >= 0) tasks.splice(lastIdx + 1, 0, task);
    else tasks.push(task);
  }
  saveTasks();
}

// ============================================================
//  Column drag-and-drop
// ============================================================
function showColumnIndicator(board, beforeCol) {
  removeColumnIndicator();
  const ind = document.createElement('div');
  ind.className = 'col-drop-indicator';
  if (beforeCol) board.insertBefore(ind, beforeCol);
  else board.appendChild(ind);
}
function removeColumnIndicator() {
  document.querySelectorAll('.col-drop-indicator').forEach(el => el.remove());
}
function reorderColumn(draggedId, beforeColId) {
  const idx = columns.findIndex(c => c.id === draggedId);
  if (idx < 0) return;
  const [col] = columns.splice(idx, 1);
  if (beforeColId) {
    const ref = columns.findIndex(c => c.id === beforeColId);
    if (ref >= 0) columns.splice(ref, 0, col);
    else columns.push(col);
  } else {
    columns.push(col);
  }
  saveColumns();
}

// ============================================================
//  Handlers
// ============================================================
function attachCardHandlers(isKanban) {
  document.querySelectorAll('[data-edit]').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      openTaskModal(el.dataset.edit);
    });
  });
  document.querySelectorAll('[data-del]').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      const id = el.dataset.del;
      const t = tasks.find(x => x.id === id);
      if (t && confirm('Delete "' + t.title + '"?')) {
        tasks = tasks.filter(x => x.id !== id);
        saveTasks(); renderBoard();
      }
    });
  });
  document.querySelectorAll('[data-move]').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      const t = tasks.find(x => x.id === el.dataset.id);
      if (!t) return;
      const idx = columns.findIndex(c => c.id === t.col);
      const newIdx = idx + (el.dataset.move === 'next' ? 1 : -1);
      if (newIdx < 0 || newIdx >= columns.length) return;
      t.col = columns[newIdx].id;
      saveTasks(); renderBoard();
    });
  });
  if (!isKanban) return;
  document.querySelectorAll('[data-add-col]').forEach(el => {
    el.addEventListener('click', () => {
      document.getElementById('s-col').value = el.dataset.addCol;
      document.getElementById('s-title').focus();
      openSidebarIfMobile();
    });
  });
  // Card drag
  document.querySelectorAll('.card[draggable="true"]').forEach(card => {
    card.addEventListener('dragstart', e => {
      dragKind = 'card';
      card.classList.add('dragging');
      e.dataTransfer.setData('text/plain', card.dataset.id);
      e.dataTransfer.effectAllowed = 'move';
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      removeIndicator();
      document.querySelectorAll('.col-body.drag-over').forEach(b => b.classList.remove('drag-over'));
      dragTarget = { colId: null, beforeCardId: null };
      dragKind = null;
    });
  });
  document.querySelectorAll('[data-col-body]').forEach(body => {
    body.addEventListener('dragover', e => {
      if (dragKind !== 'card') return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      body.classList.add('drag-over');
      document.querySelectorAll('.col-body.drag-over').forEach(b => {
        if (b !== body) b.classList.remove('drag-over');
      });
      const afterCard = getInsertionPoint(body, e.clientY);
      const ind = ensureIndicator();
      if (afterCard) afterCard.parentNode.insertBefore(ind, afterCard);
      else body.appendChild(ind);
      dragTarget = {
        colId: body.dataset.colBody,
        beforeCardId: afterCard ? afterCard.dataset.id : null,
      };
    });
    body.addEventListener('dragleave', e => {
      if (!body.contains(e.relatedTarget)) body.classList.remove('drag-over');
    });
    body.addEventListener('drop', e => {
      if (dragKind !== 'card') return;
      e.preventDefault();
      const id = e.dataTransfer.getData('text/plain');
      if (!id) return;
      const sortEl = document.getElementById('sort');
      if (sortEl.value !== 'manual') sortEl.value = 'manual';
      moveTask(id, dragTarget.colId || body.dataset.colBody, dragTarget.beforeCardId);
      removeIndicator();
      body.classList.remove('drag-over');
      dragTarget = { colId: null, beforeCardId: null };
      renderBoard();
    });
  });
}

function attachColumnHandlers() {
  // Edit column menu button
  document.querySelectorAll('[data-edit-col]').forEach(el => {
    el.addEventListener('click', e => { e.stopPropagation(); openColumnModal(el.dataset.editCol); });
  });
  // Column drag (header is the handle)
  document.querySelectorAll('[data-col-header]').forEach(header => {
    header.addEventListener('dragstart', e => {
      // Ignore drags that originate from the menu button
      if (e.target.closest('.col-menu-btn')) { e.preventDefault(); return; }
      dragKind = 'column';
      columnDragId = header.dataset.colHeader;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', 'column:' + columnDragId);
      header.closest('.col').classList.add('col-dragging');
    });
    header.addEventListener('dragend', () => {
      document.querySelectorAll('.col-dragging').forEach(c => c.classList.remove('col-dragging'));
      removeColumnIndicator();
      columnDragId = null;
      dragKind = null;
    });
  });
}

// Board-level column drag handlers — attached ONCE at boot
function attachBoardDragHandlers() {
  const board = document.getElementById('board');
  board.addEventListener('dragover', e => {
    if (dragKind !== 'column') return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const cols = [...board.querySelectorAll('.col:not(.col-dragging)')];
    let target = null;
    for (const c of cols) {
      const rect = c.getBoundingClientRect();
      if (e.clientX < rect.left + rect.width / 2) { target = c; break; }
    }
    showColumnIndicator(board, target);
  });
  board.addEventListener('drop', e => {
    if (dragKind !== 'column') return;
    e.preventDefault();
    const indicator = board.querySelector('.col-drop-indicator');
    const next = indicator ? indicator.nextElementSibling : null;
    const beforeColId = (next && next.classList && next.classList.contains('col')) ? next.dataset.col : null;
    reorderColumn(columnDragId, beforeColId);
    removeColumnIndicator();
    renderBoard();
  });
  // Collapse / expand group sections (delegated; data-group only on headers/group-rows)
  board.addEventListener('click', e => {
    const gh = e.target.closest('.group-header, tr.group-row');
    if (!gh || !board.contains(gh)) return;
    const gid = gh.getAttribute('data-group');
    if (gid === null) return;
    if (collapsedGroups.has(gid)) collapsedGroups.delete(gid);
    else collapsedGroups.add(gid);
    saveCollapsed();
    renderBoard();
  });
}

// ============================================================
//  Priority toggle (shared)
// ============================================================
function setupPrioGrid(containerId, setter) {
  const c = document.getElementById(containerId);
  c.addEventListener('click', e => {
    const btn = e.target.closest('.prio-btn');
    if (!btn) return;
    c.querySelectorAll('.prio-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    setter(btn.dataset.p);
  });
}

// ============================================================
//  Sidebar form
// ============================================================
function refreshColumnSelects() {
  const opts = columns.map(c => `<option value="${escHtml(c.id)}">${escHtml(c.name)}</option>`).join('');
  const s = document.getElementById('s-col');
  const prev = s.value;
  s.innerHTML = opts;
  if (columns.find(c => c.id === prev)) s.value = prev;
  const m = document.getElementById('m-col');
  if (m) {
    const prevM = m.value;
    m.innerHTML = opts;
    if (columns.find(c => c.id === prevM)) m.value = prevM;
  }
}
function setupSidebar() {
  setupPrioGrid('s-prio', v => sideSelectedPrio = v);
  const form = document.getElementById('side-form');
  form.addEventListener('submit', e => {
    e.preventDefault();
    const title = document.getElementById('s-title').value.trim();
    if (!title) return;
    tasks.push({
      id: uid(),
      title,
      desc: document.getElementById('s-desc').value.trim(),
      priority: sideSelectedPrio,
      deadline: document.getElementById('s-deadline').value || null,
      col: document.getElementById('s-col').value,
      created: Date.now(),
      subtasks: [],
    });
    saveTasks(); renderBoard();
    form.reset();
    sideSelectedPrio = 'Medium';
    document.querySelectorAll('#s-prio .prio-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.p === 'Medium');
    });
    refreshColumnSelects();
  });
  document.getElementById('s-title').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); form.requestSubmit(); }
  });
  document.getElementById('add-col-side').addEventListener('click', () => openColumnModal(null));
}

// ============================================================
//  Subtask management (inside task modal)
// ============================================================
function renderModalSubtasks() {
  const container = document.getElementById('m-subtasks-list');
  if (!container) return;
  const done = modalSubtasks.filter(s => s.done).length;
  const total = modalSubtasks.length;
  document.getElementById('m-subtask-meta').textContent = total ? `${done} of ${total} done` : '';

  if (total === 0) {
    container.innerHTML = '<div class="subtask-empty">No subtasks yet.</div>';
    return;
  }
  container.innerHTML = modalSubtasks.map((st, i) => `
    <div class="subtask-row" data-idx="${i}">
      <input type="checkbox" class="subtask-check" ${st.done ? 'checked' : ''}>
      <input type="text" class="subtask-text ${st.done ? 'done' : ''}" value="${escHtml(st.text)}" placeholder="Subtask...">
      <button type="button" class="subtask-del" title="Remove">✕</button>
    </div>
  `).join('');
}

function setupSubtaskHandlers() {
  const container = document.getElementById('m-subtasks-list');
  container.addEventListener('change', e => {
    if (e.target.classList.contains('subtask-check')) {
      const row = e.target.closest('.subtask-row');
      const idx = parseInt(row.dataset.idx);
      modalSubtasks[idx].done = e.target.checked;
      row.querySelector('.subtask-text').classList.toggle('done', e.target.checked);
      const done = modalSubtasks.filter(s => s.done).length;
      const total = modalSubtasks.length;
      document.getElementById('m-subtask-meta').textContent = total ? `${done} of ${total} done` : '';
    }
  });
  container.addEventListener('input', e => {
    if (e.target.classList.contains('subtask-text')) {
      const row = e.target.closest('.subtask-row');
      const idx = parseInt(row.dataset.idx);
      modalSubtasks[idx].text = e.target.value;
    }
  });
  container.addEventListener('keydown', e => {
    if (e.target.classList.contains('subtask-text') && e.key === 'Enter') {
      e.preventDefault();
      modalSubtasks.push({ id: uid(), text: '', done: false });
      renderModalSubtasks();
      const inputs = container.querySelectorAll('.subtask-text');
      if (inputs.length) inputs[inputs.length - 1].focus();
    }
  });
  container.addEventListener('click', e => {
    const delBtn = e.target.closest('.subtask-del');
    if (delBtn) {
      const idx = parseInt(delBtn.closest('.subtask-row').dataset.idx);
      modalSubtasks.splice(idx, 1);
      renderModalSubtasks();
    }
  });
  document.getElementById('m-add-subtask').addEventListener('click', () => {
    modalSubtasks.push({ id: uid(), text: '', done: false });
    renderModalSubtasks();
    const inputs = container.querySelectorAll('.subtask-text');
    if (inputs.length) inputs[inputs.length - 1].focus();
  });
}

// ============================================================
//  Task modal
// ============================================================
function openTaskModal(id) {
  editingTaskId = id || null;
  const t = id ? tasks.find(x => x.id === id) : null;
  modalSelectedPrio = t ? t.priority : 'Medium';
  modalSubtasks = t && Array.isArray(t.subtasks)
    ? t.subtasks.map(s => ({ ...s }))
    : [];
  const colOpts = columns.map(c =>
    `<option value="${escHtml(c.id)}" ${t && t.col===c.id ? 'selected' : ''}>${escHtml(c.name)}</option>`
  ).join('');
  const tGroup = t ? (t.group || '') : '';
  const groupOpts = `<option value="" ${tGroup==='' ? 'selected' : ''}>— No group —</option>` +
    groups.map(g => `<option value="${escHtml(g.id)}" ${tGroup===g.id ? 'selected' : ''}>${escHtml(g.name)}</option>`).join('');
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal modal-lg" role="dialog" aria-modal="true">
      <h2>${t ? 'Edit task' : 'New task'}</h2>
      <form id="m-form" autocomplete="off">
        <div class="field">
          <label for="m-title">Task name</label>
          <input type="text" id="m-title" required value="${t ? escHtml(t.title) : ''}">
        </div>
        <div class="field">
          <label>Description</label>
          ${richEditorMarkup('m-desc')}
        </div>
        <div class="field">
          <label>Priority</label>
          <div class="prio-grid" id="m-prio">
            <button type="button" class="prio-btn ${modalSelectedPrio==='Critical'?'active':''}" data-p="Critical">Critical</button>
            <button type="button" class="prio-btn ${modalSelectedPrio==='High'?'active':''}"     data-p="High">High</button>
            <button type="button" class="prio-btn ${modalSelectedPrio==='Medium'?'active':''}"   data-p="Medium">Medium</button>
            <button type="button" class="prio-btn ${modalSelectedPrio==='Low'?'active':''}"      data-p="Low">Low</button>
          </div>
        </div>
        <div class="field">
          <label for="m-deadline">Deadline</label>
          <input type="date" id="m-deadline" value="${t && t.deadline ? escHtml(t.deadline) : ''}">
        </div>
        <div class="field">
          <label for="m-col">Column</label>
          <select id="m-col">${colOpts}</select>
        </div>
        <div class="field">
          <label for="m-group">Group</label>
          <select id="m-group">${groupOpts}</select>
        </div>
        <div class="field">
          <div class="field-label-row">
            <label>Subtasks</label>
            <span class="field-meta" id="m-subtask-meta"></span>
          </div>
          <div class="subtask-list" id="m-subtasks-list"></div>
          <button type="button" class="add-subtask-btn" id="m-add-subtask">+ Add subtask</button>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn-secondary" id="m-cancel">Cancel</button>
          <button type="submit" class="btn-primary">Save</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(backdrop);
  document.getElementById('m-title').focus();
  setupPrioGrid('m-prio', v => modalSelectedPrio = v);
  // Init rich description editor
  const descEditor = document.getElementById('m-desc');
  const existingDesc = t ? (t.desc || '') : '';
  if (isHtmlContent(existingDesc)) descEditor.innerHTML = existingDesc;
  else descEditor.textContent = existingDesc;
  setupRichEditor(descEditor, document.getElementById('m-desc-toolbar'));
  renderModalSubtasks();
  setupSubtaskHandlers();

  function close() {
    if (backdrop.parentNode) document.body.removeChild(backdrop);
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
  document.getElementById('m-cancel').addEventListener('click', close);

  document.getElementById('m-form').addEventListener('submit', e => {
    e.preventDefault();
    const cleanedSubtasks = modalSubtasks
      .filter(s => s.text.trim())
      .map(s => ({ id: s.id, text: s.text.trim(), done: !!s.done }));
    const data = {
      title:    document.getElementById('m-title').value.trim(),
      desc:     richToStored(document.getElementById('m-desc')),
      priority: modalSelectedPrio,
      deadline: document.getElementById('m-deadline').value || null,
      col:      document.getElementById('m-col').value,
      group:    document.getElementById('m-group').value,
      subtasks: cleanedSubtasks,
    };
    if (!data.title) return;
    if (editingTaskId) {
      const t = tasks.find(x => x.id === editingTaskId);
      if (t) Object.assign(t, data);
    } else {
      tasks.push({ id: uid(), created: Date.now(), ...data });
    }
    saveTasks(); renderBoard();
    close();
  });
}

// ============================================================
//  Column modal
// ============================================================
function openColumnModal(id) {
  editingColId = id || null;
  const col = id ? columns.find(c => c.id === id) : null;
  modalSelectedColor = col ? col.color : PALETTE[Math.floor(Math.random() * PALETTE.length)];
  const swatches = PALETTE.map(c =>
    `<button type="button" class="swatch ${c.toLowerCase() === modalSelectedColor.toLowerCase() ? 'active' : ''}" style="background:${c}" data-swatch="${c}"></button>`
  ).join('');
  const deleteBtn = col
    ? `<button type="button" class="btn-danger danger" id="c-delete">Delete column</button>`
    : '';
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <h2>${col ? 'Edit column' : 'New column'}</h2>
      <form id="c-form" autocomplete="off">
        <div class="field">
          <label for="c-name">Name</label>
          <input type="text" id="c-name" required value="${col ? escHtml(col.name) : ''}">
        </div>
        <div class="field">
          <label>Color</label>
          <div class="color-row">
            <input type="color" id="c-color" value="${modalSelectedColor}">
            <div class="swatches" id="c-swatches">${swatches}</div>
          </div>
        </div>
        <div class="modal-actions">
          ${deleteBtn}
          <button type="button" class="btn-secondary" id="c-cancel">Cancel</button>
          <button type="submit" class="btn-primary">Save</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(backdrop);
  document.getElementById('c-name').focus();

  function setColor(hex) {
    modalSelectedColor = hex;
    document.getElementById('c-color').value = hex;
    document.querySelectorAll('#c-swatches .swatch').forEach(s => {
      s.classList.toggle('active', s.dataset.swatch.toLowerCase() === hex.toLowerCase());
    });
  }
  document.getElementById('c-swatches').addEventListener('click', e => {
    const sw = e.target.closest('.swatch');
    if (sw) setColor(sw.dataset.swatch);
  });
  document.getElementById('c-color').addEventListener('input', e => setColor(e.target.value));

  function close() {
    if (backdrop.parentNode) document.body.removeChild(backdrop);
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
  document.getElementById('c-cancel').addEventListener('click', close);

  if (col) {
    document.getElementById('c-delete').addEventListener('click', () => {
      if (columns.length <= 1) {
        alert("You can't delete the last remaining column.");
        return;
      }
      const taskCount = tasks.filter(t => t.col === col.id).length;
      const firstOther = columns.find(c => c.id !== col.id);
      const msg = taskCount
        ? `Delete "${col.name}"?\n\n${taskCount} task${taskCount===1?'':'s'} will be moved to "${firstOther.name}".`
        : `Delete "${col.name}"?`;
      if (!confirm(msg)) return;
      tasks.forEach(t => { if (t.col === col.id) t.col = firstOther.id; });
      columns = columns.filter(c => c.id !== col.id);
      filters.cols.delete(col.id);
      saveColumns(); saveTasks();
      refreshColumnSelects();
      renderBoard();
      close();
    });
  }

  document.getElementById('c-form').addEventListener('submit', e => {
    e.preventDefault();
    const name = document.getElementById('c-name').value.trim();
    if (!name) return;
    if (col) {
      col.name  = name;
      col.color = modalSelectedColor;
    } else {
      const newCol = { id: 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2,6),
                       name, color: modalSelectedColor };
      columns.push(newCol);
      filters.cols.add(newCol.id);
    }
    saveColumns();
    refreshColumnSelects();
    renderBoard();
    close();
  });
}

// ============================================================
//  Group modal (create / edit / delete)
// ============================================================
function openGroupModal(id) {
  editingGroupId = id || null;
  const grp = id ? groups.find(g => g.id === id) : null;
  modalSelectedColor = grp ? grp.color : PALETTE[Math.floor(Math.random() * PALETTE.length)];
  const swatches = PALETTE.map(c =>
    `<button type="button" class="swatch ${c.toLowerCase() === modalSelectedColor.toLowerCase() ? 'active' : ''}" style="background:${c}" data-swatch="${c}"></button>`
  ).join('');
  const deleteBtn = grp ? `<button type="button" class="btn-danger danger" id="g-delete">Delete group</button>` : '';
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <h2>${grp ? 'Edit group' : 'New group'}</h2>
      <form id="g-form" autocomplete="off">
        <div class="field">
          <label for="g-name">Name</label>
          <input type="text" id="g-name" required value="${grp ? escHtml(grp.name) : ''}">
        </div>
        <div class="field">
          <label>Color</label>
          <div class="color-row">
            <input type="color" id="g-color" value="${modalSelectedColor}">
            <div class="swatches" id="g-swatches">${swatches}</div>
          </div>
        </div>
        <div class="modal-actions">
          ${deleteBtn}
          <button type="button" class="btn-secondary" id="g-cancel">Cancel</button>
          <button type="submit" class="btn-primary">Save</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(backdrop);
  document.getElementById('g-name').focus();

  function setColor(hex) {
    modalSelectedColor = hex;
    document.getElementById('g-color').value = hex;
    document.querySelectorAll('#g-swatches .swatch').forEach(s => {
      s.classList.toggle('active', s.dataset.swatch.toLowerCase() === hex.toLowerCase());
    });
  }
  document.getElementById('g-swatches').addEventListener('click', e => {
    const sw = e.target.closest('.swatch');
    if (sw) setColor(sw.dataset.swatch);
  });
  document.getElementById('g-color').addEventListener('input', e => setColor(e.target.value));

  function close() {
    if (backdrop.parentNode) document.body.removeChild(backdrop);
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
  document.getElementById('g-cancel').addEventListener('click', close);

  if (grp) {
    document.getElementById('g-delete').addEventListener('click', () => {
      const n = tasks.filter(t => t.group === grp.id).length;
      if (!confirm(`Delete group "${grp.name}"?` + (n ? `\n\n${n} task${n===1?'':'s'} will become ungrouped.` : ''))) return;
      tasks.forEach(t => { if (t.group === grp.id) t.group = ''; });
      groups = groups.filter(g => g.id !== grp.id);
      filters.groups.delete(grp.id);
      saveGroups(); saveTasks();
      renderBoard();
      close();
    });
  }

  document.getElementById('g-form').addEventListener('submit', e => {
    e.preventDefault();
    const name = document.getElementById('g-name').value.trim();
    if (!name) return;
    if (grp) {
      grp.name = name;
      grp.color = modalSelectedColor;
    } else {
      const ng = { id: 'g_' + Date.now() + '_' + Math.random().toString(36).slice(2,6), name, color: modalSelectedColor };
      groups.push(ng);
      filters.groups.add(ng.id);
    }
    saveGroups();
    renderBoard();
    close();
  });
}

// ============================================================
//  Filter popover
// ============================================================
function renderFilterPopover() {
  const prioOptions = PRIORITIES.map(p => `
    <label class="filter-option">
      <input type="checkbox" data-filter-prio="${p}" ${filters.priorities.has(p) ? 'checked' : ''}>
      <span class="col-dot" style="background:${
        p==='Critical'?'#e2445c':p==='High'?'#fdab3d':p==='Medium'?'#579bfc':'#00c875'}"></span>
      ${p}
    </label>
  `).join('');
  const colOptions = columns.map(c => `
    <label class="filter-option">
      <input type="checkbox" data-filter-col="${escHtml(c.id)}" ${filters.cols.has(c.id) ? 'checked' : ''}>
      <span class="col-dot" style="background:${escHtml(c.color)}"></span>
      ${escHtml(c.name)}
    </label>
  `).join('');
  const dlOpt = (val, lbl) => `
    <label class="filter-option">
      <input type="radio" name="filter-dl" value="${val}" ${filters.deadline===val?'checked':''}>
      ${lbl}
    </label>
  `;
  const groupOptions = (groups.length ? groups.map(g => `
    <label class="filter-option">
      <input type="checkbox" data-filter-group="${escHtml(g.id)}" ${filters.groups.has(g.id) ? 'checked' : ''}>
      <span class="col-dot" style="background:${escHtml(g.color)}"></span>
      ${escHtml(g.name)}
    </label>
  `).join('') : '') + `
    <label class="filter-option">
      <input type="checkbox" data-filter-group="" ${filters.groups.has('') ? 'checked' : ''}>
      <span class="col-dot" style="background:#9aa0b0"></span>
      No group
    </label>`;
  return `
    <h4>Priority</h4>${prioOptions}
    <h4>Status</h4>${colOptions}
    <h4>Group</h4>${groupOptions}
    <h4>Deadline</h4>
    ${dlOpt('all','Any')}
    ${dlOpt('overdue','Overdue')}
    ${dlOpt('this_week','Due in next 7 days')}
    ${dlOpt('later','Due later')}
    ${dlOpt('none','No deadline')}
    <div class="filter-actions">
      <button type="button" class="btn-text" id="filter-clear">Clear filters</button>
      <button type="button" class="btn-primary" id="filter-close" style="padding:6px 14px;">Done</button>
    </div>
  `;
}
function openFilterPopover() {
  const pop = document.getElementById('filter-popover');
  pop.innerHTML = renderFilterPopover();
  pop.hidden = false;
  pop.querySelectorAll('[data-filter-prio]').forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) filters.priorities.add(cb.dataset.filterPrio);
      else filters.priorities.delete(cb.dataset.filterPrio);
      renderBoard();
    });
  });
  pop.querySelectorAll('[data-filter-col]').forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) filters.cols.add(cb.dataset.filterCol);
      else filters.cols.delete(cb.dataset.filterCol);
      renderBoard();
    });
  });
  pop.querySelectorAll('[data-filter-group]').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = cb.dataset.filterGroup;
      if (cb.checked) filters.groups.add(id);
      else filters.groups.delete(id);
      renderBoard();
    });
  });
  pop.querySelectorAll('[name="filter-dl"]').forEach(r => {
    r.addEventListener('change', () => {
      filters.deadline = r.value;
      renderBoard();
    });
  });
  document.getElementById('filter-clear').addEventListener('click', () => {
    resetFilters();
    openFilterPopover();
    renderBoard();
  });
  document.getElementById('filter-close').addEventListener('click', closeFilterPopover);
}
function closeFilterPopover() {
  document.getElementById('filter-popover').hidden = true;
}
function refreshFilterBadge() {
  const n = activeFilterCount();
  const badge = document.getElementById('filter-badge');
  if (n > 0) { badge.hidden = false; badge.textContent = n; }
  else { badge.hidden = true; }
}

// ============================================================
//  Export
// ============================================================
function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
function dateStamp() {
  const d = new Date();
  return d.getFullYear() + '-' +
         String(d.getMonth()+1).padStart(2,'0') + '-' +
         String(d.getDate()).padStart(2,'0');
}
function exportJSON() {
  const payload = {
    exportedAt: new Date().toISOString(),
    columns: columns.map(c => ({ id: c.id, name: c.name, color: c.color })),
    groups:  groups.map(g => ({ id: g.id, name: g.name, color: g.color })),
    tasks:   tasks.map(t => ({ ...t })),
  };
  download('task-board-' + dateStamp() + '.json', JSON.stringify(payload, null, 2), 'application/json');
}
function csvEscape(s) {
  if (s == null) return '';
  s = String(s);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function exportCSV() {
  const header = ['Title','Description','Priority','Deadline','Status','Subtasks','Created'];
  const rows = tasks.map(t => {
    const col = getCol(t.col);
    const { done, total } = subtaskCounts(t);
    const subStr = total
      ? `${done}/${total}: ` + (t.subtasks || []).map(s => (s.done ? '✓ ' : '○ ') + s.text).join(' | ')
      : '';
    return [
      t.title,
      t.desc || '',
      t.priority,
      t.deadline || '',
      col ? col.name : t.col,
      subStr,
      new Date(t.created).toISOString().slice(0,10),
    ].map(csvEscape).join(',');
  });
  const csv = '\uFEFF' + [header.join(','), ...rows].join('\n');
  download('task-board-' + dateStamp() + '.csv', csv, 'text/csv;charset=utf-8');
}

// ============================================================
//  Sidebar drawer (mobile)
// ============================================================
function isDrawerMode() { return window.matchMedia('(max-width: 820px)').matches; }
function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebar-backdrop').classList.add('open');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-backdrop').classList.remove('open');
}
function openSidebarIfMobile() { if (isDrawerMode()) openSidebar(); }

// ============================================================
//  Topbar / subbar wiring
// ============================================================
function setupTopbar() {
  document.getElementById('open-modal').addEventListener('click', () => openTaskModal(null));

  document.getElementById('hamburger').addEventListener('click', e => {
    e.stopPropagation();
    const sidebar = document.getElementById('sidebar');
    if (sidebar.classList.contains('open')) closeSidebar();
    else openSidebar();
  });
  document.getElementById('sidebar-backdrop').addEventListener('click', closeSidebar);

  const exportBtn  = document.getElementById('export-btn');
  const exportMenu = document.getElementById('export-menu');
  exportBtn.addEventListener('click', e => {
    e.stopPropagation();
    exportMenu.hidden = !exportMenu.hidden;
  });
  exportMenu.querySelectorAll('[data-export]').forEach(b => {
    b.addEventListener('click', () => {
      exportMenu.hidden = true;
      if (b.dataset.export === 'json') exportJSON();
      else exportCSV();
    });
  });

  document.getElementById('search').addEventListener('input', renderBoard);
  document.getElementById('sort').addEventListener('change', renderBoard);

  document.getElementById('view-switch').addEventListener('click', e => {
    const btn = e.target.closest('button[data-view]');
    if (!btn) return;
    currentView = btn.dataset.view;
    saveView();
    document.querySelectorAll('#view-switch button').forEach(b =>
      b.classList.toggle('active', b.dataset.view === currentView));
    renderBoard();
  });

  const filterBtn = document.getElementById('filter-btn');
  filterBtn.addEventListener('click', e => {
    e.stopPropagation();
    const pop = document.getElementById('filter-popover');
    if (pop.hidden) openFilterPopover(); else closeFilterPopover();
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('#filter-popover') && !e.target.closest('#filter-btn')) closeFilterPopover();
    if (!e.target.closest('#export-menu') && !e.target.closest('#export-btn')) exportMenu.hidden = true;
  });

  window.addEventListener('resize', () => {
    if (!isDrawerMode()) {
      document.getElementById('sidebar').classList.remove('open');
      document.getElementById('sidebar-backdrop').classList.remove('open');
    }
  });
}

// ============================================================
//  Supabase — cloud database (auth + sync + realtime)
// ============================================================
function setSyncStatus(status) {
  syncStatus = status;
  const dot = document.getElementById('sync-dot');
  if (!dot) return;
  dot.className = 'sync-dot' + (status === 'idle' ? '' : ' ' + status);
  const labels = {
    idle:   'Offline - alteracoes salvas so neste dispositivo',
    saving: 'Salvando...',
    synced: 'Tudo sincronizado',
    error:  'Erro de sincronizacao - vamos tentar de novo',
  };
  dot.title = labels[status] || '';
}

function initSupabase() {
  const cfg = window.SUPABASE_CONFIG || {};
  const key = cfg.anonKey || cfg.publishableKey;   // accepts legacy anon OR new sb_publishable_ key
  if (!cfg.url || !key || /YOUR-/.test(cfg.url) || /YOUR-/.test(key)) return false;
  if (!window.supabase || !window.supabase.createClient) return false;
  sb = window.supabase.createClient(cfg.url, key, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  return true;
}

// ---- (de)serialize between app shape and DB rows ----
function colToRow(c, i)   { return { id: c.id, user_id: USER_ID, name: c.name || '', color: c.color || '#6161ff', position: i }; }
function groupToRow(g, i) { return { id: g.id, user_id: USER_ID, name: g.name || '', color: g.color || '#6161ff', position: i }; }
function taskToRow(t, i) {
  return {
    id: t.id, user_id: USER_ID,
    title: t.title || '', description: t.desc || '',
    priority: t.priority || 'Medium',
    deadline: t.deadline || null,
    col_id: t.col || null,
    group_id: t.group ? t.group : null,
    position: i,
    subtasks: Array.isArray(t.subtasks) ? t.subtasks : [],
    created_at: new Date(t.created || Date.now()).toISOString(),
  };
}
function rowToCol(r)   { return { id: r.id, name: r.name || '', color: r.color || '#6161ff' }; }
function rowToGroup(r) { return { id: r.id, name: r.name || '', color: r.color || '#6161ff' }; }
function rowToTask(r) {
  return {
    id: r.id, title: r.title || '', desc: r.description || '',
    priority: r.priority || 'Medium',
    deadline: r.deadline || null,
    col: r.col_id || '',
    group: r.group_id || '',
    created: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
    subtasks: Array.isArray(r.subtasks) ? r.subtasks : [],
  };
}

// ---- Pull everything (cloud is the source of truth) ----
async function pullAll() {
  if (!sb || !USER_ID) return;
  const [c, g, t] = await Promise.all([
    sb.from('columns').select('*').eq('user_id', USER_ID).order('position', { ascending: true }),
    sb.from('groups').select('*').eq('user_id', USER_ID).order('position', { ascending: true }),
    sb.from('tasks').select('*').eq('user_id', USER_ID).order('position', { ascending: true }),
  ]);
  if (c.error) throw c.error;
  if (g.error) throw g.error;
  if (t.error) throw t.error;
  columns = (c.data || []).map(rowToCol);
  groups  = (g.data || []).map(rowToGroup);
  tasks   = (t.data || []).map(rowToTask);
  cacheSet('columns', columns); cacheSet('groups', groups); cacheSet('tasks', tasks);
}

// ---- Push (upsert current rows + delete the ones that disappeared) ----
async function pushTable(table, rows, currentIds) {
  if (rows.length) {
    const { error } = await sb.from(table).upsert(rows);
    if (error) throw error;
  }
  const { data: existing, error: selErr } = await sb.from(table).select('id').eq('user_id', USER_ID);
  if (selErr) throw selErr;
  const keep = new Set(currentIds);
  const toDelete = (existing || []).map(r => r.id).filter(id => !keep.has(id));
  if (toDelete.length) {
    const { error } = await sb.from(table).delete().in('id', toDelete);
    if (error) throw error;
  }
}

async function flushCloudSave() {
  clearTimeout(saveTimer); saveTimer = null;
  if (!sb || !USER_ID) { pendingSave = false; return; }
  setSyncStatus('saving');
  try {
    if (dirty.columns) { await pushTable('columns', columns.map(colToRow),   columns.map(c => c.id)); dirty.columns = false; }
    if (dirty.groups)  { await pushTable('groups',  groups.map(groupToRow),  groups.map(g => g.id));  dirty.groups = false; }
    if (dirty.tasks)   { await pushTable('tasks',   tasks.map(taskToRow),    tasks.map(t => t.id));   dirty.tasks = false; }
    lastPushAt = (window.performance ? performance.now() : Date.now());
    setSyncStatus('synced');
  } catch (e) {
    console.error('[sync] push failed', e);
    setSyncStatus('error');
  } finally {
    pendingSave = false;
  }
}

function scheduleCloudSave(kind) {
  if (kind) dirty[kind] = true;
  if (!sb || !USER_ID) return;       // not logged in -> cache only
  pendingSave = true;
  setSyncStatus('saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushCloudSave, 1200);
}

async function syncNow() {
  if (!sb || !USER_ID) return;
  dirty.tasks = dirty.columns = dirty.groups = true;
  await flushCloudSave();
}

// ---- Realtime: react to changes from another device/tab ----
function subscribeRealtime() {
  if (!sb || !USER_ID) return;
  if (rtChannel) { sb.removeChannel(rtChannel); rtChannel = null; }
  const filter = 'user_id=eq.' + USER_ID;
  rtChannel = sb.channel('tb_' + USER_ID)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks',   filter }, onRemoteChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'columns', filter }, onRemoteChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'groups',  filter }, onRemoteChange)
    .subscribe();
}
function onRemoteChange() {
  const now = (window.performance ? performance.now() : Date.now());
  if (pendingSave) return;                 // our own write is in flight
  if (now - lastPushAt < 2000) return;     // ignore the echo of our own write
  clearTimeout(pullTimer);
  pullTimer = setTimeout(async () => {
    try {
      await pullAll();
      addNewToFilters();
      refreshColumnSelects();
      renderBoard();
      setSyncStatus('synced');
    } catch (e) { console.error('[sync] pull failed', e); }
  }, 400);
}

// ---- Seed default columns for a brand-new (empty) account ----
async function seedIfEmpty() {
  if (columns.length) return;
  columns = DEFAULT_COLS.map(c => ({ ...c }));
  cacheSet('columns', columns);
  dirty.columns = true;
  await flushCloudSave();
}

// ============================================================
//  Import JSON
// ============================================================
function setupImport() {
  document.getElementById('import-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed.tasks)) { alert('Arquivo JSON inválido — campo "tasks" não encontrado.'); return; }
      if (!confirm(`Importar ${parsed.tasks.length} tarefas${parsed.columns ? ' e ' + parsed.columns.length + ' colunas' : ''}?\n\nIsso substituirá os dados atuais.`)) return;
      tasks   = parsed.tasks;   tasks.forEach(t => { if (!Array.isArray(t.subtasks)) t.subtasks = []; if (t.group === undefined) t.group = ''; });
      if (Array.isArray(parsed.columns) && parsed.columns.length) columns = parsed.columns;
      if (Array.isArray(parsed.groups)) groups = parsed.groups;
      resetFilters();
      saveTasks(); saveColumns(); saveGroups();
      refreshColumnSelects();
      renderBoard();
    } catch (err) { alert('Erro ao ler arquivo: ' + err.message); }
  });
}

// ============================================================
//  Account menu (topbar)
// ============================================================
function setupAccountMenu() {
  const btn  = document.getElementById('account-btn');
  const menu = document.getElementById('account-menu');
  if (!btn || !menu) return;
  btn.addEventListener('click', e => { e.stopPropagation(); menu.hidden = !menu.hidden; });
  document.addEventListener('click', e => {
    if (!e.target.closest('#account-menu') && !e.target.closest('#account-btn')) menu.hidden = true;
  });
  document.getElementById('acct-sync').addEventListener('click', async () => { menu.hidden = true; await syncNow(); });
  document.getElementById('acct-signout').addEventListener('click', async () => {
    menu.hidden = true;
    if (!confirm('Sair da sua conta? Os dados continuam salvos no Supabase.')) return;
    await signOut();
  });
}
function refreshAccountMenu() {
  const em = document.getElementById('acct-email');
  if (em) em.textContent = USER_EMAIL || '';
  const av = document.getElementById('account-btn');
  if (av) av.textContent = (USER_EMAIL ? USER_EMAIL[0] : '?').toUpperCase();
}

// ============================================================
//  Theme
// ============================================================
const STORE_THEME = 'tb_theme';
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(STORE_THEME, theme);
  const btn = document.getElementById('theme-btn');
  if (btn) btn.textContent = theme === 'dark' ? '☀' : '☾';
}
function loadTheme() {
  let theme = localStorage.getItem(STORE_THEME);
  if (!theme) theme = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  applyTheme(theme);
}

// ============================================================
//  Auth UI (email + password)
// ============================================================
let authMode = 'signin';
function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  if (!el) return;
  el.textContent = msg || '';
  el.hidden = !msg;
}
function setAuthMode(mode) {
  authMode = mode;
  document.getElementById('auth-title').textContent  = mode === 'signup' ? 'Criar conta' : 'Entrar';
  document.getElementById('auth-submit').textContent = mode === 'signup' ? 'Criar conta' : 'Entrar';
  document.getElementById('auth-toggle').textContent = mode === 'signup' ? 'Ja tenho conta - entrar' : 'Criar conta';
  showAuthError('');
}
function showAuthScreen(showForm) {
  document.getElementById('auth-screen').hidden = false;
  document.getElementById('app-root').hidden = true;
  document.getElementById('auth-loading').hidden = !!showForm;
  document.getElementById('auth-form').hidden = !showForm;
}
function hideAuthScreen() {
  document.getElementById('auth-screen').hidden = true;
  document.getElementById('app-root').hidden = false;
}
function translateAuthError(msg) {
  if (!msg) return 'Algo deu errado. Tente de novo.';
  if (/Invalid login credentials/i.test(msg)) return 'E-mail ou senha incorretos.';
  if (/already registered/i.test(msg)) return 'Esse e-mail ja tem conta. Use "Ja tenho conta - entrar".';
  if (/Password should be at least/i.test(msg)) return 'A senha precisa de pelo menos 6 caracteres.';
  if (/Email not confirmed/i.test(msg)) return 'E-mail ainda nao confirmado. Confirme pelo link ou desative a confirmacao no Supabase.';
  if (/rate limit|too many/i.test(msg)) return 'Muitas tentativas. Espere um momento e tente de novo.';
  return msg;
}
function setupAuthUI() {
  document.getElementById('auth-toggle').addEventListener('click', () => setAuthMode(authMode === 'signup' ? 'signin' : 'signup'));
  document.getElementById('auth-form').addEventListener('submit', async e => {
    e.preventDefault();
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    if (!email || !password) return;
    const submit = document.getElementById('auth-submit');
    submit.disabled = true; submit.textContent = '...'; showAuthError('');
    try {
      if (authMode === 'signup') {
        const { data, error } = await sb.auth.signUp({ email, password });
        if (error) throw error;
        if (!data.session) {
          showAuthError('Conta criada! Confirme pelo e-mail OU desative "Confirm email" no Supabase (veja o README) e entre.');
          setAuthMode('signin');
        }
      } else {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      showAuthError(translateAuthError(err && err.message));
    } finally {
      submit.disabled = false;
      if (authMode) setAuthMode(authMode);
    }
  });
}

// ============================================================
//  Login / logout lifecycle
// ============================================================
async function onLogin(session) {
  USER_ID = session.user.id;
  USER_EMAIL = session.user.email || '';
  try { if (sb.realtime && session.access_token) sb.realtime.setAuth(session.access_token); } catch (e) {}
  hideAuthScreen();
  refreshAccountMenu();
  // 1) instant paint from local cache
  loadFromCache();
  resetFilters(); noteSeen();
  refreshColumnSelects();
  renderBoard();
  // 2) fresh pull from the cloud
  setSyncStatus('saving');
  try {
    await pullAll();
    await seedIfEmpty();
    resetFilters(); noteSeen();
    refreshColumnSelects();
    renderBoard();
    setSyncStatus('synced');
  } catch (e) {
    console.error('[sync] initial pull failed', e);
    setSyncStatus('error');
  }
  // 3) live updates
  subscribeRealtime();
}
function onLogout() {
  if (rtChannel && sb) { sb.removeChannel(rtChannel); rtChannel = null; }
  cacheClearUser();
  USER_ID = null; USER_EMAIL = '';
  tasks = []; columns = []; groups = [];
  seenCols = new Set(); seenGroups = new Set();
  setAuthMode('signin');
  const em = document.getElementById('auth-email'); if (em) em.value = '';
  const pw = document.getElementById('auth-password'); if (pw) pw.value = '';
  showAuthScreen(true);
}
async function signOut() {
  try { await sb.auth.signOut(); } catch (e) {}
  // onAuthStateChange fires SIGNED_OUT -> onLogout
}

// ============================================================
//  Keyboard shortcuts
// ============================================================
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', e => {
    const root = document.getElementById('app-root');
    if (!root || root.hidden) return;
    if (document.querySelector('.modal-backdrop')) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
    if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openTaskModal(null); }
    else if (e.key === '/') { e.preventDefault(); const s = document.getElementById('search'); if (s) s.focus(); }
  });
}

// ============================================================
//  Boot
// ============================================================
let booted = false;
function setupStaticUI() {
  if (booted) return; booted = true;
  loadView();
  loadGroupBy();
  loadCollapsed();
  loadTheme();
  document.querySelectorAll('#view-switch button').forEach(b => b.classList.toggle('active', b.dataset.view === currentView));
  setupSidebar();
  setupTopbar();
  attachBoardDragHandlers();
  setupImport();
  setupAccountMenu();
  document.getElementById('theme-btn').addEventListener('click', () => {
    applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  });
  document.getElementById('add-group-side').addEventListener('click', () => openGroupModal(null));
  document.getElementById('groupby-btn').addEventListener('click', () => { groupBy = !groupBy; saveGroupBy(); renderBoard(); });
  setupKeyboardShortcuts();
}

async function boot() {
  setupStaticUI();
  if (!initSupabase()) {
    document.getElementById('auth-loading').hidden = true;
    document.getElementById('auth-form').hidden = true;
    document.getElementById('auth-config-error').hidden = false;
    document.getElementById('auth-screen').hidden = false;
    return;
  }
  setupAuthUI();
  setAuthMode('signin');
  showAuthScreen(false);              // "loading" while we check the session
  try {
    const { data } = await sb.auth.getSession();
    if (data && data.session) await onLogin(data.session);
    else showAuthScreen(true);
  } catch (e) {
    showAuthScreen(true);
  }
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' && session && !USER_ID) onLogin(session);
    else if (event === 'SIGNED_OUT') onLogout();
  });
}

boot();
