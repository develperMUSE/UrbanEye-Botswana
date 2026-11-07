
const fs = require('fs');
const path = require('path');

const files = {
  helper: 'models/issueHelper.js',
  routes: 'routes/issueRoutes.js',
  html: 'public/report.html',
  matcher: 'models/categoryMatcher.js'
};

const read = name => fs.readFileSync(path.resolve(files[name]), 'utf8');

for (const name of Object.keys(files)) {
  if (!fs.existsSync(files[name])) {
    throw Error('Missing file: ' + files[name]);
  }
}

let helper = read('helper');
let routes = read('routes');
let html = read('html');

const marker = 'URBANEYE_CATEGORY_UPDATE_4';

if ([helper, routes, html].every(s => s.includes(marker))) {
  console.log('Update already installed.');
  process.exit(0);
}

function replacePart(source, from, to, replacement) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start + from.length);
  if (start < 0 || end < 0) {
    throw Error('Expected code section not found: ' + from);
  }
  return source.slice(0, start) + replacement + '\n\n' + source.slice(end);
}

// 1. Backend category matching
if (!helper.includes("require('./categoryMatcher')")) {
  helper = helper.replace(
    "const db = require('../config/db');",
    "const db = require('../config/db');\n" +
    "const { resolveCategory } = require('./categoryMatcher');"
  );
}

helper = replacePart(
  helper,
  '// Automated category suggestion used by Month 3 Week 2.',
  'const issueSelect =',
  `/* ${marker} */
async function suggestCategoryFromText(text) {
  if (!String(text || '').trim()) return null;
  const categories = await getAllCategories();
  return resolveCategory(text, categories);
}`
);

// 2. Add backend API endpoints
if (!routes.includes("'/suggest-category'")) {
  const index = routes.indexOf('// CREATE A REPORT');
  if (index < 0) throw Error('Report route anchor not found.');

  const api = `
/* ${marker} */
router.post('/suggest-category', authenticateToken, async (req, res) => {
  try {
    const text = String(req.body?.text || '').slice(0, 10000);
    const category = await suggestCategoryFromText(text);
    res.json({ success: true, category });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Category lookup failed.' });
  }
});

router.post('/resolve-ai-category', authenticateToken, async (req, res) => {
  try {
    const text = String(req.body?.prediction || '').slice(0, 2000);
    const category = await suggestCategoryFromText(text);
    res.json({ success: true, category });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'AI category lookup failed.' });
  }
});
`;
  routes = routes.slice(0, index) + api + routes.slice(index);
}

// 3. Frontend automatic categorisation
html = replacePart(
  html,
  'function inferCategory(text){',
  'async function loadCategories(){',
  `/* ${marker} */
let categoryLookupSequence = 0;

async function inferCategory(text) {
  const response = await fetch('/api/issues/suggest-category', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ text })
  });
  if (!response.ok) throw Error('Category lookup unavailable');
  const data = await response.json();
  return data.category || null;
}

async function updateCategorySuggestion() {
  if (categoryWasManuallyChanged || reportSubmitted) return;
  const sequence = ++categoryLookupSequence;
  const text = titleInput.value + ' ' + descriptionInput.value;

  if (!text.trim()) return;

  try {
    const category = await inferCategory(text);
    if (sequence !== categoryLookupSequence ||
        categoryWasManuallyChanged || reportSubmitted) return;

    if (category) {
      categorySelect.value = String(category.category_id);
      categoryHint.textContent =
        'Suggested: ' + category.category_name +
        ' 鈫?' + category.department_name;
    } else {
      categoryHint.textContent =
        'No matching category. Please select one manually.';
    }
  } catch (error) {
    if (sequence === categoryLookupSequence) {
      categoryHint.textContent =
        'Automatic suggestion unavailable. Select manually.';
    }
  }
}`
);

// 4. Resolve AI predictions against actual database categories
const oldAI = `  const prediction=data.prediction||data;
  if(!prediction.category_id||!prediction.category_name){
   throw Error('AI did not return a category available in UrbanEye. Please select a category manually.');
  }`;

const newAI = `  /* ${marker} */
  let prediction=data.prediction||data;
  let matchedCategory=categories.find(c =>
    String(c.category_id)===String(prediction.category_id)
  );

  if(!matchedCategory){
    const description=[
      prediction.category_name,
      prediction.label,
      prediction.issue_type,
      prediction.description,
      prediction.explanation,
      prediction.visible_evidence
    ].filter(Boolean).join(' ');

    if(!description){
      throw Error('AI returned no recognisable issue description.');
    }

    const matchResponse=await fetch('/api/issues/resolve-ai-category',{
      method:'POST',
      headers:{
        Authorization:'Bearer '+token,
        'Content-Type':'application/json'
      },
      body:JSON.stringify({prediction:description})
    });

    if(!matchResponse.ok){
      throw Error('AI category lookup failed.');
    }

    const matchData=await matchResponse.json();
    matchedCategory=matchData.category;

    if(!matchedCategory){
      throw Error('No matching database category. Select manually.');
    }
  }

  prediction={
    ...prediction,
    category_id:matchedCategory.category_id,
    category_name:matchedCategory.category_name,
    department_name:matchedCategory.department_name
  };`;

if (!html.includes(oldAI)) {
  throw Error('Original AI handler not found. No files changed.');
}
html = html.replace(oldAI, newAI);

// 5. Validate code before saving
const vm = require('vm');
new vm.Script(helper);
new vm.Script(routes);

const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
for (const match of scripts) {
  if (match[1].trim()) new vm.Script(match[1]);
}

// 6. Back up originals and install
const stamp = Date.now();
for (const [name, content] of [
  ['helper', helper],
  ['routes', routes],
  ['html', html]
]) {
  fs.copyFileSync(files[name], files[name] + '.backup-' + stamp);
  fs.writeFileSync(files[name], content, 'utf8');
}

console.log('URBANEYE CATEGORY UPDATE COMPLETE');
console.log('Text categorisation connected.');
console.log('AI category matching connected.');
console.log('Original files backed up.');
console.log('Run npm run dev to test.');
