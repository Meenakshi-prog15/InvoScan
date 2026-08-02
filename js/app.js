// ─── InvoScan App — Router, State, Toasts ─────────────────────────────────────

// ─── Global State ─────────────────────────────────────────────────────────────
const AppState = {
  bills: [],
  results: {},       // { filename: { gemini: {...}, claude: {...}, gpt4o: {...} } }
  groundTruth: {},   // { filename: { vendor_name: '...', ... } }
  scores: {},        // { filename: { gemini: { vendor_name: 1, ... }, ... } }
  selectedBill: null,
  modelAvailability: { gemini: false, claude: false, gpt4o: false },
  zohoConnected: false
};
window.AppState = AppState;

// ─── Router ───────────────────────────────────────────────────────────────────
const VIEWS = ['upload', 'compare', 'evaluate', 'report'];

function showView(viewId) {
  VIEWS.forEach(v => {
    const el = document.getElementById(`view-${v}`);
    const navEl = document.getElementById(`nav-${v}`);
    if (!el || !navEl) return;
    el.classList.toggle('active', v === viewId);
    navEl.classList.toggle('active', v === viewId);
    navEl.setAttribute('aria-current', v === viewId ? 'page' : 'false');
  });

  // Trigger refresh on view switch
  if (viewId === 'compare') window.refreshCompareBillList?.();
  if (viewId === 'evaluate') window.refreshEvaluateBillList?.();
  if (viewId === 'report') window.renderReport?.();
}

// Nav button clicks
document.querySelectorAll('.nav-link[data-view]').forEach(btn => {
  btn.addEventListener('click', () => showView(btn.dataset.view));
});

// ─── API Helpers ──────────────────────────────────────────────────────────────
async function apiGet(path) {
  const r = await fetch(CONFIG.API_BASE + path);
  if (!r.ok) throw new Error(`API error ${r.status}`);
  return r.json();
}

async function apiPost(path, body) {
  const r = await fetch(CONFIG.API_BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `API error ${r.status}`);
  }
  return r.json();
}

async function apiDelete(path) {
  const r = await fetch(CONFIG.API_BASE + path, { method: 'DELETE' });
  if (!r.ok) throw new Error(`API error ${r.status}`);
  return r.json();
}

window.apiGet = apiGet;
window.apiPost = apiPost;
window.apiDelete = apiDelete;

// ─── Toast System ─────────────────────────────────────────────────────────────
function showToast(message, type = 'info', duration = 4000) {
  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}
window.showToast = showToast;

// ─── Format helpers ────────────────────────────────────────────────────────────
function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function formatLatency(ms) {
  if (!ms) return '—';
  return ms < 1000 ? ms + 'ms' : (ms / 1000).toFixed(1) + 's';
}

function formatCurrency(amount, currency = 'INR') {
  if (amount === null || amount === undefined) return '—';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(amount);
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

window.formatFileSize = formatFileSize;
window.formatLatency = formatLatency;
window.formatCurrency = formatCurrency;
window.timeAgo = timeAgo;

// ─── Server Health Check ───────────────────────────────────────────────────────
async function checkServerHealth() {
  const dot = document.getElementById('server-dot');
  const txt = document.getElementById('server-status-text');
  try {
    const data = await apiGet('/api/models');
    AppState.modelAvailability = data.availability || {};
    const available = Object.values(data.availability || {}).filter(Boolean).length;
    dot.className = available > 0 ? 'status-dot online' : 'status-dot partial';
    txt.textContent = available > 0 ? `${available} model${available > 1 ? 's' : ''} ready` : 'No API keys set';
    window.dispatchEvent(new Event('models-loaded'));
  } catch {
    dot.className = 'status-dot';
    txt.textContent = 'Server offline';
    showToast('Cannot connect to InvoScan server. Is it running?', 'error', 8000);
  }
}

// ─── Init ──────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  showView('upload');
  await checkServerHealth();
  // Load initial data
  try {
    const [billsData, resultsData, gtData] = await Promise.allSettled([
      apiGet('/api/bills'),
      apiGet('/api/results'),
      apiGet('/api/ground-truth')
    ]);
    if (billsData.status === 'fulfilled') AppState.bills = billsData.value.bills || [];
    if (resultsData.status === 'fulfilled') AppState.results = resultsData.value || {};
    if (gtData.status === 'fulfilled') AppState.groundTruth = gtData.value || {};
    window.renderBillsGallery?.();
  } catch {}
});
