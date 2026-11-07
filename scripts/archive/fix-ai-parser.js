
const fs = require('fs');
const vm = require('vm');

const file = './routes/aiRoutes.js';
const source = fs.readFileSync(file, 'utf8');
const marker = 'URBANEYE_AI_TEXT_FALLBACK_V1';

if (source.includes(marker)) {
  console.log('AI parser fix is already installed.');
  process.exit(0);
}

const oldCall = 'prediction = parsePrediction(rawPrediction);';

if (!source.includes(oldCall)) {
  throw Error('AI parser call not found. No files changed.');
}

const fallback = `
/* ${marker} */
function parsePredictionWithFallback(raw, categories) {
  try {
    return parsePrediction(raw);
  } catch (originalError) {
    const text = typeof raw === 'string'
      ? raw
      : JSON.stringify(raw || '');

    if (!text.trim()) throw originalError;

    // First look for an explicitly named category.
    const explicitPatterns = [
      /category_name\\s*[:=]\\s*["']?([^\\n"',}]+)/i,
      /(?:suggested|predicted|recommended|appropriate)\\s+category\\s*[:\\-]\\s*([^\\n]+)/i,
      /category\\s+classification[^\\n]*\\n+([\\s\\S]{0,300})/i,
      /category\\s*[:\\-]\\s*([^\\n]+)/i
    ];

    const clean = value => String(value || '')
      .replace(/\\*\\*/g, '')
      .replace(/^[\\s*#-]+/, '')
      .trim()
      .toLowerCase();

    const names = categories
      .filter(c => c && c.category_name)
      .map(c => ({
        original: c.category_name,
        normalized: clean(c.category_name)
      }));

    let chosen = null;
    let explicit = false;

    for (const pattern of explicitPatterns) {
      const match = text.match(pattern);
      if (!match) continue;

      const candidate = clean(match[1]);
      const matches = names.filter(c =>
        candidate.includes(c.normalized)
      );

      if (matches.length === 1) {
        chosen = matches[0].original;
        explicit = true;
        break;
      }
    }

    // Fallback to category names mentioned in the AI answer.
    // Do not guess when several categories are mentioned.
    if (!chosen) {
      const found = names.filter(c =>
        clean(text).includes(c.normalized)
      );

      if (found.length === 1) {
        chosen = found[0].original;
      }
    }

    // Avoid routing fallen power lines as streetlight faults.
    if (
      chosen &&
      /broken streetlight/i.test(chosen) &&
      /(?:power\\s*line|powerline|electric(?:al)?\\s*(?:pole|wire|cable)|high.voltage)/i.test(text) &&
      !/street\\s*light|streetlight|lamp\\s*post/i.test(text)
    ) {
      chosen = null;
    }

    const confidenceMatch = text.match(
      /confidence(?:\\s+level)?\\s*[:=\\-*\\s]+(\\d+(?:\\.\\d+)?)\\s*(%)?/i
    );

    let confidence = explicit ? 0.8 : 0.65;

    if (confidenceMatch) {
      const number = Number(confidenceMatch[1]);
      confidence = confidenceMatch[2] || number > 1
        ? number / 100
        : number;
    }

    if (!Number.isFinite(confidence)) confidence = 0.65;
    confidence = Math.max(0, Math.min(1, confidence));

    const explanationMatch = text.match(
      /(?:explanation|visible evidence|problem description)\\s*[:\\-*\\s]+([^\\n]+)/i
    );

    const explanation = explanationMatch
      ? explanationMatch[1].replace(/\\*\\*/g, '').trim()
      : 'Category suggested from the AI image analysis. Please review.';

    return {
      category_name: chosen,
      confidence: chosen ? confidence : 0,
      explanation: explanation.slice(0, 500),
      visible_evidence: text
        .replace(/\\*\\*/g, '')
        .slice(0, 500)
    };
  }
}
`;

const anchor = '// POST /api/ai/classify-image';

if (!source.includes(anchor)) {
  throw Error('AI route location not found. No files changed.');
}

const updated = source
  .replace(anchor, fallback + '\n' + anchor)
  .replace(
    oldCall,
    'prediction = parsePredictionWithFallback(rawPrediction, categories);'
  );

// Verify JavaScript syntax before changing the file.
new vm.Script(updated, { filename: file });

// Save original, then install.
const backup = file + '.backup-' + Date.now();
fs.copyFileSync(file, backup);
fs.writeFileSync(file, updated);

console.log('SUCCESS: AI parser fallback installed.');
console.log('Original backed up:', backup);
console.log('Cloudflare model unchanged.');
console.log('Existing category and department routing unchanged.');
