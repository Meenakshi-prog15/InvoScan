// ─── InvoScan Upload Module ────────────────────────────────────────────────────

const uploadZone = document.getElementById('upload-zone');
const fileInput = document.getElementById('file-input');
const uploadBtn = document.getElementById('upload-btn');
const billsGallery = document.getElementById('bills-gallery');
const billCountBadge = document.getElementById('bill-count-badge');
const refreshBtn = document.getElementById('refresh-bills-btn');

// ─── Drag & Drop ──────────────────────────────────────────────────────────────
['dragenter', 'dragover'].forEach(evt => {
  uploadZone.addEventListener(evt, e => { e.preventDefault(); uploadZone.classList.add('dragover'); });
});

['dragleave', 'drop'].forEach(evt => {
  uploadZone.addEventListener(evt, e => { e.preventDefault(); uploadZone.classList.remove('dragover'); });
});

uploadZone.addEventListener('drop', e => {
  const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
  if (files.length) uploadFiles(files);
  else showToast('Please drop image files only', 'warning');
});

uploadZone.addEventListener('click', () => fileInput.click());
uploadZone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); });

uploadBtn.addEventListener('click', e => { e.stopPropagation(); fileInput.click(); });

fileInput.addEventListener('change', () => {
  const files = Array.from(fileInput.files);
  if (files.length) uploadFiles(files);
  fileInput.value = '';
});

// ─── File Upload ──────────────────────────────────────────────────────────────
async function uploadFiles(files) {
  const progressEl = document.getElementById('upload-progress');
  progressEl.classList.remove('hidden');
  progressEl.innerHTML = '';

  for (const file of files) {
    if (file.size > 20 * 1024 * 1024) {
      showToast(`${file.name} exceeds 20MB limit`, 'warning');
      continue;
    }

    const row = document.createElement('div');
    row.className = 'flex gap-3 mb-2';
    row.style.cssText = 'align-items:center;padding:10px 14px;background:var(--bg-glass-light);border-radius:var(--radius-sm);border:1px solid var(--border);font-size:13px;';
    row.innerHTML = `
      <span style="font-size:18px;">🖼️</span>
      <span style="flex:1;color:var(--text-primary);font-weight:500;">${file.name}</span>
      <span style="color:var(--text-muted);">${formatFileSize(file.size)}</span>
      <span class="upload-row-status" style="color:var(--accent-amber);">⏳ Uploading…</span>
    `;
    progressEl.appendChild(row);

    try {
      const formData = new FormData();
      formData.append('bill', file);
      const resp = await fetch(`${CONFIG.API_BASE}/api/upload`, { method: 'POST', body: formData });
      const data = await resp.json();
      if (data.success) {
        row.querySelector('.upload-row-status').innerHTML = '✅ Uploaded';
        row.querySelector('.upload-row-status').style.color = 'var(--accent-green)';
        showToast(`${file.name} uploaded successfully`, 'success');
      } else {
        throw new Error(data.error || 'Upload failed');
      }
    } catch (err) {
      row.querySelector('.upload-row-status').innerHTML = '❌ Failed';
      row.querySelector('.upload-row-status').style.color = 'var(--accent-red)';
      showToast(`Failed to upload ${file.name}: ${err.message}`, 'error');
    }
  }

  await loadBills();
  setTimeout(() => { progressEl.innerHTML = ''; progressEl.classList.add('hidden'); }, 3000);
}

// ─── Load & Render Bills ──────────────────────────────────────────────────────
async function loadBills() {
  try {
    const data = await apiGet('/api/bills');
    AppState.bills = data.bills || [];
    renderBillsGallery();
  } catch (err) {
    showToast('Could not load bills: ' + err.message, 'error');
  }
}

function renderBillsGallery() {
  const bills = AppState.bills;
  billCountBadge.textContent = `${bills.length} bill${bills.length !== 1 ? 's' : ''}`;

  if (!bills.length) {
    billsGallery.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1;">
        <div class="empty-state-icon">🧾</div>
        <h3>No bills yet</h3>
        <p>Upload some handwritten bill images to get started</p>
      </div>`;
    return;
  }

  billsGallery.innerHTML = bills.map(bill => {
    const hasResults = !!AppState.results[bill.filename];
    const hasGT = !!AppState.groundTruth[bill.filename];
    return `
      <div class="bill-card ${AppState.selectedBill === bill.filename ? 'selected' : ''}"
           data-filename="${bill.filename}"
           onclick="selectBill('${bill.filename}')"
           role="button" tabindex="0"
           aria-label="Bill: ${bill.filename}">
        ${hasResults ? '<div class="bill-card-badge">✓ Extracted</div>' : ''}
        <img class="bill-card-img"
             src="${CONFIG.API_BASE}/bills/${bill.filename}"
             alt="${bill.filename}"
             onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" />
        <div class="bill-card-img-placeholder" style="display:none;">🧾</div>
        <div class="bill-card-info">
          <div class="bill-card-name">${bill.filename}</div>
          <div class="bill-card-meta">
            <span>${formatFileSize(bill.size)}</span>
            <span style="display:flex;gap:4px;">
              ${hasResults ? '<span title="Extracted" style="color:var(--accent-blue)">⚡</span>' : ''}
              ${hasGT ? '<span title="Ground truth set" style="color:var(--accent-green)">🎯</span>' : ''}
            </span>
          </div>
        </div>
        <div class="bill-card-actions">
          <button class="btn btn-icon btn-danger" title="Delete bill"
            onclick="event.stopPropagation();deleteBill('${bill.filename}')"
            aria-label="Delete ${bill.filename}">🗑️</button>
        </div>
      </div>
    `;
  }).join('');
}
window.renderBillsGallery = renderBillsGallery;

function selectBill(filename) {
  AppState.selectedBill = filename;
  renderBillsGallery();
  showToast(`Selected: ${filename}`, 'info', 2000);
}
window.selectBill = selectBill;

async function deleteBill(filename) {
  if (!confirm(`Delete "${filename}"? This cannot be undone.`)) return;
  try {
    await apiDelete(`/api/bills/${filename}`);
    AppState.bills = AppState.bills.filter(b => b.filename !== filename);
    if (AppState.selectedBill === filename) AppState.selectedBill = null;
    renderBillsGallery();
    showToast(`Deleted ${filename}`, 'success');
  } catch (err) {
    showToast('Delete failed: ' + err.message, 'error');
  }
}
window.deleteBill = deleteBill;

refreshBtn.addEventListener('click', loadBills);
