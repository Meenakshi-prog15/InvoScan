// ─── InvoScan Zoho Books Module ────────────────────────────────────────────────

const zohoModal = document.getElementById('zoho-modal');
const zohoModalBody = document.getElementById('zoho-modal-body');
const zohoModalModelSelect = document.getElementById('zoho-modal-model-select');
const zohoModalConfirm = document.getElementById('zoho-modal-confirm');
const zohoModalCancel = document.getElementById('zoho-modal-cancel');

let zohoModalBill = null;
let zohoModalSelectedModel = null;

// ─── Open Zoho Modal ──────────────────────────────────────────────────────────
function openZohoModal(filename, preselectedModel) {
  zohoModalBill = filename;
  const results = AppState.results[filename] || {};
  const availableModels = Object.keys(results).filter(k => k !== 'extractedAt' && results[k]?.success);

  if (!availableModels.length) {
    showToast('No successful extractions for this bill. Run extraction first.', 'warning');
    return;
  }

  zohoModalSelectedModel = preselectedModel || availableModels[0];
  document.getElementById('zoho-modal-title').textContent = `📤 Create Zoho Expense — ${filename}`;
  zohoModalBody.textContent = 'Select which model\'s extraction to use for the Zoho Books expense entry:';

  zohoModalModelSelect.innerHTML = availableModels.map(m => {
    const model = CONFIG.MODELS[m];
    const d = results[m].data || {};
    return `
      <label style="display:flex;align-items:center;gap:10px;padding:12px;border-radius:var(--radius-sm);
                    border:1px solid var(--border);cursor:pointer;transition:all var(--transition);"
             class="zoho-model-option">
        <input type="radio" name="zoho-model" value="${m}"
               ${m === zohoModalSelectedModel ? 'checked' : ''}
               style="accent-color:${model?.color || '#00D4FF'};" />
        <span style="font-size:18px;">${model?.icon || '🤖'}</span>
        <div style="flex:1;">
          <div style="font-size:13px;font-weight:700;">${model?.name || m}</div>
          <div style="font-size:12px;color:var(--text-muted);">
            ${d.vendor_name ? '🏪 ' + d.vendor_name : ''}
            ${d.amount_total ? ' · ₹' + d.amount_total : ''}
            ${d.date ? ' · ' + d.date : ''}
          </div>
        </div>
      </label>`;
  }).join('');

  zohoModalModelSelect.querySelectorAll('input[type=radio]').forEach(r => {
    r.addEventListener('change', () => zohoModalSelectedModel = r.value);
  });

  zohoModal.classList.add('open');
}
window.openZohoModal = openZohoModal;

zohoModalCancel.addEventListener('click', () => zohoModal.classList.remove('open'));
zohoModal.addEventListener('click', e => { if (e.target === zohoModal) zohoModal.classList.remove('open'); });

zohoModalConfirm.addEventListener('click', async () => {
  zohoModal.classList.remove('open');
  if (!zohoModalBill || !zohoModalSelectedModel) return;

  const extractedData = AppState.results[zohoModalBill]?.[zohoModalSelectedModel]?.data;
  if (!extractedData) { showToast('No extraction data found', 'error'); return; }

  await createZohoExpense(zohoModalBill, zohoModalSelectedModel, extractedData);
});

// ─── Create Zoho Expense ──────────────────────────────────────────────────────
async function createZohoExpense(filename, modelKey, extractedData) {
  showToast(`Creating Zoho expense from ${CONFIG.MODELS[modelKey]?.name}…`, 'info');
  const log = document.getElementById('zoho-export-log');

  try {
    const result = await apiPost('/api/zoho/expense', {
      extractedData,
      billFilename: filename
    });

    if (result.success) {
      showToast(`✅ Zoho expense created! ID: ${result.expenseId}`, 'success', 6000);
      if (log) {
        log.innerHTML += `<div style="color:var(--accent-green);margin-bottom:4px;">
          ✅ ${filename} → Expense ${result.expenseId}
          <a href="${result.zohoUrl}" target="_blank" style="color:var(--accent-blue);margin-left:8px;">View in Zoho ↗</a>
        </div>`;
      }
    } else {
      throw new Error(result.error);
    }
  } catch (err) {
    showToast(`Zoho export failed: ${err.message}`, 'error');
    if (log) {
      log.innerHTML += `<div style="color:var(--accent-red);margin-bottom:4px;">❌ ${filename} — ${err.message}</div>`;
    }
  }
}
window.createZohoExpense = createZohoExpense;

// ─── Test Zoho Connection ──────────────────────────────────────────────────────
async function testZohoConnection() {
  const statusEl = document.getElementById('zoho-connection-status');
  statusEl.className = 'zoho-status checking';
  statusEl.innerHTML = '<span>🔄</span> Testing connection…';

  try {
    const data = await apiGet('/api/zoho/test');
    AppState.zohoConnected = data.connected;
    if (data.connected) {
      statusEl.className = 'zoho-status connected';
      statusEl.innerHTML = '<span>✅</span> Zoho Books connected';
      showToast('Zoho Books connected!', 'success');
    } else {
      statusEl.className = 'zoho-status error';
      statusEl.innerHTML = `<span>❌</span> ${data.reason || 'Not connected'}`;
    }
  } catch (err) {
    statusEl.className = 'zoho-status error';
    statusEl.innerHTML = `<span>❌</span> Connection failed: ${err.message}`;
  }
}

// ─── Export All Bills to Zoho ─────────────────────────────────────────────────
async function exportAllToZoho() {
  const bills = AppState.bills;
  const log = document.getElementById('zoho-export-log');
  let sent = 0;

  for (const bill of bills) {
    const results = AppState.results[bill.filename];
    if (!results) continue;
    // Pick best available model - check all models in priority order
    const mKey = ['nvidia', 'claude', 'gemini', 'gpt4o', 'groq', 'openrouter'].find(m => results[m]?.success);
    if (!mKey) continue;
    await createZohoExpense(bill.filename, mKey, results[mKey].data);
    sent++;
    await new Promise(r => setTimeout(r, 500)); // Rate limit
  }

  if (!sent) showToast('No bills with extraction results to export', 'warning');
  else showToast(`Exported ${sent} expense(s) to Zoho Books`, 'success');
}

// Wire up buttons
document.getElementById('test-zoho-btn')?.addEventListener('click', testZohoConnection);
document.getElementById('export-all-zoho-btn')?.addEventListener('click', exportAllToZoho);
