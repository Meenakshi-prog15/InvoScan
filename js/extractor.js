// ─── InvoScan Extractor Module ─────────────────────────────────────────────────

const extractBtn = document.getElementById('extract-btn');
const modelCheckboxes = document.getElementById('model-checkboxes');
const comparePlaceholder = document.getElementById('compare-placeholder');
const compareResults = document.getElementById('compare-results');
const modelResultsGrid = document.getElementById('model-results-grid');
const compareBillName = document.getElementById('compare-bill-name');
const compareTimestamp = document.getElementById('compare-timestamp');
const compareBillSelector = document.getElementById('compare-bill-selector');
const compareBillPreview = document.getElementById('compare-bill-preview');
const compareNoPreview = document.getElementById('compare-no-preview');

let currentExtractionBill = null;
let pendingExtractionBill = null; // for redaction modal

// ─── Build model checkboxes ───────────────────────────────────────────────────
function renderModelCheckboxes() {
  modelCheckboxes.innerHTML = Object.values(CONFIG.MODELS).map(m => {
    const available = AppState.modelAvailability[m.key];
    return `
      <label style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:var(--radius-sm);
                    border:1px solid ${available ? 'var(--border)' : 'var(--border)'};
                    cursor:${available ? 'pointer' : 'not-allowed'};
                    opacity:${available ? '1' : '0.5'};
                    transition:all var(--transition);"
             class="model-checkbox-row"
             title="${available ? m.name : m.name + ' — API key not set'}">
        <input type="checkbox" class="model-chk" value="${m.key}"
               ${available ? 'checked' : ''} ${available ? '' : 'disabled'}
               style="accent-color:${m.color};width:16px;height:16px;" />
        <span style="font-size:18px;">${m.icon}</span>
        <div style="flex:1;">
          <div style="font-size:13px;font-weight:600;color:var(--text-primary);">${m.name}</div>
          <div style="font-size:11px;color:var(--text-muted);">${m.provider} · $${m.costPerImage.toFixed(5)}/bill</div>
        </div>
        ${available
          ? '<span style="font-size:10px;color:var(--accent-green);font-weight:700;">READY</span>'
          : '<span style="font-size:10px;color:var(--accent-red);font-weight:700;">NO KEY</span>'}
      </label>`;
  }).join('');

  document.querySelectorAll('.model-chk').forEach(chk => {
    chk.addEventListener('change', updateExtractBtnState);
  });
}

function getSelectedModels() {
  return Array.from(document.querySelectorAll('.model-chk:checked')).map(c => c.value);
}

function updateExtractBtnState() {
  const hasBill = !!currentExtractionBill;
  const hasModels = getSelectedModels().length > 0;
  extractBtn.disabled = !(hasBill && hasModels);
}

// ─── Bill selector in Compare view ────────────────────────────────────────────
function refreshCompareBillList() {
  renderModelCheckboxes();
  const bills = AppState.bills;
  if (!bills.length) {
    compareBillSelector.innerHTML = `
      <div class="empty-state" style="padding:20px;">
        <div style="font-size:24px;">📤</div>
        <p style="font-size:12px;color:var(--text-muted);">Upload bills first</p>
      </div>`;
    return;
  }

  compareBillSelector.innerHTML = bills.map(bill => {
    const isActive = currentExtractionBill === bill.filename;
    return `
      <div class="bill-selector-item ${isActive ? 'active' : ''}"
           onclick="selectCompareBill('${bill.filename}')"
           data-filename="${bill.filename}">
        <img src="${CONFIG.API_BASE}/bills/${bill.filename}" alt="" style="border-radius:4px;width:36px;height:36px;object-fit:cover;"
             onerror="this.style.display='none'" />
        <div style="flex:1;overflow:hidden;">
          <div class="truncate" style="font-size:12px;font-weight:500;">${bill.filename}</div>
          <div style="font-size:11px;color:var(--text-muted);">${formatFileSize(bill.size)}</div>
        </div>
        ${AppState.results[bill.filename] ? '<span style="font-size:10px;color:var(--accent-blue);">⚡</span>' : ''}
      </div>`;
  }).join('');
}
window.refreshCompareBillList = refreshCompareBillList;

function selectCompareBill(filename) {
  currentExtractionBill = filename;
  AppState.selectedBill = filename;

  // Update selector UI
  document.querySelectorAll('.bill-selector-item').forEach(el => {
    el.classList.toggle('active', el.dataset.filename === filename);
  });

  // Show preview
  compareBillPreview.src = `${CONFIG.API_BASE}/bills/${filename}`;
  compareBillPreview.classList.remove('hidden');
  compareNoPreview.classList.add('hidden');

  // If we already have results for this bill, show them
  if (AppState.results[filename]) {
    renderExtractionResults(filename, AppState.results[filename]);
  } else {
    comparePlaceholder.classList.remove('hidden');
    compareResults.classList.add('hidden');
  }

  updateExtractBtnState();
}
window.selectCompareBill = selectCompareBill;

// ─── Extract Button ────────────────────────────────────────────────────────────
extractBtn.addEventListener('click', () => {
  if (!currentExtractionBill) return;
  // Show redaction modal
  pendingExtractionBill = currentExtractionBill;
  document.getElementById('redaction-modal').classList.add('open');
});

document.getElementById('redaction-cancel-btn').addEventListener('click', () => {
  document.getElementById('redaction-modal').classList.remove('open');
  pendingExtractionBill = null;
});

document.getElementById('redaction-confirm-btn').addEventListener('click', async () => {
  document.getElementById('redaction-modal').classList.remove('open');
  if (!pendingExtractionBill) return;
  await runExtraction(pendingExtractionBill);
  pendingExtractionBill = null;
});

// ─── Run extraction ────────────────────────────────────────────────────────────
async function runExtraction(filename) {
  const models = getSelectedModels();
  if (!models.length) { showToast('Select at least one model', 'warning'); return; }

  // Show loading state in all model cards
  comparePlaceholder.classList.add('hidden');
  compareResults.classList.remove('hidden');
  compareBillName.textContent = filename;
  compareTimestamp.textContent = 'Extracting…';

  modelResultsGrid.innerHTML = models.map(m => {
    const model = CONFIG.MODELS[m];
    return `
      <div class="model-card" id="model-card-${m}">
        <div class="model-card-header">
          <div class="model-badge ${m}">${model.icon}</div>
          <div>
            <div class="model-card-name">${model.name}</div>
            <div class="model-card-cost">${model.provider}</div>
          </div>
          <span class="model-status loading" id="status-${m}">⏳ Running</span>
        </div>
        <div class="model-card-body">
          <div class="loading-state">
            <div class="spinner"></div>
            <span>Sending to ${model.name}…</span>
          </div>
        </div>
      </div>`;
  }).join('');

  extractBtn.disabled = true;
  extractBtn.innerHTML = '<span>⏳</span> Extracting…';

  try {
    const data = await apiPost('/api/extract', { filename, models });
    AppState.results[filename] = data.results || {};
    compareTimestamp.textContent = `Extracted at ${new Date().toLocaleTimeString()}`;
    renderExtractionResults(filename, data.results || {});
    showToast('Extraction complete!', 'success');
    window.renderBillsGallery?.();
  } catch (err) {
    showToast('Extraction failed: ' + err.message, 'error');
    compareTimestamp.textContent = 'Extraction failed';
  } finally {
    extractBtn.disabled = false;
    extractBtn.innerHTML = '<span>⚡</span> Run Extraction';
    updateExtractBtnState();
  }
}

// ─── Render extraction results ─────────────────────────────────────────────────
function renderExtractionResults(filename, results) {
  comparePlaceholder.classList.add('hidden');
  compareResults.classList.remove('hidden');
  compareBillName.textContent = filename;
  compareBillSelector.querySelectorAll('.bill-selector-item').forEach(el => {
    el.classList.toggle('active', el.dataset.filename === filename);
  });

  const modelKeys = Object.keys(results).filter(k => k !== 'extractedAt');

  if (!modelKeys.length) {
    modelResultsGrid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><div class="empty-state-icon">❌</div><h3>No results</h3><p>Extraction returned no data</p></div>`;
    return;
  }

  modelResultsGrid.innerHTML = modelKeys.map(mKey => {
    const res = results[mKey];
    const model = CONFIG.MODELS[mKey] || { name: mKey, icon: '🤖', color: '#999' };

    if (!res.success) {
      return `
        <div class="model-card" id="model-card-${mKey}">
          <div class="model-card-header">
            <div class="model-badge ${mKey}">${model.icon}</div>
            <div>
              <div class="model-card-name">${model.name}</div>
              <div class="model-card-cost">${res.latencyMs ? formatLatency(res.latencyMs) : ''}</div>
            </div>
            <span class="model-status error">❌ Error</span>
          </div>
          <div class="model-card-body">
            <div style="color:var(--accent-red);font-size:13px;padding:12px;background:rgba(248,113,113,0.06);border-radius:var(--radius-sm);">
              ${res.error || 'Unknown error'}
            </div>
          </div>
        </div>`;
    }

    const d = res.data || {};
    const confidenceClass = d.confidence || 'medium';

    return `
      <div class="model-card" id="model-card-${mKey}">
        <div class="model-card-header">
          <div class="model-badge ${mKey}">${model.icon}</div>
          <div>
            <div class="model-card-name">${model.name}</div>
            <div class="model-card-cost">${formatLatency(res.latencyMs)} · $${(res.costPerImage || 0).toFixed(5)}</div>
          </div>
          <span class="model-status success">✅ Done</span>
        </div>
        <div class="model-card-body">
          <div class="flex-between mb-4" style="flex-wrap:wrap;gap:8px;">
            <span class="confidence-badge ${confidenceClass}">
              ${confidenceClass === 'high' ? '🟢' : confidenceClass === 'medium' ? '🟡' : '🔴'}
              ${confidenceClass} confidence
            </span>
          </div>
          <div class="field-list">
            ${renderFieldList(d, filename, mKey)}
          </div>
          ${d.line_items && d.line_items.length ? renderLineItems(d.line_items) : ''}
          ${d.notes ? `<div style="margin-top:12px;padding:10px;background:var(--bg-glass-light);border-radius:var(--radius-sm);font-size:12px;color:var(--text-secondary);">📝 ${d.notes}</div>` : ''}
          <div class="flex gap-2 mt-4">
            <button class="btn btn-secondary btn-sm" onclick="prefillGroundTruth('${filename}', '${mKey}')">
              📋 Use as Ground Truth
            </button>
            <button class="btn btn-secondary btn-sm" onclick="openZohoModal('${filename}', '${mKey}')">
              📤 → Zoho
            </button>
          </div>
        </div>
      </div>`;
  }).join('');
}

function renderFieldList(d, filename, modelKey) {
  const gt = AppState.groundTruth[filename] || {};
  return CONFIG.FIELDS.map(field => {
    const val = d[field.key];
    const gtVal = gt[field.key];
    let scoreIcon = '';
    if (gtVal !== undefined && gtVal !== null && gtVal !== '') {
      const s = scoreField(val, gtVal, field.type);
      if (s === 1) scoreIcon = '<span class="field-score" title="Correct">✅</span>';
      else if (s === 0) scoreIcon = '<span class="field-score" title="Incorrect">❌</span>';
      else scoreIcon = '<span class="field-score" title="N/A">➖</span>';
    }

    let displayVal = val;
    let valClass = '';
    if (val === null || val === undefined || val === '') {
      displayVal = 'null';
      valClass = 'null-value';
    } else if (field.key === 'amount_total' || field.key === 'gst_amount') {
      displayVal = val !== null ? `₹ ${Number(val).toLocaleString('en-IN')}` : 'null';
      valClass = 'amount';
    } else if (field.key === 'date') {
      valClass = 'date';
    } else if (field.key === 'vendor_name') {
      valClass = 'vendor';
    }

    return `
      <div class="field-item">
        <span class="field-label">${field.icon} ${field.label}</span>
        <span class="field-value ${valClass}">${displayVal ?? 'null'}</span>
        ${scoreIcon}
      </div>`;
  }).join('');
}

function renderLineItems(items) {
  if (!items || !items.length) return '';
  return `
    <div style="margin-top:12px;">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);margin-bottom:6px;">Line Items</div>
      <table class="line-items-table">
        <thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead>
        <tbody>
          ${items.map(item => `
            <tr>
              <td>${item.description || '—'}</td>
              <td>${item.quantity ?? '—'}</td>
              <td>${item.unit_price != null ? '₹' + item.unit_price : '—'}</td>
              <td>${item.amount != null ? '₹' + item.amount : '—'}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

// Pre-fill ground truth from a model's result
function prefillGroundTruth(filename, modelKey) {
  const results = AppState.results[filename];
  if (!results || !results[modelKey] || !results[modelKey].success) return;
  const data = results[modelKey].data;
  AppState.groundTruth[filename] = AppState.groundTruth[filename] || {};
  CONFIG.FIELDS.forEach(f => {
    if (data[f.key] !== undefined) AppState.groundTruth[filename][f.key] = data[f.key];
  });
  showToast(`Ground truth pre-filled from ${CONFIG.MODELS[modelKey]?.name}`, 'success');
  window.refreshEvaluateBillList?.();
}
window.prefillGroundTruth = prefillGroundTruth;

// Buttons wired by index.html
document.getElementById('export-to-gt-btn').addEventListener('click', () => {
  if (!currentExtractionBill) return showToast('No bill selected', 'warning');
  showView('evaluate');
});

document.getElementById('send-to-zoho-btn').addEventListener('click', () => {
  if (!currentExtractionBill) return showToast('No bill selected', 'warning');
  openZohoModal(currentExtractionBill, null);
});

// ─── Load models when available ────────────────────────────────────────────────
window.addEventListener('models-loaded', renderModelCheckboxes);
