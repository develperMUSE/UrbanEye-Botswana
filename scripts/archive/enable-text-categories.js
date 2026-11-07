
const fs = require('fs');
const vm = require('vm');

const paths = {
  helper: 'models/issueHelper.js',
  routes: 'routes/issueRoutes.js',
  report: 'public/report.html'
};

const original = {};
for (const [key, file] of Object.entries(paths)) {
  if (!fs.existsSync(file)) throw Error('Missing: ' + file);
  original[key] = fs.readFileSync(file, 'utf8');
}

let { helper, routes, report } = original;
const marker = 'URBANEYE_TEXT_CATEGORIES_V1';

if (report.includes(marker)) {
  console.log('Text categorisation already installed.');
  process.exit(0);
}

function replaceBetween(source, start, end, replacement) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);

  if (a < 0 || b < 0) {
    throw Error('Cannot find section: ' + start);
  }

  return source.slice(0, a) +
    replacement + '\n\n' + source.slice(b);
}

// Connect the category matcher to the existing backend.
if (!helper.includes("require('./categoryMatcher')")) {
  helper = helper.replace(
    "const db = require('../config/db');",
    "const db = require('../config/db');\n" +
    "const { resolveCategory } = require('./categoryMatcher');"
  );
}

helper = replaceBetween(
  helper,
  'async function suggestCategoryFromText(',
  'const issueSelect =',
  `async function suggestCategoryFromText(text) {
  if (!String(text || '').trim()) return null;
  const categories = await getAllCategories();
  return resolveCategory(text, categories);
}`
);

// Add a dedicated text suggestion endpoint.
if (!routes.includes("'/suggest-category'")) {
  const anchor = '// CREATE A REPORT';
  const index = routes.indexOf(anchor);

  if (index < 0) throw Error('Report route not found.');

  const endpoint = `
/* ${marker} */
router.post('/suggest-category', authenticateToken, async (req, res) => {
  try {
    const text = String(req.body?.text || '').trim();

    if (text.length > 10000) {
      return res.status(400).json({
        success: false,
        message: 'Description too long.'
      });
    }

    const category = await suggestCategoryFromText(text);
    res.json({ success: true, category });
  } catch (error) {
    console.error('Text category suggestion:', error);
    res.status(500).json({
      success: false,
      message: 'Category suggestion unavailable.'
    });
  }
});

`;
  routes = routes.slice(0, index) +
    endpoint + routes.slice(index);
}

// Replace text categorisation only.
// Camera, AI, GPS, maps and submission stay unchanged.
report = replaceBetween(
  report,
  'function inferCategory(text){',
  'async function loadCategories(){',
  `/* ${marker} */

let textCategoryTimer = null;
let textCategoryRequest = 0;

async function inferCategory(text) {
  const response = await fetch('/api/issues/suggest-category', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ text })
  });

  if (!response.ok) {
    throw Error('Automatic categorisation unavailable.');
  }

  const data = await response.json();
  return data.category || null;
}

function updateCategorySuggestion() {
  clearTimeout(textCategoryTimer);
  const request = ++textCategoryRequest;

  if (categoryWasManuallyChanged || reportSubmitted) return;

  const text = (
    titleInput.value + ' ' + descriptionInput.value
  ).trim();

  if (!text) {
    categoryHint.textContent =
      'Describe the issue to receive a category suggestion.';
    return;
  }

  categoryHint.textContent = 'Recognising issue keywords…';

  textCategoryTimer = setTimeout(async () => {
    try {
      const category = await inferCategory(text);

      if (
        request !== textCategoryRequest ||
        categoryWasManuallyChanged ||
        reportSubmitted
      ) return;

      if (category) {
        categorySelect.value = String(category.category_id);
        categoryHint.textContent =
          'Automatically recognised: ' +
          category.category_name + ' → ' +
          category.department_name +
          '. You may change the category.';
      } else {
        categorySelect.value = '';
        categoryHint.textContent =
          'No matching category found. Please select manually.';
      }
    } catch (error) {
      if (request !== textCategoryRequest) return;
      categoryHint.textContent =
        'Automatic suggestion unavailable. Select manually.';
    }
  }, 400);
}`
);

// Validate before writing anything.
new vm.Script(helper, { filename: paths.helper });
new vm.Script(routes, { filename: paths.routes });

const scripts = [...report.matchAll(
  /<script[^>]*>([\s\S]*?)<\/script>/gi
)];

for (const script of scripts) {
  if (script[1].trim()) {
    new vm.Script(script[1], { filename: paths.report });
  }
}

// Back up originals.
const stamp = Date.now();

for (const [key, file] of Object.entries(paths)) {
  fs.copyFileSync(file, file + '.backup-' + stamp);
}

// Install.
fs.writeFileSync(paths.helper, helper);
fs.writeFileSync(paths.routes, routes);
fs.writeFileSync(paths.report, report);

console.log('SUCCESS: Text categorisation installed.');
console.log('AI photo classification preserved.');
console.log('Camera, GPS and map preserved.');
console.log('Original files backed up.');
