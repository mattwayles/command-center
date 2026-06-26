const PRIORITIES = ['high', 'medium', 'low'];
const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

// --- Environment detection ---
const isElectron = typeof window.api !== 'undefined';

// --- Supabase client (null if config.js placeholders not yet replaced) ---
// Named 'db' to avoid collision with the global 'supabase' exported by the CDN script
const db = (
  window.SUPABASE_URL && window.SUPABASE_URL !== 'YOUR_SUPABASE_URL' &&
  window.SUPABASE_ANON_KEY && window.supabase
) ? window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY)
  : null;

let tabDefs = [];
let activeTab = null;
let tabState  = {};
let confirmCallback = null;
let dragId = null;

// Deletions that must be removed from Supabase on next persist()
const pendingTaskDeletes = new Set();
const pendingTabDeletes  = new Set();

function showConfirm(title, msg, onConfirm) {
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-msg').textContent = msg;
  confirmCallback = onConfirm;
  document.getElementById('confirm-overlay').classList.remove('hidden');
}

function closeConfirm() {
  confirmCallback = null;
  document.getElementById('confirm-overlay').classList.add('hidden');
}

function tab()   { return tabState[activeTab] || (tabState[activeTab] = { tasks: [], filter: 'all' }); }
function tasks() { return tab().tasks; }

// --- Supabase sync ---

async function persistToSupabase() {
  if (!db) return;
  try {
    if (pendingTabDeletes.size) {
      await db.from('tabs').delete().in('id', [...pendingTabDeletes]);
      pendingTabDeletes.clear();
    }
    if (pendingTaskDeletes.size) {
      await db.from('tasks').delete().in('id', [...pendingTaskDeletes]);
      pendingTaskDeletes.clear();
    }
    // Exclude the Standup tab — it's Electron-only and never stored in Supabase
    const syncableTabs = tabDefs.filter(t => t.type !== 'trivia');
    if (syncableTabs.length) {
      await db.from('tabs').upsert(
        syncableTabs.map((t, i) => ({ id: t.id, label: t.label, type: t.type || null, sort_order: i })),
        { onConflict: 'id' }
      );
    }
    const allTasks = [];
    syncableTabs.forEach(t => {
      (tabState[t.id]?.tasks || []).forEach((task, i) => {
        allTasks.push({ id: task.id, tab_id: t.id, text: task.text, priority: task.priority, done: task.done, sort_order: i });
      });
    });
    if (allTasks.length) {
      await db.from('tasks').upsert(allTasks, { onConflict: 'id' });
    }
  } catch (err) {
    console.error('Supabase sync failed:', err);
    showToast('Sync failed: ' + err.message);
  }
}

// --- Load ---

async function load() {
  if (!db) {
    showToast('Supabase not configured — check config.js');
    render();
    return;
  }
  try {
    await loadFromSupabase();
  } catch (err) {
    console.error('Load failed:', err);
    showToast('Failed to load from cloud: ' + err.message);
  }
  render();
}

async function loadFromSupabase() {
  const [{ data: tabRows, error: tabErr }, { data: taskRows, error: taskErr }] = await Promise.all([
    db.from('tabs').select('*').order('sort_order'),
    db.from('tasks').select('*').order('sort_order'),
  ]);

  if (tabErr || taskErr) {
    showToast('Cloud load failed: ' + (tabErr || taskErr).message);
    return;
  }

  tabDefs = (tabRows || []).map(r => ({ id: r.id, label: r.label, ...(r.type ? { type: r.type } : {}) }));
  tabState = {};
  tabDefs.forEach(t => {
    tabState[t.id] = {
      tasks: (taskRows || [])
        .filter(r => r.tab_id === t.id)
        .map(r => ({ id: r.id, text: r.text, priority: r.priority, done: r.done })),
      filter: 'all',
    };
  });

  // Standup tab is Electron-only; appended in-memory, never stored in Supabase
  if (isElectron && !tabDefs.find(t => t.id === 'trivia')) {
    tabDefs.push({ id: 'trivia', label: 'Standup', type: 'trivia' });
    tabState['trivia'] = { tasks: [], filter: 'all' };
  }

  if (tabDefs.length && !tabDefs.find(t => t.id === activeTab)) activeTab = tabDefs[0].id;
}

// --- Refresh ---

async function refresh() {
  if (!db) return;
  const btn = document.getElementById('refresh-btn');
  if (btn) { btn.disabled = true; btn.classList.add('spinning'); }
  try {
    await loadFromSupabase();
  } catch (err) {
    showToast('Refresh failed: ' + err.message);
  }
  render();
}

// --- Persist ---

function persist() {
  if (db) persistToSupabase();
}

// --- Task mutations ---

function addTask(text, priority) {
  tasks().unshift({ id: Date.now(), text: text.trim(), priority, done: false });
  persist();
  render();
}

function deleteTask(id) {
  const task = tasks().find(t => t.id === id);
  if (!task) return;
  const doDelete = () => {
    tab().tasks = tabState[activeTab].tasks = tasks().filter(t => t.id !== id);
    pendingTaskDeletes.add(id);
    persist();
    render();
  };
  if (task.done) {
    doDelete();
  } else {
    showConfirm('Delete task?', `"${task.text}" isn't done yet. This cannot be undone.`, doDelete);
  }
}

function toggleDone(id) {
  const task = tasks().find(t => t.id === id);
  if (task) { task.done = !task.done; persist(); render(); }
}

function cyclePriority(id) {
  const task = tasks().find(t => t.id === id);
  if (!task) return;
  const idx = PRIORITIES.indexOf(task.priority);
  task.priority = PRIORITIES[(idx + 1) % PRIORITIES.length];
  persist();
  render();
}

function saveEdit(id, text, priority) {
  const task = tasks().find(t => t.id === id);
  if (!task) return;
  task.text = text.trim();
  task.priority = priority;
  persist();
  render();
}

function clearDone() {
  tasks().filter(t => t.done).forEach(t => pendingTaskDeletes.add(t.id));
  tabState[activeTab].tasks = tasks().filter(t => !t.done);
  persist();
  render();
}

// --- Tab mutations ---

function addTab() {
  const id = 'tab_' + Date.now();
  tabDefs.push({ id, label: 'New Tab' });
  tabState[id] = { tasks: [], filter: 'all' };
  activeTab = id;
  persist();
  render();
  startEditingTab(id);
}

function removeTab(id) {
  if (tabDefs.length <= 1) return;
  const tabDef = tabDefs.find(t => t.id === id);
  if (!tabDef) return;
  const count = tabState[id]?.tasks?.length ?? 0;
  const msg = count > 0
    ? `"${tabDef.label}" contains ${count} task${count !== 1 ? 's' : ''}. This cannot be undone.`
    : `"${tabDef.label}" will be permanently removed.`;
  showConfirm('Delete tab?', msg, () => {
    tabDefs = tabDefs.filter(t => t.id !== id);
    delete tabState[id];
    pendingTabDeletes.add(id);
    if (activeTab === id) activeTab = tabDefs[0].id;
    persist();
    render();
  });
}

function startEditingTab(id) {
  const btn = document.querySelector(`.tab[data-tab="${id}"]`);
  const labelSpan = btn?.querySelector('.tab-label');
  if (!btn || !labelSpan) return;

  const currentLabel = tabDefs.find(t => t.id === id)?.label || '';
  const input = document.createElement('input');
  input.className = 'tab-rename-input';
  input.value = currentLabel;
  labelSpan.replaceWith(input);
  input.focus();
  input.select();

  let committed = false;

  function commit() {
    if (committed) return;
    committed = true;
    const tabDef = tabDefs.find(t => t.id === id);
    if (tabDef) tabDef.label = input.value.trim() || currentLabel;
    persist();
    render();
  }

  function cancel() {
    if (committed) return;
    committed = true;
    render();
  }

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });
}

// --- Render ---

function visibleTasks() {
  const f = tab().filter;
  let items = tasks();
  if (f === 'active') items = items.filter(t => !t.done);
  if (f === 'done')   items = items.filter(t => t.done);
  return [...items].sort((a, b) => (a.done - b.done) || (PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]));
}

function isTrivaTab() {
  return !!tabDefs.find(t => t.id === activeTab && t.type === 'trivia');
}

function setTriviaMode(on) {
  document.querySelector('.filter-bar').style.display    = on ? 'none' : '';
  document.querySelector('.input-row').style.display     = on ? 'none' : '';
  document.getElementById('todo-list').style.display     = on ? 'none' : '';
  document.querySelector('.footer').style.display        = on ? 'none' : '';
  document.getElementById('trivia-panel').style.display  = on ? 'flex'  : 'none';
}

function render() {
  renderTabs();
  const trivia = isTrivaTab();
  setTriviaMode(trivia);
  if (!trivia) {
    renderFilters();
    renderList();
    renderFooter();
  }
}

function renderTabs() {
  const tabBar = document.querySelector('.tab-bar');
  tabBar.innerHTML = '';

  tabDefs.forEach(tabDef => {
    const btn = document.createElement('button');
    btn.className = 'tab' + (tabDef.id === activeTab ? ' active' : '');
    btn.dataset.tab = tabDef.id;

    const labelSpan = document.createElement('span');
    labelSpan.className = 'tab-label';
    labelSpan.textContent = tabDef.label;
    btn.appendChild(labelSpan);

    if (tabDefs.length > 1) {
      const x = document.createElement('span');
      x.className = 'tab-close';
      x.textContent = '×';
      x.title = 'Remove tab';
      btn.appendChild(x);
    }

    tabBar.appendChild(btn);
  });

  const addBtn = document.createElement('button');
  addBtn.className = 'tab-add';
  addBtn.textContent = '+';
  addBtn.title = 'New tab';
  tabBar.appendChild(addBtn);

  const refreshBtn = document.createElement('button');
  refreshBtn.id = 'refresh-btn';
  refreshBtn.className = 'tab-refresh';
  refreshBtn.textContent = '↺';
  refreshBtn.title = 'Refresh from cloud';
  tabBar.appendChild(refreshBtn);
}

function renderFilters() {
  const f = tab().filter;
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === f);
  });
}

function onDragStart(e) {
  dragId = Number(e.currentTarget.dataset.id);
  e.dataTransfer.effectAllowed = 'move';
  requestAnimationFrame(() => e.currentTarget.classList.add('dragging'));
}

function onDragEnd(e) {
  e.currentTarget.classList.remove('dragging');
  document.querySelectorAll('.drag-over-before, .drag-over-after').forEach(el =>
    el.classList.remove('drag-over-before', 'drag-over-after'));
  dragId = null;
}

function onDragOver(e) {
  if (dragId === null) return;
  const targetId = Number(e.currentTarget.dataset.id);
  if (targetId === dragId) return;
  const arr = tasks();
  const dragged = arr.find(t => t.id === dragId);
  const target  = arr.find(t => t.id === targetId);
  if (!dragged || !target || dragged.priority !== target.priority || dragged.done !== target.done) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('.drag-over-before, .drag-over-after').forEach(el =>
    el.classList.remove('drag-over-before', 'drag-over-after'));
  const rect = e.currentTarget.getBoundingClientRect();
  e.currentTarget.classList.add(e.clientY < rect.top + rect.height / 2 ? 'drag-over-before' : 'drag-over-after');
}

function onDragLeave(e) {
  if (!e.currentTarget.contains(e.relatedTarget))
    e.currentTarget.classList.remove('drag-over-before', 'drag-over-after');
}

function onDrop(e) {
  e.preventDefault();
  const targetId = Number(e.currentTarget.dataset.id);
  document.querySelectorAll('.drag-over-before, .drag-over-after').forEach(el =>
    el.classList.remove('drag-over-before', 'drag-over-after'));
  if (dragId === null || dragId === targetId) return;
  const arr = tasks();
  const dragged = arr.find(t => t.id === dragId);
  const target  = arr.find(t => t.id === targetId);
  if (!dragged || !target || dragged.priority !== target.priority || dragged.done !== target.done) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const insertBefore = e.clientY < rect.top + rect.height / 2;
  arr.splice(arr.indexOf(dragged), 1);
  arr.splice(insertBefore ? arr.indexOf(target) : arr.indexOf(target) + 1, 0, dragged);
  persist();
  render();
}

function renderList() {
  const list = document.getElementById('todo-list');
  const items = visibleTasks();
  const f = tab().filter;

  if (items.length === 0) {
    list.innerHTML = `<li class="empty-state"><span class="icon">✓</span><span>${
      f === 'done'   ? 'No completed tasks yet' :
      f === 'active' ? 'Nothing left to do!' :
      'Add your first task above'
    }</span></li>`;
    return;
  }

  list.innerHTML = '';
  items.forEach(task => {
    const li = document.createElement('li');
    li.className = 'todo-item' + (task.done ? ' done' : '');
    li.dataset.priority = task.priority;
    li.dataset.id = task.id;
    li.setAttribute('draggable', 'true');
    li.innerHTML = `
      <button class="todo-check" data-id="${task.id}" title="Toggle done"></button>
      <button class="priority-cycle" data-id="${task.id}" title="Cycle priority">
        <span class="priority-dot ${task.priority}"></span>
      </button>
      <span class="todo-text">${escapeHtml(task.text)}</span>
      <div class="todo-actions">
        <button class="action-btn edit" data-id="${task.id}" title="Edit">✎</button>
        <button class="action-btn delete" data-id="${task.id}" title="Delete">✕</button>
      </div>
    `;
    li.addEventListener('dragstart', onDragStart);
    li.addEventListener('dragend',   onDragEnd);
    li.addEventListener('dragover',  onDragOver);
    li.addEventListener('dragleave', onDragLeave);
    li.addEventListener('drop',      onDrop);
    list.appendChild(li);
  });
}

function renderFooter() {
  const active = tasks().filter(t => !t.done).length;
  document.getElementById('count-label').textContent =
    `${active} task${active !== 1 ? 's' : ''} remaining`;
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
            .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// --- Modal ---

let editingId = null;

function openEditModal(id) {
  const task = tasks().find(t => t.id === id);
  if (!task) return;
  editingId = id;
  document.getElementById('edit-input').value = task.text;
  document.getElementById('edit-priority').value = task.priority;
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('edit-input').focus();
}

function closeModal() {
  editingId = null;
  document.getElementById('modal-overlay').classList.add('hidden');
}

function confirmEdit() {
  const text = document.getElementById('edit-input').value.trim();
  if (!text || editingId === null) { closeModal(); return; }
  saveEdit(editingId, document.getElementById('edit-input').value.trim(),
           document.getElementById('edit-priority').value);
  closeModal();
}

// --- Event wiring ---

document.querySelector('.tab-bar').addEventListener('click', e => {
  const closeBtn   = e.target.closest('.tab-close');
  const addBtn     = e.target.closest('.tab-add');
  const refreshBtn = e.target.closest('.tab-refresh');
  const tabBtn     = e.target.closest('.tab');

  if (closeBtn)   { removeTab(closeBtn.closest('.tab').dataset.tab); return; }
  if (addBtn)     { addTab(); return; }
  if (refreshBtn) { refresh(); return; }
  if (tabBtn)     { activeTab = tabBtn.dataset.tab; render(); }
});

document.querySelector('.tab-bar').addEventListener('dblclick', e => {
  const tabBtn = e.target.closest('.tab');
  if (tabBtn && !e.target.closest('.tab-close')) startEditingTab(tabBtn.dataset.tab);
});

document.getElementById('add-btn').addEventListener('click', () => {
  const input = document.getElementById('new-todo');
  const text = input.value.trim();
  if (!text) return;
  addTask(text, document.getElementById('priority-select').value);
  input.value = '';
  input.focus();
});

document.getElementById('new-todo').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('add-btn').click();
});

document.getElementById('todo-list').addEventListener('click', e => {
  const checkBtn = e.target.closest('.todo-check');
  const cycleBtn = e.target.closest('.priority-cycle');
  const editBtn  = e.target.closest('.edit');
  const delBtn   = e.target.closest('.delete');

  if (checkBtn) return toggleDone(Number(checkBtn.dataset.id));
  if (cycleBtn) return cyclePriority(Number(cycleBtn.dataset.id));
  if (editBtn)  return openEditModal(Number(editBtn.dataset.id));
  if (delBtn)   return deleteTask(Number(delBtn.dataset.id));
});

document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    tab().filter = btn.dataset.filter;
    render();
  });
});

document.getElementById('clear-done-btn').addEventListener('click', clearDone);

function extractStandupContent(raw) {
  const lines = raw.split('\n');
  const isSkippable = t =>
    !t ||
    /^warning:/i.test(t) ||
    /standup posted/i.test(t) ||
    /here.s what/i.test(t) ||
    /^---+$/.test(t);
  let start = 0;
  while (start < lines.length && isSkippable(lines[start].trim())) start++;
  return lines.slice(start).join('\n').trim();
}

function processInline(raw) {
  let s = escapeHtml(raw);
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');
  s = s.replace(/\b([A-Z]+-\d+)(\s*\(MR\s+[!#]?\d+\))?/g,
    (_, ticket, mr) => `<strong class="ticket">${ticket}${mr || ''}</strong>`);
  s = s.replace(/\bPending Review\b/g, '<span class="s-review">Pending Review</span>');
  s = s.replace(/\bIn Review\b/g, '<span class="s-review">In Review</span>');
  s = s.replace(/\bIn Progress\b/g, '<span class="s-progress">In Progress</span>');
  s = s.replace(/\bCompleted?\b/g, m => `<span class="s-done">${m}</span>`);
  s = s.replace(/\bBlocked?\b/g, m => `<span class="s-blocked">${m}</span>`);
  return s;
}

function splitIntoItems(content) {
  const ticketRe = /\b[A-Z]+-\d+\b/g;
  const positions = [];
  let m;
  while ((m = ticketRe.exec(content)) !== null) positions.push(m.index);

  if (positions.length <= 1) return [content.trim()];

  const splits = [positions[0]];
  for (let i = 1; i < positions.length; i++) {
    const preceding = content.slice(0, positions[i]);
    const boundary =
      /[.;!?]\s+$/.test(preceding) ||
      /,\s+(?:and\s+|or\s+)?$/.test(preceding);
    if (boundary) splits.push(positions[i]);
  }

  return splits.map((start, i) =>
    content.slice(start, splits[i + 1] ?? content.length)
      .trim().replace(/[,;]\s*$/, '')
  ).filter(Boolean);
}

function normalizeSectionName(raw) {
  return raw.replace(/^[^a-zA-Z]+/, '').trim();
}

function cardClass(sectionName) {
  const n = normalizeSectionName(sectionName).toLowerCase();
  if (n.includes('yesterday')) return 'card-yesterday';
  if (n.includes('today') || n.includes('tomorrow')) return 'card-today';
  if (n.includes('blocker')) return 'card-blocker';
  return 'card-other';
}

function sectionEmoji(sectionName) {
  const n = normalizeSectionName(sectionName).toLowerCase();
  if (n.includes('yesterday')) return '✅';
  if (n.includes('today'))     return '🎯';
  if (n.includes('tomorrow'))  return '🔭';
  if (n.includes('blocker'))   return '🚫';
  return '';
}

function renderStandupHTML(text) {
  const lines = text.split('\n');
  let html = '';
  let currentCard = null;

  const flushCard = () => {
    if (!currentCard) return;
    const cls = cardClass(currentCard.name);
    const emoji = sectionEmoji(currentCard.name);
    html += `<div class="standup-card ${cls}">`;
    html += `<div class="standup-section">${emoji ? emoji + ' ' : ''}${escapeHtml(normalizeSectionName(currentCard.name))}:</div>`;
    if (currentCard.items.length) {
      html += '<ul>' + currentCard.items.map(i => `<li>${processInline(i)}</li>`).join('') + '</ul>';
    }
    html += '</div>';
    currentCard = null;
  };

  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;

    if (/^---+$/.test(t)) { flushCard(); html += '<hr>'; continue; }

    const boldHm = t.match(/^\*\*_?([^*_]+?)_?\*\*:?\s*$/);
    if (boldHm) {
      flushCard();
      currentCard = { name: boldHm[1].replace(/:$/, '').trim(), items: [] };
      continue;
    }

    const inlineHm = t.match(/^\*\*([^*]+?):\*\*\s+(.+)/);
    if (inlineHm) {
      flushCard();
      const cls = cardClass(inlineHm[1]);
      const emoji = sectionEmoji(inlineHm[1]);
      html += `<div class="standup-card ${cls}">`;
      html += `<div class="standup-section">${emoji ? emoji + ' ' : ''}${escapeHtml(normalizeSectionName(inlineHm[1]))}:</div>`;
      const items = splitIntoItems(inlineHm[2]);
      html += '<ul>' + items.map(i => `<li>${processInline(i)}</li>`).join('') + '</ul>';
      html += '</div>';
      continue;
    }

    const flatHm = t.match(/^(Yesterday|Today|Blockers?|Tomorrow)\s*:\s*(.+)/i);
    if (flatHm) {
      flushCard();
      const cls = cardClass(flatHm[1]);
      const emoji = sectionEmoji(flatHm[1]);
      html += `<div class="standup-card ${cls}">`;
      html += `<div class="standup-section">${emoji ? emoji + ' ' : ''}${escapeHtml(normalizeSectionName(flatHm[1]))}:</div>`;
      const items = splitIntoItems(flatHm[2]);
      html += '<ul>' + items.map(i => `<li>${processInline(i)}</li>`).join('') + '</ul>';
      html += '</div>';
      continue;
    }

    const lm = t.match(/^[-*]\s+(.+)/);
    if (lm) {
      if (currentCard) { currentCard.items.push(lm[1]); }
      else { html += `<ul><li>${processInline(lm[1])}</li></ul>`; }
      continue;
    }

    flushCard();
    html += `<p>${processInline(t)}</p>`;
  }

  flushCard();
  return html;
}

function clearTriviaMaster() {
  document.getElementById('trivia-master-check').checked = false;
  document.getElementById('trivia-master-banner').style.display = 'none';
}

function showClearBtn() { document.getElementById('standup-clear-btn').style.display = ''; }
function hideClearBtn() { document.getElementById('standup-clear-btn').style.display = 'none'; }

document.getElementById('standup-clear-btn').addEventListener('click', () => {
  document.getElementById('standup-output').style.display = 'none';
  document.getElementById('standup-output').innerHTML = '';
  document.getElementById('trivia-results').style.display = 'none';
  document.getElementById('trivia-results').innerHTML = '';
  document.getElementById('trivia-filtered').style.display = 'none';
  hideClearBtn();
});

document.getElementById('trivia-master-check').addEventListener('change', e => {
  document.getElementById('trivia-master-banner').style.display = e.target.checked ? '' : 'none';
});

document.getElementById('standup-btn').addEventListener('click', async () => {
  clearTriviaMaster();
  const btn = document.getElementById('standup-btn');
  btn.disabled = true;
  btn.textContent = 'Loading…';

  const standupEl  = document.getElementById('standup-output');
  const triviaEl   = document.getElementById('trivia-results');
  const filteredEl = document.getElementById('trivia-filtered');

  triviaEl.innerHTML = '';
  triviaEl.style.display = 'none';
  filteredEl.style.display = 'none';
  hideClearBtn();
  standupEl.innerHTML = '<p class="standup-loading">Generating standup…</p>';
  standupEl.style.display = '';

  try {
    const output = await window.api.sendStandup();
    const content = extractStandupContent(output || '');
    standupEl.innerHTML = content ? renderStandupHTML(content) : '<p>(no output)</p>';
    showClearBtn();
    showToast('Standup sent!');
  } catch (err) {
    standupEl.style.display = 'none';
    showToast('Standup failed: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Get Standup';
  }
});

document.getElementById('confirm-ok').addEventListener('click', () => {
  const cb = confirmCallback;
  closeConfirm();
  if (cb) cb();
});
document.getElementById('confirm-cancel').addEventListener('click', closeConfirm);
document.getElementById('confirm-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('confirm-overlay')) closeConfirm();
});

document.getElementById('modal-save').addEventListener('click', confirmEdit);
document.getElementById('modal-cancel').addEventListener('click', closeModal);
document.getElementById('modal-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
});
document.getElementById('edit-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') confirmEdit();
  if (e.key === 'Escape') closeModal();
});

let toastTimer = null;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3000);
}

// --- Trivia ---

function parseTriviaOutput(text, requestedAmount) {
  const questions = [];
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.trim().split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 3) continue;
    const hm = lines[0].match(/^\*\*\d+\.\*\*\s+(.+?)\s+·\s+(.+?)\s*$/);
    if (!hm) continue;
    const qLine = lines.find(l => l.startsWith('Q:'));
    const aLine = lines.find(l => l.startsWith('A:'));
    if (!qLine || !aLine) continue;
    questions.push({
      category:   hm[1].trim(),
      difficulty: hm[2].trim().toLowerCase(),
      question:   qLine.slice(2).trim(),
      answer:     aLine.slice(2).trim(),
    });
  }
  return { questions, filteredCount: Math.max(0, requestedAmount - questions.length) };
}

function renderTriviaResults(questions, filteredCount) {
  const filteredEl = document.getElementById('trivia-filtered');
  const resultsEl  = document.getElementById('trivia-results');

  if (filteredCount > 0) {
    filteredEl.textContent = `${filteredCount} question${filteredCount !== 1 ? 's' : ''} filtered out`;
    filteredEl.style.display = '';
  } else {
    filteredEl.style.display = 'none';
  }

  resultsEl.innerHTML = '';
  if (questions.length === 0) {
    resultsEl.innerHTML = '<p class="trivia-empty">No questions to display.</p>';
    return;
  }
  questions.forEach(q => {
    const card = document.createElement('div');
    card.className = 'trivia-card';
    card.dataset.difficulty = q.difficulty;
    card.innerHTML = `
      <div class="trivia-card-header">
        <span class="trivia-category">${escapeHtml(q.category)}</span>
        <span class="trivia-difficulty ${escapeHtml(q.difficulty)}">${escapeHtml(q.difficulty)}</span>
      </div>
      <div class="trivia-question">${escapeHtml(q.question)}</div>
      <div class="trivia-answer">${escapeHtml(q.answer)}</div>
    `;
    resultsEl.appendChild(card);
  });
}

document.getElementById('trivia-btn').addEventListener('click', async () => {
  clearTriviaMaster();
  const btn    = document.getElementById('trivia-btn');
  const amount = parseInt(document.getElementById('trivia-amount').value, 10) || 10;
  if (amount < 1 || amount > 50) { showToast('Enter a number between 1 and 50'); return; }
  btn.disabled = true;
  btn.textContent = 'Loading…';

  const standupEl = document.getElementById('standup-output');
  standupEl.style.display = 'none';
  const triviaResultsEl = document.getElementById('trivia-results');
  triviaResultsEl.style.display = '';
  triviaResultsEl.innerHTML = '';
  document.getElementById('trivia-filtered').style.display = 'none';
  hideClearBtn();

  try {
    const output = await window.api.runTrivia(amount);
    const { questions, filteredCount } = parseTriviaOutput(output, amount);
    renderTriviaResults(questions, filteredCount);
    showClearBtn();
  } catch (err) {
    showToast('Trivia failed: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Get Trivia';
  }
});

document.getElementById('trivia-amount').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('trivia-btn').click();
});

// --- Boot ---
load();
