// ─── InvoScan Global Config ────────────────────────────────────────────────────
const CONFIG = {
  API_BASE: 'http://localhost:3001',

  MODELS: {
    gemini: {
  key: 'gemini',
  name: 'Gemini 2.0 Flash',
  provider: 'Google AI',
  icon: '✨',
  color: '#4285F4',
  costPerImage: 0.00,
  costPer100: 0.00
},
openrouter: {
  key: 'openrouter',
  name: 'OpenRouter',
  provider: 'OpenRouter',
  icon: '🌐',
  color: '#8B5CF6',
  costPerImage: 0.001,
  costPer100: 0.10
},
claude: {
  key: 'claude',
  name: 'Claude 3.5 Haiku',
  provider: 'Anthropic',
  icon: '🧠',
  color: '#D97706',
  costPerImage: 0.0008,
  costPer100: 0.08
},
gpt4o: {
  key: 'gpt4o',
  name: 'GPT-4o Mini',
  provider: 'OpenAI',
  icon: '🤖',
  color: '#34D399',
  costPerImage: 0.00085,
  costPer100: 0.085
},
nvidia: {
  key: 'nvidia',
  name: 'Llama 3.2 Vision',
  provider: 'Nvidia Build API',
  icon: '👁️',
  color: '#76B900',
  costPerImage: 0.00,
  costPer100: 0.00
}
  },

  // Fields extracted from bills — in display order
  FIELDS: [
    { key: 'vendor_name',   label: 'Vendor Name',     type: 'text',    icon: '🏪', important: true },
    { key: 'invoice_number',label: 'Invoice No.',     type: 'text',    icon: '🔢', important: false },
    { key: 'date',          label: 'Date',            type: 'date',    icon: '📅', important: true },
    { key: 'amount_total',  label: 'Total Amount',    type: 'numeric', icon: '💰', important: true },
    { key: 'currency',      label: 'Currency',        type: 'exact',   icon: '🏷️', important: false },
    { key: 'gst_number',    label: 'GST Number',      type: 'text',    icon: '📜', important: false },
    { key: 'gst_amount',    label: 'GST Amount',      type: 'numeric', icon: '🧾', important: false },
    { key: 'gst_rate',      label: 'GST Rate (%)',    type: 'numeric', icon: '📊', important: false },
    { key: 'payment_method',label: 'Payment Method',  type: 'exact',   icon: '💳', important: false },
  ],

  // Scoring thresholds
  SCORING: {
    fuzzyThreshold: 0.85,   // for text fields
    numericTolerance: 0.02, // ±2% for numeric fields
  }
};

// ─── Simple fuzzy match (Levenshtein ratio) ────────────────────────────────────
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    }
  }
  return dp[m][n];
}

function fuzzyRatio(s1, s2) {
  if (!s1 && !s2) return 1;
  if (!s1 || !s2) return 0;
  const a = String(s1).toLowerCase().trim();
  const b = String(s2).toLowerCase().trim();
  if (a === b) return 1;
  const dist = levenshtein(a, b);
  return 1 - dist / Math.max(a.length, b.length);
}

// ─── Score a single field ──────────────────────────────────────────────────────
function scoreField(extracted, groundTruth, fieldType) {
  // Both null/undefined = null (skip)
  if ((extracted === null || extracted === undefined || extracted === '') &&
      (groundTruth === null || groundTruth === undefined || groundTruth === '')) {
    return null;
  }
  // GT null but model extracted something = wrong
  if (groundTruth === null || groundTruth === undefined || groundTruth === '') return 0;
  // Model extracted nothing but GT has value = wrong
  if (extracted === null || extracted === undefined || extracted === '') return 0;

  if (fieldType === 'numeric') {
    const e = parseFloat(String(extracted).replace(/[^0-9.]/g, ''));
    const g = parseFloat(String(groundTruth).replace(/[^0-9.]/g, ''));
    if (isNaN(e) || isNaN(g)) return 0;
    if (g === 0) return e === 0 ? 1 : 0;
    return Math.abs(e - g) / g <= CONFIG.SCORING.numericTolerance ? 1 : 0;
  }

  if (fieldType === 'date') {
    const normalize = d => String(d).replace(/[\/\-.]/g, '-').trim();
    return normalize(extracted) === normalize(groundTruth) ? 1 : 0;
  }

  if (fieldType === 'exact') {
    return String(extracted).toLowerCase().trim() === String(groundTruth).toLowerCase().trim() ? 1 : 0;
  }

  // text → fuzzy
  return fuzzyRatio(extracted, groundTruth) >= CONFIG.SCORING.fuzzyThreshold ? 1 : 0;
}

// Expose globally
window.CONFIG = CONFIG;
window.scoreField = scoreField;
window.fuzzyRatio = fuzzyRatio;
