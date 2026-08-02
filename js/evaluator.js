// ─── InvoScan Evaluator Module ─────────────────────────────────────────────────

const gtBillSelect = document.getElementById('gt-bill-select');
const gtFormContainer = document.getElementById('gt-form-container');
const scoringResultsContainer = document.getElementById('scoring-results-container');
const scoreAllBtn = document.getElementById('score-all-btn');

let currentGTBill = null;

// ─── Refresh bill list in Evaluate view ───────────────────────────────────────
function refreshEvaluateBillList() {
  const bills = AppState.bills;
  gtBillSelect.innerHTML = '<option value="">Select a bill…</option>' +
    bills.map(b => `<option value="${b.filename}">${b.filename}</option>`).join('');

  if (currentGTBill && bills.find(b => b.filename === currentGTBill)) {
    gtBillSelect.value = currentGTBill;
    renderGTForm(currentGTBill);
  }
}
window.refreshEvaluateBillList = refreshEvaluateBillList;

// ─── Ground Truth Form ─────────────────────────────────────────────────────────
gtBillSelect.addEventListener('change', () => {
  currentGTBill = gtBillSelect.value || null;
  if (currentGTBill) renderGTForm(currentGTBill);
  else gtFormContainer.innerHTML = `<div class="empty-state" style="padding:30px;"><div class="empty-state-icon">📋</div><h3>Select a bill</h3></div>`;
});

function renderGTForm(filename) {
  const existing = AppState.groundTruth[filename] || {};
  const modelResult = getBestModelResult(filename); // pre-fill suggestions

  gtFormContainer.innerHTML = `
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:16px;padding:10px 12px;
                background:var(--bg-glass-light);border-radius:var(--radius-sm);font-size:12px;color:var(--text-muted);">
      <span>📸</span>
      <img src="${CONFIG.API_BASE}/bills/${filename}" alt="" style="width:48px;height:48px;object-fit:cover;border-radius:4px;" onerror="this.style.display='none'"/>
      <span style="flex:1;">${filename}</span>
      ${modelResult ? `<span style="color:var(--accent-blue);">Suggestions from ${modelResult.modelName}</span>` : ''}
    </div>

    <div class="gt-form" id="gt-form-fields">
      ${CONFIG.FIELDS.map(field => {
        const suggestion = modelResult?.data?.[field.key];
        const current = existing[field.key];
        const value = current !== undefined ? current : (suggestion !== undefined ? suggestion : '');
        return `
          <div class="form-group">
            <label class="form-label" for="gt-${field.key}">${field.icon} ${field.label}</label>
            <input
              class="form-input"
              id="gt-${field.key}"
              type="${field.type === 'numeric' ? 'number' : 'text'}"
              step="${field.type === 'numeric' ? '0.01' : undefined}"
              placeholder="${field.type === 'date' ? 'YYYY-MM-DD' : field.type === 'numeric' ? '0.00' : field.label}"
              value="${value !== null && value !== undefined ? value : ''}"
              data-field="${field.key}"
              data-type="${field.type}" />
            ${suggestion !== undefined && suggestion !== null && current === undefined
              ? `<div style="font-size:10px;color:var(--accent-amber);margin-top:2px;">💡 Auto-suggested</div>`
              : ''}
          </div>`;
      }).join('')}
    </div>

    <div class="flex gap-3 mt-4">
      <button class="btn btn-primary" id="save-gt-btn">💾 Save Ground Truth</button>
      <button class="btn btn-secondary" id="score-this-btn">🎯 Score This Bill</button>
      <button class="btn btn-ghost btn-sm" id="clear-gt-btn">🗑️ Clear</button>
    </div>
  `;

  document.getElementById('save-gt-btn').addEventListener('click', () => saveGroundTruth(filename));
  document.getElementById('score-this-btn').addEventListener('click', () => {
    saveGroundTruth(filename).then(() => scoreBill(filename));
  });
  document.getElementById('clear-gt-btn').addEventListener('click', () => {
    document.querySelectorAll('#gt-form-fields input').forEach(inp => inp.value = '');
  });
}

function getBestModelResult(filename) {
  const results = AppState.results[filename];
  if (!results) return null;
  for (const mKey of ['claude', 'gemini', 'gpt4o']) {
    if (results[mKey]?.success) {
      return { modelName: CONFIG.MODELS[mKey]?.name || mKey, data: results[mKey].data };
    }
  }
  return null;
}

async function saveGroundTruth(filename) {
  const data = {};
  document.querySelectorAll('#gt-form-fields input[data-field]').forEach(inp => {
    const key = inp.dataset.field;
    const type = inp.dataset.type;
    const val = inp.value.trim();
    if (val === '') { data[key] = null; return; }
    data[key] = type === 'numeric' ? parseFloat(val) : val;
  });

  AppState.groundTruth[filename] = data;
  try {
    await apiPost('/api/ground-truth', { filename, data });
    showToast('Ground truth saved', 'success');
  } catch (err) {
    showToast('Save failed: ' + err.message, 'error');
  }
  return data;
}

// ─── Scoring ───────────────────────────────────────────────────────────────────
function scoreBill(filename) {
  const gt = AppState.groundTruth[filename];
  const results = AppState.results[filename];
  if (!gt) { showToast('No ground truth for this bill', 'warning'); return; }
  if (!results) { showToast('No extraction results for this bill', 'warning'); return; }

  const billScores = {};
  const modelKeys = Object.keys(results).filter(k => k !== 'extractedAt');

  modelKeys.forEach(mKey => {
    const res = results[mKey];
    if (!res?.success) return;
    const modelScores = {};
    CONFIG.FIELDS.forEach(field => {
      const s = scoreField(res.data?.[field.key], gt[field.key], field.type);
      modelScores[field.key] = s;
    });
    billScores[mKey] = modelScores;
  });

  AppState.scores[filename] = billScores;
  renderScoringResults(filename, billScores, gt, results);
  showToast('Scoring complete!', 'success');
}

function scoreAllBills() {
  let count = 0;
  AppState.bills.forEach(bill => {
    if (AppState.groundTruth[bill.filename] && AppState.results[bill.filename]) {
      scoreBill(bill.filename);
      count++;
    }
  });
  if (!count) showToast('No bills with both ground truth and extraction results', 'warning');
  else showToast(`Scored ${count} bill(s)`, 'success');
}

function renderScoringResults(filename, billScores, gt, results) {
  const modelKeys = Object.keys(billScores);
  if (!modelKeys.length) {
    scoringResultsContainer.innerHTML = `<div class="empty-state" style="padding:30px;"><div>No model results to score</div></div>`;
    return;
  }

  const html = `
    <div style="font-size:13px;font-weight:600;color:var(--text-primary);margin-bottom:12px;">
      📋 <span style="color:var(--accent-blue);">${filename}</span>
    </div>
    <div class="score-table-wrap">
      <table class="score-table">
        <thead>
          <tr>
            <th>Field</th>
            ${modelKeys.map(m => `<th style="color:${CONFIG.MODELS[m]?.color || '#fff'};">${CONFIG.MODELS[m]?.icon || ''} ${CONFIG.MODELS[m]?.name || m}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${CONFIG.FIELDS.map(field => {
            const cells = modelKeys.map(m => {
              const s = billScores[m]?.[field.key];
              if (s === null || s === undefined) return `<td><span style="color:var(--text-muted);font-size:12px;">N/A</span></td>`;
              const icon = s === 1 ? '✅' : '❌';
              return `<td style="text-align:center;">${icon}</td>`;
            }).join('');
            return `
              <tr>
                <td style="color:var(--text-secondary);">${field.icon} ${field.label}
                  <div style="font-size:11px;color:var(--text-muted);">GT: ${gt[field.key] ?? '—'}</div>
                </td>
                ${cells}
              </tr>`;
          }).join('')}
        </tbody>
        <tfoot>
          <tr style="border-top:2px solid var(--border);">
            <td style="font-weight:700;color:var(--text-primary);">Overall</td>
            ${modelKeys.map(m => {
              const scores = Object.values(billScores[m] || {}).filter(s => s !== null);
              const pct = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length * 100) : 0;
              const cls = pct >= 80 ? 'high' : pct >= 50 ? 'medium' : 'low';
              return `<td style="text-align:center;">
                <span style="font-weight:800;font-size:16px;color:${pct >= 80 ? 'var(--accent-green)' : pct >= 50 ? 'var(--accent-amber)' : 'var(--accent-red)'};">${pct}%</span>
              </td>`;
            }).join('')}
          </tr>
        </tfoot>
      </table>
    </div>`;

  scoringResultsContainer.innerHTML = html;
}

scoreAllBtn.addEventListener('click', scoreAllBills);
window.scoreBill = scoreBill;

// ─── Aggregate scores across all bills ────────────────────────────────────────
function computeAggregateScores() {
  const agg = {}; // { modelKey: { fieldKey: [scores] } }
  Object.entries(AppState.scores).forEach(([filename, billScores]) => {
    Object.entries(billScores).forEach(([mKey, fieldScores]) => {
      if (!agg[mKey]) agg[mKey] = {};
      Object.entries(fieldScores).forEach(([fKey, s]) => {
        if (s === null) return;
        if (!agg[mKey][fKey]) agg[mKey][fKey] = [];
        agg[mKey][fKey].push(s);
      });
    });
  });

  // Compute averages
  const result = {};
  Object.entries(agg).forEach(([mKey, fields]) => {
    result[mKey] = {};
    Object.entries(fields).forEach(([fKey, scores]) => {
      result[mKey][fKey] = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
    });
    const allScores = Object.values(result[mKey]).filter(s => s !== null);
    result[mKey]._overall = allScores.length ? allScores.reduce((a, b) => a + b, 0) / allScores.length : null;
    result[mKey]._billCount = Object.keys(AppState.scores).filter(f => AppState.scores[f][mKey]).length;
  });

  return result;
}
window.computeAggregateScores = computeAggregateScores;
