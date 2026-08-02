// ─── InvoScan Report Module ────────────────────────────────────────────────────

function renderReport() {
  const agg = computeAggregateScores();
  const modelKeys = Object.keys(agg);

  const reportEmpty = document.getElementById('report-empty');
  const reportContent = document.getElementById('report-content');

  if (!modelKeys.length || !Object.keys(AppState.scores).length) {
    reportEmpty.classList.remove('hidden');
    reportContent.classList.add('hidden');
    return;
  }

  reportEmpty.classList.add('hidden');
  reportContent.classList.remove('hidden');

  renderRecommendation(agg, modelKeys);
  renderAccuracyBars(agg, modelKeys);
  renderHeatmap(agg, modelKeys);
  renderCostGrid(modelKeys);
  testZohoConnection?.();
}
window.renderReport = renderReport;

// ─── Recommendation Card ───────────────────────────────────────────────────────
function renderRecommendation(agg, modelKeys) {
  const card = document.getElementById('recommendation-card');
  if (!modelKeys.length) return;

  // Find winner by overall accuracy
  const sorted = modelKeys
    .filter(m => agg[m]._overall !== null)
    .sort((a, b) => (agg[b]._overall || 0) - (agg[a]._overall || 0));

  if (!sorted.length) return;
  const winner = sorted[0];
  const winnerAcc = Math.round((agg[winner]._overall || 0) * 100);
  const winnerCost = CONFIG.MODELS[winner]?.costPer100 || 0;
  const winnerModel = CONFIG.MODELS[winner];

  // Find cheapest model within 10% of winner accuracy
  const cheapestGoodModel = sorted.find(m => {
    const acc = agg[m]._overall || 0;
    return acc >= (agg[winner]._overall || 0) * 0.9 &&
      (CONFIG.MODELS[m]?.costPer100 || 999) <= (winnerCost || 999);
  }) || winner;

  const runnerUp = sorted[1];
  const runnerUpText = runnerUp && agg[runnerUp]._overall !== null
    ? `${CONFIG.MODELS[runnerUp]?.name} scored ${Math.round((agg[runnerUp]._overall || 0) * 100)}%`
    : '';

  const billsScored = agg[winner]._billCount || 0;
  const costNote = winnerCost < 0.05
    ? 'extremely low API costs'
    : winnerCost < 0.1
      ? 'moderate API costs'
      : 'higher API costs';

  card.innerHTML = `
    <div class="recommendation-title">📊 Based on ${billsScored} bill(s) scored</div>
    <div class="recommendation-winner">
      ${winnerModel?.icon || '🤖'} ${winnerModel?.name || winner}
      <span style="font-size:16px;color:var(--accent-green);margin-left:12px;">${winnerAcc}% accuracy</span>
    </div>
    <div class="recommendation-body">
      <strong style="color:var(--text-primary);">For handwritten Indian bills, ${winnerModel?.name || winner} performs best</strong>
      with ${winnerAcc}% overall extraction accuracy at ${costNote} ($${winnerCost.toFixed(3)} per 100 bills).
      ${runnerUpText ? `<br><br>Runner-up: ${runnerUpText}.` : ''}
      <br><br>
      <strong style="color:var(--text-primary);">Recommendation:</strong>
      ${winnerAcc >= 80
        ? `Use ${winnerModel?.name} for production handwritten bill processing. For digital/typed invoices, a cheaper model may suffice since they are easier to parse.`
        : winnerAcc >= 60
          ? `Consider a human-in-the-loop review for low-confidence extractions. All models show room for improvement on handwritten bills.`
          : `None of the tested models achieve reliable accuracy on this dataset. Consider prompt engineering improvements or a fine-tuned model.`}
      <br><br>
      <span style="color:var(--text-muted);font-size:13px;">
        Scoring: text fields use fuzzy match (≥85% similarity), amounts use ±2% tolerance, dates use exact match.
      </span>
    </div>`;
}

// ─── Overall Accuracy Bars ────────────────────────────────────────────────────
function renderAccuracyBars(agg, modelKeys) {
  const container = document.getElementById('accuracy-bars');
  container.innerHTML = modelKeys.map(m => {
    const model = CONFIG.MODELS[m];
    const pct = Math.round((agg[m]._overall || 0) * 100);
    const cls = pct >= 80 ? 'high' : pct >= 50 ? 'medium' : 'low';
    const billCount = agg[m]._billCount || 0;

    return `
      <div style="flex:1;min-width:140px;text-align:center;padding:20px;">
        <div style="font-size:32px;margin-bottom:8px;">${model?.icon || '🤖'}</div>
        <div style="font-size:13px;font-weight:700;color:var(--text-primary);margin-bottom:4px;">${model?.name || m}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:16px);">${billCount} bill${billCount !== 1 ? 's' : ''}</div>
        <div style="position:relative;height:100px;margin:12px auto 0;width:100px;">
          <svg viewBox="0 0 36 36" style="transform:rotate(-90deg);width:100%;height:100%;">
            <circle cx="18" cy="18" r="15.9155" fill="none" stroke="var(--border)" stroke-width="3"/>
            <circle cx="18" cy="18" r="15.9155" fill="none"
              stroke="${model?.color || 'var(--accent-blue)'}"
              stroke-width="3"
              stroke-dasharray="${pct} ${100 - pct}"
              stroke-linecap="round"
              style="transition:stroke-dasharray 1.2s cubic-bezier(0.4,0,0.2,1);" />
          </svg>
          <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
                      font-size:20px;font-weight:800;color:${model?.color || 'var(--accent-blue)'};">
            ${pct}%
          </div>
        </div>
        <div style="margin-top:12px;font-size:11px;color:var(--text-muted);">
          $${(model?.costPer100 || 0).toFixed(3)} / 100 bills
        </div>
      </div>`;
  }).join('<div style="width:1px;background:var(--border);margin:20px 0;"></div>');
}

// ─── Accuracy Heatmap ─────────────────────────────────────────────────────────
function renderHeatmap(agg, modelKeys) {
  const head = document.getElementById('heatmap-head');
  const body = document.getElementById('heatmap-body');

  head.innerHTML = `<tr>
    <th>Field</th>
    ${modelKeys.map(m => `<th style="color:${CONFIG.MODELS[m]?.color || '#fff'};">${CONFIG.MODELS[m]?.icon || ''} ${CONFIG.MODELS[m]?.name || m}</th>`).join('')}
  </tr>`;

  body.innerHTML = CONFIG.FIELDS.map(field => {
    const cells = modelKeys.map(m => {
      const score = agg[m]?.[field.key];
      if (score === null || score === undefined) {
        return `<td><span class="heatmap-cell none">N/A</span></td>`;
      }
      const pct = Math.round(score * 100);
      const cls = pct === 100 ? 'perfect' : pct >= 75 ? 'good' : pct >= 50 ? 'fair' : 'poor';
      return `<td><span class="heatmap-cell ${cls}">${pct}%</span></td>`;
    }).join('');

    return `<tr>
      <td>${field.icon} ${field.label}</td>
      ${cells}
    </tr>`;
  }).join('') + `<tr style="border-top:2px solid var(--border);">
    <td style="font-weight:700;color:var(--text-primary);">Overall</td>
    ${modelKeys.map(m => {
      const pct = Math.round((agg[m]._overall || 0) * 100);
      const cls = pct >= 80 ? 'perfect' : pct >= 60 ? 'good' : pct >= 40 ? 'fair' : 'poor';
      return `<td><span class="heatmap-cell ${cls}" style="font-size:14px;font-weight:800;">${pct}%</span></td>`;
    }).join('')}
  </tr>`;
}

// ─── Cost Grid ────────────────────────────────────────────────────────────────
function renderCostGrid(modelKeys) {
  const container = document.getElementById('cost-grid');
  const billCount = AppState.bills.length || 1;

  container.innerHTML = modelKeys.map(m => {
    const model = CONFIG.MODELS[m] || {};
    const perBill = model.costPerImage || 0;
    const per100 = model.costPer100 || 0;
    const totalSoFar = perBill * billCount;

    return `
      <div class="cost-card">
        <div class="cost-model-name" style="color:${model.color || 'var(--text-primary)'};">
          ${model.icon || '🤖'} ${model.name || m}
        </div>
        <div class="cost-row">
          <span class="cost-label">Per bill</span>
          <span class="cost-value">$${perBill.toFixed(5)}</span>
        </div>
        <div class="cost-row">
          <span class="cost-label">Per 100 bills</span>
          <span class="cost-value highlight">$${per100.toFixed(3)}</span>
        </div>
        <div class="cost-row">
          <span class="cost-label">Per 1000 bills</span>
          <span class="cost-value">$${(per100 * 10).toFixed(2)}</span>
        </div>
        <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border);">
          <div class="cost-row">
            <span class="cost-label">Your ${billCount} bills</span>
            <span class="cost-value" style="color:var(--accent-amber);">$${totalSoFar.toFixed(4)}</span>
          </div>
        </div>
        <div style="margin-top:12px;font-size:11px;color:var(--text-muted);text-align:left;line-height:1.5;">
          ${model.provider} · ${model.id || ''}
        </div>
      </div>`;
  }).join('');
}

// ─── Export JSON ───────────────────────────────────────────────────────────────
document.getElementById('export-json-btn')?.addEventListener('click', () => {
  const data = {
    exportedAt: new Date().toISOString(),
    bills: AppState.bills,
    results: AppState.results,
    groundTruth: AppState.groundTruth,
    scores: AppState.scores,
    aggregateScores: computeAggregateScores()
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `invoscan-report-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('JSON report downloaded', 'success');
});

// ─── Export CSV ───────────────────────────────────────────────────────────────
document.getElementById('export-csv-btn')?.addEventListener('click', () => {
  const rows = [];
  const headerFields = [
    'Bill Name',
    'Model',
    'vendor_name',
    'invoice_number',
    'date',
    'amount_total',
    'currency',
    'gst_number',
    'gst_amount',
    'gst_rate',
    'payment_method',
    'line_items',
    'confidence'
  ];
  rows.push(headerFields);

  // Iterate through all bills and models
  for (const [billName, billResults] of Object.entries(AppState.results)) {
    for (const [modelKey, resultData] of Object.entries(billResults)) {
      if (modelKey === 'extractedAt' || !resultData?.success) continue;

      const data = resultData.data || {};
      const lineItemsStr = data.line_items && Array.isArray(data.line_items)
        ? JSON.stringify(data.line_items).replace(/"/g, '""') // Escape quotes for CSV
        : '';

      const row = [
        billName,
        CONFIG.MODELS[modelKey]?.name || modelKey,
        data.vendor_name || '',
        data.invoice_number || '',
        data.date || '',
        data.amount_total || '',
        data.currency || '',
        data.gst_number || '',
        data.gst_amount || '',
        data.gst_rate || '',
        data.payment_method || '',
        `"${lineItemsStr}"`, // Wrap in quotes because it may contain commas
        resultData.confidence || ''
      ];
      rows.push(row);
    }
  }

  if (rows.length === 1) {
    showToast('No extraction results to export', 'warning');
    return;
  }

  // Convert to CSV with proper escaping
  const csv = rows.map(r => 
    r.map(cell => {
      const str = String(cell || '');
      return str.includes(',') || str.includes('"') || str.includes('\n')
        ? `"${str.replace(/"/g, '""')}"`
        : str;
    }).join(',')
  ).join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `invoscan-extractions-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('CSV extraction data downloaded', 'success');
});
