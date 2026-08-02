require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '..')));

// ─── Ensure directories exist ──────────────────────────────────────────────────
const BILLS_DIR = path.join(__dirname, '..', 'bills');
const RESULTS_DIR = path.join(__dirname, '..', 'results');
const GT_FILE = path.join(__dirname, '..', 'ground_truth', 'ground_truth.json');
const GT_DIR = path.join(__dirname, '..', 'ground_truth');

[BILLS_DIR, RESULTS_DIR, GT_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});
if (!fs.existsSync(GT_FILE)) fs.writeFileSync(GT_FILE, JSON.stringify({}, null, 2));

// ─── Multer for image uploads ──────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: BILLS_DIR,
  filename: (req, file, cb) => {
    const safeName = Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, safeName);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/image\/(jpeg|png|webp|gif)/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  }
});

// ─── Model Configs ─────────────────────────────────────────────────────────────
const MODELS = {
  gemini: {
    name: 'Gemini 2.0 Flash',
    id: 'gemini-2.0-flash',
    provider: 'Google AI Studio',
    free: true,
    costPerImage: 0.00,
    color: '#4285F4'
  },
  groq: {
    name: 'Llama 3.2 11B Vision (Groq)',
    id: 'llama-3.2-11b-vision-preview',
    provider: 'Groq',
    free: true,
    costPerImage: 0.00,
    color: '#F97316'
  },
  openrouter: {
    name: 'Llama 3.2 11B Vision (OpenRouter)',
    id: 'meta-llama/llama-3.2-11b-vision-preview:free',
    provider: 'OpenRouter',
    free: true,
    costPerImage: 0.00,
    color: '#8B5CF6'
  },
  claude: {
    name: 'Claude 3.5 Haiku',
    id: 'claude-3-5-haiku-20241022',
    provider: 'Anthropic',
    free: false,
    costPerImage: 0.0008,
    color: '#D97706'
  },
  gpt4o: {
    name: 'GPT-4o Mini',
    id: 'gpt-4o-mini',
    provider: 'OpenAI',
    free: false,
    costPerImage: 0.00085,
    color: '#10B981'
  }
};

// ─── Extraction Prompt ─────────────────────────────────────────────────────────
const EXTRACTION_PROMPT = `You are an expert OCR assistant specializing in handwritten Indian bills, receipts, and invoices.

Carefully examine this bill image and extract ALL visible information. Indian bills may be in Hindi, English, or mixed languages. Common abbreviations: "Rs." = INR, "dt." = date, "No." = number, "Amt" = amount, "GST" = Goods & Services Tax, "GSTIN" = GST Identification Number.

Return ONLY a valid JSON object with EXACTLY these keys (use null if a field is not visible or unclear):

{
  "vendor_name": "Shop/business name as written",
  "invoice_number": "Bill/receipt/invoice number if present",
  "date": "Date in YYYY-MM-DD format, or original text if format unclear",
  "amount_total": numeric value only (no currency symbols),
  "currency": "INR",
  "gst_number": "GSTIN if printed on bill",
  "gst_amount": numeric value of GST/tax if shown,
  "gst_rate": numeric percentage if shown (e.g. 18),
  "line_items": [
    {
      "description": "item name",
      "quantity": numeric or null,
      "unit_price": numeric or null,
      "amount": numeric or null
    }
  ],
  "payment_method": "cash/upi/card/cheque or null",
  "notes": "Any other relevant text visible on the bill",
  "confidence": "high if most fields are clearly readable, medium if some fields are ambiguous, low if bill is very unclear"
}

IMPORTANT: Return ONLY the JSON object, no explanation, no markdown code blocks.`;

// ─── Helper: image to base64 ───────────────────────────────────────────────────
function parseModelJson(rawText) {
  if (typeof rawText !== 'string' || !rawText.trim()) {
    throw new Error('AI model returned an empty response');
  }

  const cleaned = rawText
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();

  // First try parsing the entire response.
  try {
    return JSON.parse(cleaned);
  } catch {
    // If the model added an explanation, extract the JSON object.
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');

    if (start !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        // Continue to the clearer error below.
      }
    }

    throw new Error(
      `AI model did not return valid JSON. Response started with: ${cleaned.slice(0, 80)}`
    );
  }
}
function imageToBase64(filePath) {
  const buffer = fs.readFileSync(filePath);
  return buffer.toString('base64');
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };
  return map[ext] || 'image/jpeg';
}

// ─── Extractor: Gemini with Retry ────────────────────────────────────────────
async function extractWithGemini(imagePath, retries = 3) {
  const start = Date.now();
  try {
    if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
    const base64 = imageToBase64(imagePath);
    const mimeType = getMimeType(imagePath);

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const response = await axios.post(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
          {
            contents: [{
              parts: [
                { text: EXTRACTION_PROMPT },
                { inline_data: { mime_type: mimeType, data: base64 } }
              ]
            }],
            generationConfig: { temperature: 0.1, maxOutputTokens: 2048 }
          },
          { timeout: 60000 }
        );

        const rawText = response.data.candidates[0].content.parts[0].text.trim();
        const parsed = parseModelJson(rawText);
        return { success: true, data: parsed, latencyMs: Date.now() - start, raw: rawText };
      } catch (err) {
        if (err.response?.status === 429 && attempt < retries - 1) {
          const delays = [3000, 8000, 15000];
          const delay = delays[attempt] || 20000;
          console.log(`⏳ Gemini rate limited. Retrying in ${delay / 1000}s...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        throw err;
      }
    }
  } catch (err) {
    return { success: false, error: err.message, latencyMs: Date.now() - start };
  }
}

// ─── Extractor: Claude ─────────────────────────────────────────────────────────
async function extractWithClaude(imagePath) {
  const start = Date.now();
  try {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
    const base64 = imageToBase64(imagePath);
    const mimeType = getMimeType(imagePath);

    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 2048,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
            { type: 'text', text: EXTRACTION_PROMPT }
          ]
        }]
      },
      {
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2024-06-01',
          'content-type': 'application/json'
        },
        timeout: 60000
      }
    );

    const rawText = response.data.content[0].text.trim();
    const parsed = parseModelJson(rawText);
    return { success: true, data: parsed, latencyMs: Date.now() - start, raw: rawText };
  } catch (err) {
    console.error(`❌ Claude error: ${err.response?.status} - ${err.response?.data?.error?.message || err.message}`);
    return { success: false, error: err.message, latencyMs: Date.now() - start };
  }
}

// ─── Extractor: GPT-4o Mini with Retry ────────────────────────────────────────
async function extractWithGPT4o(imagePath, retries = 4) {
  const start = Date.now();
  try {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');
    const base64 = imageToBase64(imagePath);
    const mimeType = getMimeType(imagePath);

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const response = await axios.post(
          'https://api.openai.com/v1/chat/completions',
          {
            model: 'gpt-4o-mini',
            max_tokens: 2048,
            temperature: 0.1,
            messages: [{
              role: 'user',
              content: [
                { type: 'text', text: EXTRACTION_PROMPT },
                { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}`, detail: 'high' } }
              ]
            }]
          },
          {
            headers: {
              'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
              'Content-Type': 'application/json'
            },
            timeout: 60000
          }
        );

        const rawText = response.data.choices[0].message.content.trim();
        const parsed = parseModelJson(rawText);
        return { success: true, data: parsed, latencyMs: Date.now() - start, raw: rawText };
      } catch (err) {
        if (err.response?.status === 429 && attempt < retries - 1) {
          const delays = [3000, 8000, 15000];
          const delay = delays[attempt] || 20000;
          console.log(`⏳ GPT-4o rate limited. Retrying in ${delay / 1000}s...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        throw err;
      }
    }
  } catch (err) {
    return { success: false, error: err.message, latencyMs: Date.now() - start };
  }
}

// ─── Extractor: Groq (Text-only fallback — FREE) ───────────────────────────────────
async function extractWithGroq(imagePath) {
  const start = Date.now();
  try {
    if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY not set');
    
    // Groq free tier doesn't reliably support vision, return info message
    return { 
      success: false, 
      error: 'Groq free tier requires paid vision plan. Use Gemini (free) or OpenRouter instead.',
      latencyMs: Date.now() - start 
    };
  } catch (err) {
    return { success: false, error: err.message, latencyMs: Date.now() - start };
  }
}

// ─── Extractor: OpenRouter (Pixtral or Qwen Vision — FREE) ───────────────────────
async function extractWithOpenRouter(imagePath) {
  const start = Date.now();
  try {
    if (!process.env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY not set');
    const base64 = imageToBase64(imagePath);
    const mimeType = getMimeType(imagePath);

    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {

  model: 'qwen/qwen-vl-plus:free',
  max_tokens: 2048,
  temperature: 0.1,

  response_format: {
    type: 'json_object'
  },

  plugins: [
    {
      id: 'response-healing'
    }
  ],

  messages: [{
    role: 'user',
    content: [
      { type: 'text', text: EXTRACTION_PROMPT },
      {
        type: 'image_url',
        image_url: {
          url: `data:${mimeType};base64,${base64}`
        }
      }
    ]
  }]
},
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'http://localhost:3001',
          'X-Title': 'InvoScan'
        },
        timeout: 60000
      }
    );

    const rawText = response.data.choices[0].message.content.trim();
    const parsed = parseModelJson(rawText);
    return { success: true, data: parsed, latencyMs: Date.now() - start, raw: rawText };
  } catch (err) {
    return { success: false, error: err.message, latencyMs: Date.now() - start };
  }
}

// ─── Extractor: Nvidia Build API (Llama 3.2 Vision) ──────────────────────────
async function extractWithNvidia(imagePath) {
  const start = Date.now();
  try {
    if (!process.env.NVIDIA_API_KEY) throw new Error('NVIDIA_API_KEY not set');
    const base64 = imageToBase64(imagePath);
    const mimeType = getMimeType(imagePath);

    const response = await axios.post(
      'https://integrate.api.nvidia.com/v1/chat/completions',
      {
        
  model: 'meta/llama-3.2-11b-vision-instruct',
  max_tokens: 2048,
  temperature: 0,

  response_format: {
    type: 'json_object'
  },

  messages: [{
          role: 'user',
          content: [
            { type: 'text', text: EXTRACTION_PROMPT },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } }
          ]
        }]
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.NVIDIA_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 60000
      }
    );

    const rawText = response.data.choices[0].message.content.trim();

let parsed;

try {
  // Nvidia may occasionally return JSON directly.
  parsed = parseModelJson(rawText);
} catch {
  console.log('Nvidia returned prose; converting it to JSON...');

  const conversionPrompt = `
Convert the following invoice description into exactly one valid JSON object.

Required structure:
{
  "vendor_name": string or null,
  "invoice_number": string or null,
  "date": string or null,
  "amount_total": number or null,
  "currency": string or null,
  "gst_number": string or null,
  "gst_amount": number or null,
  "gst_rate": number or null,
  "line_items": [
    {
      "description": string,
      "quantity": number or null,
      "unit_price": number or null,
      "amount": number or null
    }
  ],
  "payment_method": string or null,
  "notes": string or null,
  "confidence": "high" or "medium" or "low"
}

Rules:
- Return only the JSON object.
- Do not include markdown or an explanation.
- Use null for missing information.
- amount_total must be the final grand total.
- gst_amount must be the combined GST amount.
- Convert dates to YYYY-MM-DD when possible.
- Use INR for Indian rupee amounts.

Invoice description:
${rawText}
`;

  const conversionResponse = await axios.post(
    'https://integrate.api.nvidia.com/v1/chat/completions',
    {
      model: 'meta/llama-3.2-11b-vision-instruct',
      temperature: 0,
      max_tokens: 2048,
      response_format: {
        type: 'json_object'
      },
      messages: [
        {
          role: 'user',
          content: conversionPrompt
        }
      ]
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 60000
    }
  );

  const convertedText =
    conversionResponse.data.choices[0].message.content.trim();

  parsed = parseModelJson(convertedText);
}

return {
  success: true,
  data: parsed,
  latencyMs: Date.now() - start,
  raw: rawText
};
  } catch (err) {
    console.error(`❌ Nvidia error: ${err.response?.status} - ${err.response?.data?.error?.message || err.message}`);
    return { success: false, error: err.message, latencyMs: Date.now() - start };
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// Upload bill image
app.post('/api/upload', upload.single('bill'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({
    success: true,
    filename: req.file.filename,
    originalName: req.file.originalname,
    size: req.file.size,
    path: `/bills/${req.file.filename}`
  });
});

// List uploaded bills
app.get('/api/bills', (req, res) => {
  try {
    const files = fs.readdirSync(BILLS_DIR)
      .filter(f => /\.(jpg|jpeg|png|webp|gif)$/i.test(f))
      .map(f => {
        const stat = fs.statSync(path.join(BILLS_DIR, f));
        return { filename: f, size: stat.size, uploadedAt: stat.birthtime };
      })
      .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
    res.json({ bills: files });
  } catch (err) {
    res.json({ bills: [] });
  }
});

// Serve bill images
app.get('/bills/:filename', (req, res) => {
  const filePath = path.join(BILLS_DIR, req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Bill not found' });
  res.sendFile(filePath);
});

// Delete a bill
app.delete('/api/bills/:filename', (req, res) => {
  const filePath = path.join(BILLS_DIR, req.params.filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  res.json({ success: true });
});

// Extract fields from a bill using selected models
app.post('/api/extract', async (req, res) => {
  const { filename, models = ['gemini', 'claude', 'gpt4o'] } = req.body;
  if (!filename) return res.status(400).json({ error: 'filename required' });

  const imagePath = path.join(BILLS_DIR, filename);
  if (!fs.existsSync(imagePath)) return res.status(404).json({ error: 'Bill not found' });

  const extractors = {
    gemini: extractWithGemini,
    groq: extractWithGroq,
    openrouter: extractWithOpenRouter,
    claude: extractWithClaude,
    gpt4o: extractWithGPT4o,
    nvidia: extractWithNvidia
  };
  const results = {};

  await Promise.allSettled(
    models.map(async (model) => {
      if (!extractors[model]) return;
      const result = await extractors[model](imagePath);

if (!result.success) {
  result.error = `${MODELS[model]?.name || model}: ${result.error}`;
}
      results[model] = {
        ...result,
        model: MODELS[model]?.name || model,
        costPerImage: MODELS[model]?.costPerImage || 0
      };
    })
  );

  // Persist results
  const allResults = fs.existsSync(path.join(RESULTS_DIR, 'extractions.json'))
    ? JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, 'extractions.json'), 'utf8'))
    : {};
  allResults[filename] = { ...(allResults[filename] || {}), ...results, extractedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(RESULTS_DIR, 'extractions.json'), JSON.stringify(allResults, null, 2));

  res.json({ success: true, filename, results });
});

// Get all extraction results
app.get('/api/results', (req, res) => {
  const file = path.join(RESULTS_DIR, 'extractions.json');
  if (!fs.existsSync(file)) return res.json({});
  res.json(JSON.parse(fs.readFileSync(file, 'utf8')));
});

// Get results for a specific bill
app.get('/api/results/:filename', (req, res) => {
  const file = path.join(RESULTS_DIR, 'extractions.json');
  if (!fs.existsSync(file)) return res.json({});
  const all = JSON.parse(fs.readFileSync(file, 'utf8'));
  res.json(all[req.params.filename] || {});
});

// Get ground truth
app.get('/api/ground-truth', (req, res) => {
  res.json(JSON.parse(fs.readFileSync(GT_FILE, 'utf8')));
});

// Save ground truth for a bill
app.post('/api/ground-truth', (req, res) => {
  const { filename, data } = req.body;
  if (!filename || !data) return res.status(400).json({ error: 'filename and data required' });
  const gt = JSON.parse(fs.readFileSync(GT_FILE, 'utf8'));
  gt[filename] = { ...data, updatedAt: new Date().toISOString() };
  fs.writeFileSync(GT_FILE, JSON.stringify(gt, null, 2));
  res.json({ success: true });
});

// Get model info + pricing
app.get('/api/models', (req, res) => {
  const availability = {
    gemini: !!process.env.GEMINI_API_KEY,
    groq: !!process.env.GROQ_API_KEY,
    openrouter: !!process.env.OPENROUTER_API_KEY,
    claude: !!process.env.ANTHROPIC_API_KEY,
    gpt4o: !!process.env.OPENAI_API_KEY,
    nvidia: !!process.env.NVIDIA_API_KEY
  };
  res.json({ models: MODELS, availability });
});

// ─── Zoho Books OAuth2 ─────────────────────────────────────────────────────────
async function getZohoAccessToken() {
  const dc = process.env.ZOHO_DATACENTER || 'in';
  const tokenUrl = `https://accounts.zoho.${dc}/oauth/v2/token`;
  const response = await axios.post(tokenUrl, null, {
    params: {
      refresh_token: process.env.ZOHO_REFRESH_TOKEN,
      client_id: process.env.ZOHO_CLIENT_ID,
      client_secret: process.env.ZOHO_CLIENT_SECRET,
      grant_type: 'refresh_token'
    }
  });
  return response.data.access_token;
}

// Create expense in Zoho Books
app.post('/api/zoho/expense', async (req, res) => {
  try {
    const { extractedData, billFilename } = req.body;
    if (!process.env.ZOHO_CLIENT_ID) throw new Error('Zoho credentials not configured');

    const accessToken = await getZohoAccessToken();
    const dc = process.env.ZOHO_DATACENTER || 'in';
    const orgId = process.env.ZOHO_ORGANIZATION_ID;

    // Map extracted fields to Zoho expense schema
    const expenseDate = extractedData.date && /^\d{4}-\d{2}-\d{2}$/.test(extractedData.date)
      ? extractedData.date
      : new Date().toISOString().split('T')[0];

    const zohoPayload = {
      date: expenseDate,
      amount: extractedData.amount_total || 0,
      description: `Bill from ${extractedData.vendor_name || 'Unknown Vendor'} — extracted by InvoScan`,
      reference_number: extractedData.invoice_number || '',
      is_inclusive_tax: false,
      currency_code: 'INR',
      notes: `Vendor: ${extractedData.vendor_name || 'N/A'} | GST#: ${extractedData.gst_number || 'N/A'}`.substring(0, 100)
    };

    if (extractedData.gst_amount && extractedData.gst_amount > 0) {
      zohoPayload.tax_amount = extractedData.gst_amount;
    }

    const zohoResp = await axios.post(
      `https://www.zohoapis.${dc}/books/v3/expenses?organization_id=${orgId}`,
      { expense: zohoPayload },
      { headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, 'Content-Type': 'application/json' } }
    );

    const expense = zohoResp.data.expense;
    res.json({
      success: true,
      expenseId: expense.expense_id,
      zohoUrl: `https://books.zoho.${dc}/app#/expenses/${expense.expense_id}`,
      expense
    });
  } catch (err) {
    const errMsg = err.response?.data?.message || err.message;
    res.status(500).json({ success: false, error: errMsg });
  }
});

// Zoho connection test
app.get('/api/zoho/test', async (req, res) => {
  try {
    if (!process.env.ZOHO_CLIENT_ID) {
      return res.json({ connected: false, reason: 'Zoho credentials not configured in .env' });
    }
    const token = await getZohoAccessToken();
    res.json({ connected: true, tokenPreview: token.substring(0, 10) + '...' });
  } catch (err) {
    res.json({ connected: false, reason: err.message });
  }
});

// ─── Start Server ──────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 InvoScan server running at http://localhost:${PORT}`);
  console.log(`\n📋 API Keys status:`);
  console.log(`   Gemini (Free):     ${process.env.GEMINI_API_KEY ? '✅ Configured' : '⚠️  Not set'}`);
  console.log(`   Groq (Free):       ${process.env.GROQ_API_KEY ? '✅ Configured' : '⚠️  Not set'}`);
  console.log(`   OpenRouter (Free): ${process.env.OPENROUTER_API_KEY ? '✅ Configured' : '⚠️  Not set'}`);
  console.log(`   Claude:            ${process.env.ANTHROPIC_API_KEY ? '✅ Configured' : '⚠️  Not set'}`);
  console.log(`   GPT-4o:            ${process.env.OPENAI_API_KEY ? '✅ Configured' : '⚠️  Not set'}`);
  console.log(`   Nvidia:            ${process.env.NVIDIA_API_KEY ? '✅ Configured' : '⚠️  Not set'}`);
  console.log(`   Zoho Books:        ${process.env.ZOHO_CLIENT_ID ? '✅ Configured' : '⚠️  Not set'}`);
  console.log(`\n📁 Bills directory: ${BILLS_DIR}`);
  console.log(`\nOpen http://localhost:${PORT} in your browser\n`);
});
