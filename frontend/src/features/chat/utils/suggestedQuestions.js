const DEFAULT_SUGGESTIONS = [
  'Give me a concise summary of this matter in 5 bullet points.',
  'What are the key legal issues and strongest arguments here?',
  'What facts, dates, and evidence should I study most carefully?',
  'What weaknesses, risks, or contradictions need deeper review?',
];

function hasAny(text, patterns) {
  const lower = String(text || '').toLowerCase();
  return patterns.some((pattern) => lower.includes(pattern));
}

export function buildSuggestedQuestions({ question = '', response = '', promptLabel = '' } = {}) {
  const baseText = `${question}\n${response}\n${promptLabel}`.toLowerCase();

  let suggestions = [...DEFAULT_SUGGESTIONS];

  if (hasAny(baseText, ['summary', 'brief', 'overview', 'output-template'])) {
    suggestions = [
      'Break this into a detailed issue-wise legal analysis.',
      'List the procedural history and current status in chronology.',
      'Explain the strongest and weakest points for each side.',
      'Identify the most important documents, facts, and evidence for deeper study.',
    ];
  } else if (hasAny(baseText, ['evidence', 'document', 'exhibit', 'witness'])) {
    suggestions = [
      'Which evidence is strongest and which evidence is weak or missing?',
      'What contradictions or gaps appear across the record?',
      'Which facts are admitted versus disputed?',
      'What questions should I ask next to test the evidence more deeply?',
    ];
  } else if (hasAny(baseText, ['procedure', 'history', 'timeline', 'date'])) {
    suggestions = [
      'Turn this into a precise procedural timeline with key dates.',
      'What deadlines, next steps, or procedural risks should I watch?',
      'Which hearings, filings, or orders matter most here?',
      'Summarize the status of the case for a lawyer preparing quickly.',
    ];
  }

  const normalized = new Set();
  return suggestions.filter((item) => {
    const key = item.trim().toLowerCase();
    if (!key || normalized.has(key)) return false;
    normalized.add(key);
    return true;
  }).slice(0, 4);
}
