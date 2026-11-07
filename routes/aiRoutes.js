
const express = require('express');
const multer = require('multer');
const authenticateToken = require('../middleware/authMiddleware');
const {
    getAllCategories,
    getIssueForUser
} = require('../models/issueHelper');
const db = require('../config/db');

const router = express.Router();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024,
        files: 1
    },
    fileFilter: (req, file, cb) => {
        const allowed = [
            'image/jpeg',
            'image/png',
            'image/webp',
            'image/gif'
        ];

        if (!allowed.includes(file.mimetype)) {
            return cb(new Error('Upload a JPG, PNG, WEBP or GIF image.'));
        }

        cb(null, true);
    }
});

function normalize(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

// Safely accept either an object or JSON text from Cloudflare.
function parsePrediction(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value;
    }

    if (typeof value !== 'string' || !value.trim()) {
        throw new Error('Cloudflare returned an empty prediction.');
    }

    const cleaned = value.trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');

    if (start === -1 || end < start) {
        throw new Error('No JSON object was found in the AI response.');
    }

    return JSON.parse(cleaned.slice(start, end + 1));
}


/* URBANEYE_AI_TEXT_FALLBACK_V1 */
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
      /category_name\s*[:=]\s*["']?([^\n"',}]+)/i,
      /(?:suggested|predicted|recommended|appropriate)\s+category\s*[:\-]\s*([^\n]+)/i,
      /category\s+classification[^\n]*\n+([\s\S]{0,300})/i,
      /category\s*[:\-]\s*([^\n]+)/i
    ];

    const clean = value => String(value || '')
      .replace(/\*\*/g, '')
      .replace(/^[\s*#-]+/, '')
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
      /(?:power\s*line|powerline|electric(?:al)?\s*(?:pole|wire|cable)|high.voltage)/i.test(text) &&
      !/street\s*light|streetlight|lamp\s*post/i.test(text)
    ) {
      chosen = null;
    }

    const confidenceMatch = text.match(
      /confidence(?:\s+level)?\s*[:=\-*\s]+(\d+(?:\.\d+)?)\s*(%)?/i
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
      /(?:explanation|visible evidence|problem description)\s*[:\-*\s]+([^\n]+)/i
    );

    const explanation = explanationMatch
      ? explanationMatch[1].replace(/\*\*/g, '').trim()
      : 'Category suggested from the AI image analysis. Please review.';

    return {
      category_name: chosen,
      confidence: chosen ? confidence : 0,
      explanation: explanation.slice(0, 500),
      visible_evidence: text
        .replace(/\*\*/g, '')
        .slice(0, 500)
    };
  }
}

// POST /api/ai/classify-image
router.post(
    '/classify-image',
    authenticateToken,
    (req, res, next) => {
        upload.single('image')(req, res, error => {
            if (error) {
                return res.status(400).json({
                    success: false,
                    message: error.code === 'LIMIT_FILE_SIZE'
                        ? 'Image must be 5 MB or smaller.'
                        : error.message || 'Could not read the image.'
                });
            }

            next();
        });
    },
    async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    message: 'Choose or capture an image first.'
                });
            }

            const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
            const apiToken = process.env.CLOUDFLARE_API_TOKEN;

            if (
                !accountId ||
                !apiToken ||
                accountId.includes('your_account_id') ||
                apiToken.includes('your_api_token')
            ) {
                return res.status(503).json({
                    success: false,
                    message: 'Cloudflare AI is not configured. Check CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN in .env.'
                });
            }

            const categories = await getAllCategories();

            if (!categories || categories.length === 0) {
                return res.status(503).json({
                    success: false,
                    message: 'No issue categories were found in the database.'
                });
            }

            const categoryGuide = categories.map(category => ({
                category_name: category.category_name,
                department_name: category.department_name,
                description: category.description || ''
            }));

            const imageBase64 = req.file.buffer.toString('base64');

            const prompt = `
You classify civic infrastructure and community service issues
in Botswana for the UrbanEye reporting system.

Examine the supplied photograph and choose a category only from
this list:
${JSON.stringify(categoryGuide)}

The reporter's description may provide useful context:
${String(req.body.description || req.body.issue_description || 'No description provided').slice(0, 1000)}

The report title is:
${String(req.body.title || req.body.issue_title || 'No title provided').slice(0, 200)}

Important rules:
- Return a category name exactly as listed.
- Never invent a category.
- A damaged electrical powerline is not the same as a broken streetlight.
- If the image does not show a supported issue, use null for category_name.
- Describe visible evidence honestly.
- Confidence must be a number between 0 and 1.

Return only a JSON object in this format:
{
  "category_name": "exact category name or null",
  "confidence": 0.0,
  "explanation": "short explanation",
  "visible_evidence": "what is visibly shown"
}
`;

            const endpoint =
                'https://api.cloudflare.com/client/v4/accounts/' +
                encodeURIComponent(accountId) +
                '/ai/run/@cf/meta/llama-3.2-11b-vision-instruct';

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    Authorization: 'Bearer ' + apiToken,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    prompt,
                    image: imageBase64,
                    max_tokens: 300
                })
            });

            const result = await response.json().catch(() => ({}));

            if (!response.ok || result.success === false) {
                console.error(
                    'Cloudflare AI error:',
                    response.status,
                    JSON.stringify(result.errors || result.messages || result).slice(0, 1000)
                );

                if (response.status === 401 || response.status === 403) {
                    return res.status(502).json({
                        success: false,
                        message: 'Cloudflare rejected the request. Check the API token permissions and model access.'
                    });
                }

                if (response.status === 429) {
                    return res.status(503).json({
                        success: false,
                        message: 'Cloudflare AI rate or usage limit reached. Check your Cloudflare AI usage.'
                    });
                }

                return res.status(502).json({
                    success: false,
                    message: 'Cloudflare could not classify this image. Check the server terminal for details.'
                });
            }

            // Some responses contain an object; others contain JSON text.
            let rawPrediction;

            if (result.result && typeof result.result.response === 'object') {
                rawPrediction = result.result.response;
            } else if (result.result && result.result.response !== undefined) {
                rawPrediction = result.result.response;
            } else if (result.result && result.result.output_text !== undefined) {
                rawPrediction = result.result.output_text;
            } else if (typeof result.result === 'string') {
                rawPrediction = result.result;
            } else if (result.output_text !== undefined) {
                rawPrediction = result.output_text;
            } else {
                rawPrediction = null;
            }

            let prediction;

            try {
                prediction = parsePredictionWithFallback(rawPrediction, categories);
            } catch (error) {
                console.error(
                    'Could not parse AI prediction:',
                    error.message,
                    JSON.stringify(result).slice(0, 1000)
                );

                return res.status(502).json({
                    success: false,
                    message: 'The AI returned an unreadable result. Please try again.'
                });
            }

            const category = categories.find(item =>
                normalize(item.category_name) ===
                normalize(prediction.category_name)
            );

            const confidence = Number(prediction.confidence);

            if (
                prediction.category_name == null ||
                !category ||
                !Number.isFinite(confidence) ||
                confidence < 0 ||
                confidence > 1
            ) {
                return res.json({
                    success: true,
                    prediction: null,
                    message: 'The AI could not identify a supported issue. Please select the category manually.',
                    explanation: String(
                        prediction.explanation || 'The image may be unclear or unrelated.'
                    ).slice(0, 500),
                    visible_evidence: String(
                        prediction.visible_evidence || ''
                    ).slice(0, 500)
                });
            }

            return res.json({
                success: true,
                prediction: {
                    category_id: category.category_id,
                    category_name: category.category_name,
                    department_id: category.department_id,
                    department_name: category.department_name,
                    confidence: confidence,
                    explanation: String(
                        prediction.explanation || prediction.visible_evidence || ''
                    ).slice(0, 500),
                    visible_evidence: String(
                        prediction.visible_evidence || ''
                    ).slice(0, 500)
                }
            });
        } catch (error) {
            console.error('Image classification error:', error);

            return res.status(500).json({
                success: false,
                message: 'Could not classify the image. Please try again.'
            });
        }
    }
);

// POST /api/ai/record/:id
// Stores AI metadata separately from the report's final category.
router.post(
    '/record/:id',
    authenticateToken,
    express.json(),
    async (req, res) => {
        try {
            const issueId = Number(req.params.id);
            const categoryName = String(req.body.category_name || '').trim();
            const confidence = Number(req.body.confidence);

            if (!Number.isInteger(issueId) || issueId < 1) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid report ID.'
                });
            }

            if (
                !categoryName ||
                !Number.isFinite(confidence) ||
                confidence < 0 ||
                confidence > 1
            ) {
                return res.status(400).json({
                    success: false,
                    message: 'Valid AI category and confidence are required.'
                });
            }

            const issue = await getIssueForUser(issueId, req.user);

            if (!issue) {
                return res.status(404).json({
                    success: false,
                    message: 'Report not found in your permitted area.'
                });
            }

            const categories = await getAllCategories();

            const category = categories.find(item =>
                normalize(item.category_name) === normalize(categoryName)
            );

            if (!category) {
                return res.status(400).json({
                    success: false,
                    message: 'The AI category is not in the supported category list.'
                });
            }

            await db.execute(
                'UPDATE issues SET ai_category = ?, ai_confidence = ? WHERE issue_id = ?',
                [category.category_name, confidence, issueId]
            );

            return res.json({
                success: true,
                message: 'AI classification metadata saved.'
            });
        } catch (error) {
            console.error('Save AI classification error:', error);

            return res.status(500).json({
                success: false,
                message: 'Could not save AI classification metadata.'
            });
        }
    }
);

module.exports = router;
