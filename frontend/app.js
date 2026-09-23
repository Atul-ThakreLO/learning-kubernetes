/* global state */
const API_BASE = window.API_URL || '';
let currentFilter = 'all';
let lastSource = '—';

/* ── Utility ─────────────────────────────────────────────────────────────── */
function $(id) { return document.getElementById(id); }

function showToast(msg, type = 'info') {
  const icon = { success: '✅', error: '❌', info: 'ℹ️' }[type] || 'ℹ️';
  const t = document.createElement('div');
  t.className = `toast toast--${type}`;
  t.innerHTML = `<span>${icon}</span><span>${msg}</span>`;
  $('toastContainer').appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateX(30px)'; t.style.transition = '.3s'; setTimeout(() => t.remove(), 300); }, 3000);
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function statusBadge(s) {
  const map = { todo: ['badge-todo', '📋 To Do'], in_progress: ['badge-progress', '🔄 In Progress'], done: ['badge-done', '✅ Done'] };
  const [cls, label] = map[s] || ['badge-todo', s];
  return `<span class="badge ${cls}">${label}</span>`;
}
function priorityBadge(p) {
  const map = { low: 'badge-low', medium: 'badge-medium', high: 'badge-high' };
  const label = p.charAt(0).toUpperCase() + p.slice(1);
  return `<span class="badge ${map[p] || 'badge-medium'}">${label}</span>`;
}

/* ── API ─────────────────────────────────────────────────────────────────── */
async function apiFetch(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.json();
}

/* ── Stats ───────────────────────────────────────────────────────────────── */
async function loadStats() {
  try {
    const { data, hostname } = await apiFetch('/api/stats');
    $('statTotalVal').textContent = data.total;
    $('statTodoVal').textContent = data.todo;
    $('statProgressVal').textContent = data.in_progress;
    $('statDoneVal').textContent = data.done;
    $('statHighVal').textContent = data.high_priority;
    $('backendPod').textContent = hostname || '—';
    $('hostLabel').textContent = `Backend: ${hostname}`;
  } catch (err) {
    console.error('Stats error:', err);
    ['statTotalVal', 'statTodoVal', 'statProgressVal', 'statDoneVal', 'statHighVal'].forEach(id => $(id).textContent = '—');
  }
}

/* ── Health ──────────────────────────────────────────────────────────────── */
async function loadHealth() {
  try {
    const h = await apiFetch('/health');
    $('dbStatus').textContent = h.database || '—';
    $('redisStatus').textContent = h.redis || '—';
    $('apiVersion').textContent = h.version || '—';
    $('apiEndpoint').textContent = API_BASE;
    $('frontendPod').textContent = window.location.hostname;
  } catch (err) {
    $('dbStatus').textContent = 'error';
    $('redisStatus').textContent = 'error';
  }
}

/* ── Tasks ───────────────────────────────────────────────────────────────── */
async function loadTasks() {
  const list = $('taskList');
  list.innerHTML = `<div class="empty-state"><div class="empty-icon">⏳</div><div class="empty-text">Loading…</div></div>`;

  try {
    const url = currentFilter === 'all' ? '/api/tasks' : `/api/tasks?status=${currentFilter}`;
    const { data, source } = await apiFetch(url);
    lastSource = source;
    $('cacheSource').textContent = source;
    $('apiSource').textContent = `source: ${source}`;

    if (!data.length) {
      list.innerHTML = `<div class="empty-state"><div class="empty-icon">🎉</div><div class="empty-text">No tasks found. Create one!</div></div>`;
      return;
    }

    list.innerHTML = data.map(task => `
      <div class="task-card" id="task-${task.id}" role="article" aria-label="Task: ${task.title}">
        <div>
          <div class="task-header">
            <span class="task-title">${escHtml(task.title)}</span>
          </div>
          ${task.description ? `<div class="task-desc">${escHtml(task.description)}</div>` : ''}
          <div class="task-meta">
            ${statusBadge(task.status)}
            ${priorityBadge(task.priority)}
            <span class="task-date">${formatDate(task.created_at)}</span>
          </div>
        </div>
        <div class="task-actions">
          <button class="btn btn-ghost btn-icon" onclick="openEditModal('${task.id}')" aria-label="Edit task" title="Edit">✏️</button>
          <button class="btn btn-danger btn-icon" onclick="deleteTask('${task.id}')" aria-label="Delete task" title="Delete">🗑️</button>
        </div>
      </div>
    `).join('');
  } catch (err) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">❌</div><div class="empty-text">Failed to load tasks<br><small>${err.message}</small></div></div>`;
  }
}

function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ── Create Task ─────────────────────────────────────────────────────────── */
$('taskForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = $('taskTitle').value.trim();
  if (!title) { showToast('Title is required', 'error'); return; }

  const btn = $('submitBtn');
  btn.disabled = true;
  btn.querySelector('.btn-text').hidden = true;
  btn.querySelector('.btn-spinner').hidden = false;

  try {
    await apiFetch('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({
        title,
        description: $('taskDesc').value.trim(),
        status: $('taskStatus').value,
        priority: $('taskPriority').value,
      }),
    });
    $('taskForm').reset();
    await Promise.all([loadTasks(), loadStats()]);
    showToast('Task created!', 'success');
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.querySelector('.btn-text').hidden = false;
    btn.querySelector('.btn-spinner').hidden = true;
  }
});

/* ── Delete Task ─────────────────────────────────────────────────────────── */
async function deleteTask(id) {
  if (!confirm('Delete this task?')) return;
  try {
    await apiFetch(`/api/tasks/${id}`, { method: 'DELETE' });
    await Promise.all([loadTasks(), loadStats()]);
    showToast('Task deleted', 'info');
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

/* ── Edit Modal ──────────────────────────────────────────────────────────── */
async function openEditModal(id) {
  try {
    const { data } = await apiFetch(`/api/tasks/${id}`);
    $('editId').value = data.id;
    $('editTitle').value = data.title;
    $('editDesc').value = data.description || '';
    $('editStatus').value = data.status;
    $('editPriority').value = data.priority;
    $('editModal').hidden = false;
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

$('editForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('editId').value;
  try {
    await apiFetch(`/api/tasks/${id}`, {
      method: 'PUT',
      body: JSON.stringify({
        title: $('editTitle').value.trim(),
        description: $('editDesc').value.trim(),
        status: $('editStatus').value,
        priority: $('editPriority').value,
      }),
    });
    $('editModal').hidden = true;
    await Promise.all([loadTasks(), loadStats()]);
    showToast('Task updated!', 'success');
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
});

function closeModal() { $('editModal').hidden = true; }
$('modalClose').addEventListener('click', closeModal);
$('cancelEdit').addEventListener('click', closeModal);
$('editModal').addEventListener('click', (e) => { if (e.target === $('editModal')) closeModal(); });

/* ── Filters ─────────────────────────────────────────────────────────────── */
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    loadTasks();
  });
});

/* ── Refresh ─────────────────────────────────────────────────────────────── */
$('refreshBtn').addEventListener('click', async () => {
  $('refreshBtn').textContent = '↻ Refreshing…';
  await Promise.all([loadTasks(), loadStats(), loadHealth()]);
  $('refreshBtn').textContent = '↻ Refresh';
  showToast('Data refreshed', 'info');
});

/* ── Init ────────────────────────────────────────────────────────────────── */
(async () => {
  $('apiEndpoint').textContent = API_BASE;
  await Promise.all([loadTasks(), loadStats(), loadHealth()]);

  // Auto-refresh every 30s
  setInterval(() => { loadStats(); loadHealth(); }, 30000);
})();
