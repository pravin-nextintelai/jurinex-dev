/**
 * Utility functions for matching extracted field values with dropdown options
 */

// Calculate similarity between two strings (0-1)
function stringSimilarity(str1, str2) {
  if (!str1 || !str2) return 0;

  const s1 = String(str1).toLowerCase().trim();
  const s2 = String(str2).toLowerCase().trim();
  
  // Exact match
  if (s1 === s2) return 1;
  
  // Contains match
  if (s1.includes(s2) || s2.includes(s1)) return 0.8;
  
  // Levenshtein-like similarity for words
  const words1 = s1.split(/\s+/);
  const words2 = s2.split(/\s+/);
  
  let matches = 0;
  for (const word1 of words1) {
    for (const word2 of words2) {
      if (word1 === word2) {
        matches++;
        break;
      } else if (word1.includes(word2) || word2.includes(word1)) {
        matches += 0.5;
        break;
      }
    }
  }
  
  const avgWords = (words1.length + words2.length) / 2;
  return matches / avgWords;
}

/**
 * Find best match in dropdown options
 * @param {string} extractedValue - The value extracted from document
 * @param {Array} options - Array of dropdown options
 * @param {Function} getLabel - Function to get label from option (default: option.name or option.label)
 * @param {Function} getValue - Function to get value from option (default: option.id or option.value)
 * @returns {Object|null} - Best matching option with match score
 */
export function findBestMatch(extractedValue, options, getLabel = null, getValue = null) {
  if (!extractedValue || !options || options.length === 0) {
    return null;
  }

  const getOptionLabel = getLabel || ((opt) => opt.name || opt.label || opt.jurisdiction_name || String(opt));
  const getOptionValue = getValue || ((opt) => opt.id || opt.value || opt);

  let bestMatch = null;
  let bestScore = 0;

  for (const option of options) {
    const optionLabel = getOptionLabel(option);
    if (!optionLabel) continue;

    const score = stringSimilarity(extractedValue, optionLabel);
    
    if (score > bestScore) {
      bestScore = score;
      bestMatch = {
        option,
        label: optionLabel,
        value: getOptionValue(option),
        score
      };
    }
  }

  // Only return if similarity is above threshold (0.3 = 30%)
  return bestScore >= 0.3 ? bestMatch : null;
}

/**
 * Match extracted caseType with dropdown options
 */
export function matchCaseType(extractedCaseType, caseTypes) {
  if (!extractedCaseType || !caseTypes) return null;
  return findBestMatch(extractedCaseType, caseTypes, 
    (opt) => opt.name, 
    (opt) => opt.id
  );
}

/**
 * Match extracted courtName with dropdown options
 */
export function matchCourtName(extractedCourtName, courts) {
  if (!extractedCourtName || !courts) return null;
  return findBestMatch(extractedCourtName, courts,
    (opt) => opt.name,
    (opt) => opt.id
  );
}

/**
 * Match extracted jurisdiction with dropdown options
 */
export function matchJurisdiction(extractedJurisdiction, jurisdictions) {
  if (!extractedJurisdiction || !jurisdictions) return null;
  return findBestMatch(extractedJurisdiction, jurisdictions,
    (opt) => opt.jurisdiction_name || opt.name,
    (opt) => opt.id
  );
}

/**
 * Match extracted subType with dropdown options
 */
export function matchSubType(extractedSubType, subTypes) {
  if (!extractedSubType || !subTypes) return null;
  return findBestMatch(extractedSubType, subTypes,
    (opt) => opt.name,
    (opt) => opt.id
  );
}

/**
 * Match priority level (fixed options)
 */
export function matchPriorityLevel(extractedPriority) {
  if (!extractedPriority) return null;
  
  const priorityOptions = ['Low', 'Medium', 'High'];
  const normalized = String(extractedPriority).trim();
  
  // Exact match
  const exactMatch = priorityOptions.find(p => 
    p.toLowerCase() === normalized.toLowerCase()
  );
  if (exactMatch) return exactMatch;
  
  // Fuzzy match
  const match = findBestMatch(normalized, priorityOptions);
  return match ? match.label : null;
}

/**
 * Match court level (common options)
 */
export function matchCourtLevel(extractedCourtLevel) {
  if (!extractedCourtLevel) return null;
  
  const courtLevelOptions = [
    'Supreme Court',
    'High Court',
    'District Court',
    'Session Court',
    'Magistrate Court',
    'Lower Court',
    'Tribunal'
  ];
  
  const match = findBestMatch(extractedCourtLevel, courtLevelOptions);
  return match ? match.label : extractedCourtLevel; // Return extracted value if no match found
}

