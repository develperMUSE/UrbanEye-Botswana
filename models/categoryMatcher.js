'use strict';

/*
 URBANEYE BOTSWANA
 Detailed text and AI category recognition.

 Uses ORIGINAL categories in the existing MySQL database.
 Does not create or remove categories.
*/

const CATEGORY_RULES = [
  {
    category: 'Broken Streetlight',
    patterns: [
      /\bstreet\s*lights?\b/i,
      /\bstreetlights?\b/i,
      /\bstreet\s*lamps?\b/i,
      /\blamp\s*posts?\b/i,
      /\bstreet\s*lighting\b/i
    ]
  },
  {
    category: 'Burst Water Pipe',
    patterns: [
      /\bburst\s*(?:water\s*)?pipes?\b/i,
      /\bwater\s*pipes?\s*burst\b/i,
      /\bruptured\s*(?:water\s*)?pipes?\b/i,
      /\bburst\s*water\s*mains?\b/i
    ]
  },
  {
    category: 'Water Supply',
    patterns: [
      /\bno\s*water\b/i,
      /\bwater\s*shortage\b/i,
      /\bwater\s*outage\b/i,
      /\blow\s*water\s*pressure\b/i,
      /\bdry\s*taps?\b/i,
      /\bwater\s*supply\b/i
    ]
  },
  {
    category: 'Blocked Drainage',
    patterns: [
      /\bblocked\s*drains?\b/i,
      /\bblocked\s*drainage\b/i,
      /\bclogged\s*drains?\b/i,
      /\bstorm\s*water\s*drains?\b/i,
      /\bstormwater\s*drains?\b/i,
      /\bdrainage\s*blockage\b/i
    ]
  },
  {
    category: 'Illegal Dumping',
    patterns: [
      /\billegal\s*dumping\b/i,
      /\bdumped\s*rubbish\b/i,
      /\bdumped\s*garbage\b/i,
      /\bwaste\s*dumping\b/i,
      /\blittering\b/i,
      /\bgarbage\s*dump\b/i
    ]
  },
  {
    category: 'Pothole',
    patterns: [
      /\bpotholes?\b/i,
      /\bpot\s*holes?\b/i,
      /\bholes?\s*in\s*(?:the\s*)?road\b/i
    ]
  },
  {
    category: 'Damaged Road',
    patterns: [
      /\bdamaged\s*roads?\b/i,
      /\bcracked\s*roads?\b/i,
      /\broad\s*collapse\b/i,
      /\broad\s*erosion\b/i,
      /\bbroken\s*pavement\b/i,
      /\broad\s*damage\b/i
    ]
  }
];

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findCategory(categories, names) {
  return categories.find(category =>
    names.some(name =>
      normalize(category.category_name) === normalize(name)
    )
  ) || null;
}

function departmentMatch(categories, keywords) {
  return categories.filter(category => {
    const department = normalize(category.department_name);
    return keywords.some(word => department.includes(word));
  });
}

function resolveCategory(text, categories) {
  if (!String(text || '').trim() || !Array.isArray(categories)) {
    return null;
  }

  const input = String(text);

  // Electrical infrastructure has priority over road context.
  const electrical =
    /\b(power\s*lines?|powerlines?|electric(?:al|ity)?\s*(?:poles?|wires?|cables?|lines?)|power\s*poles?|transformers?|substations?|high\s*voltage|fallen\s*poles?|downed\s*wires?|power\s*outage|electricity\s*outage|blackout|no\s*electricity)\b/i;

  if (electrical.test(input)) {
    const powerCategories = departmentMatch(categories, [
      'bpc',
      'power corporation',
      'electricity',
      'electrical'
    ]);

    const specific = findCategory(powerCategories, [
      'Electrical Power Fault',
      'Power Related Issues',
      'Electricity Fault',
      'Power Outage',
      'Electrical Fault'
    ]);

    if (specific) return specific;
    if (powerCategories.length) return powerCategories[0];
  }

  // Sewage should not be confused with stormwater drainage.
  if (/\b(sewage|sewerage|sewer|septic|wastewater|overflowing\s*manhole|blocked\s*manhole)\b/i.test(input)) {
    const specific = findCategory(categories, [
      'Sewage / Sewerage Issue',
      'Sewage Issue',
      'Sewerage Issue',
      'Waste & Sewage Issues'
    ]);

    if (specific) return specific;

    const wasteCategories = departmentMatch(categories, [
      'waste',
      'sanitation',
      'sewage',
      'sewer'
    ]);

    if (wasteCategories.length) return wasteCategories[0];
  }

  const matches = [];

  for (const rule of CATEGORY_RULES) {
    const category = findCategory(categories, [rule.category]);
    if (!category) continue;

    const score = rule.patterns.filter(
      pattern => pattern.test(input)
    ).length;

    if (score > 0) {
      matches.push({ category, score });
    }
  }

  if (matches.length) {
    matches.sort((a, b) => b.score - a.score);

    if (
      matches.length > 1 &&
      matches[0].score === matches[1].score
    ) {
      return null;
    }

    return matches[0].category;
  }

  return null;
}

module.exports = {
  CATEGORY_RULES,
  normalize,
  resolveCategory
};