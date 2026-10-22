function tryParsePartialJson(text) {
  if (!text || typeof text !== 'string') return null;
  
  const jsonMatch = text.match(/```json\s*([\s\S]*?)(?:\s*```|$)/i);
  const jsonText = jsonMatch ? jsonMatch[1] : text.trim();
  
  if (jsonText.startsWith('{') || jsonText.startsWith('[')) {
    try {
      return JSON.parse(jsonText);
    } catch (e) {
      let fixedJson = jsonText;
      
      const openQuotes = (fixedJson.match(/"/g) || []).length;
      if (openQuotes % 2 !== 0) {
        fixedJson += '"';
      }
      
      const openBraces = (fixedJson.match(/\{/g) || []).length;
      const closeBraces = (fixedJson.match(/\}/g) || []).length;
      const openBrackets = (fixedJson.match(/\[/g) || []).length;
      const closeBrackets = (fixedJson.match(/\]/g) || []).length;
      
      for (let i = 0; i < openBraces - closeBraces; i++) {
        fixedJson += '}';
      }
      for (let i = 0; i < openBrackets - closeBrackets; i++) {
        fixedJson += ']';
      }
      
      try {
        return JSON.parse(fixedJson);
      } catch (e2) {
        return null;
      }
    }
  }
  
  return null;
}

// Helper function to convert markdown formatting to HTML
function convertMarkdownToHtml(text) {
  if (!text || typeof text !== 'string') return text;
  
  let converted = text;
  
  // Step 1: Convert all bold **text** to <strong>text</strong>
  // Use a more comprehensive regex that handles all cases including:
  // - **text**
  // - **text with spaces**
  // - **text** in the middle of sentences
  // - Multiple **text** in one line
  // Process multiple times to catch all instances
  let previousConverted = '';
  let iterations = 0;
  while (converted !== previousConverted && iterations < 10) {
    previousConverted = converted;
    // Match ** followed by any characters (non-greedy) followed by **
    converted = converted.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
    iterations++;
  }
  
  // Step 2: Convert italic *text* to <em>text</em> (but not if it's part of **)
  // Only match single asterisks that are not adjacent to another asterisk
  // This regex uses negative lookbehind and lookahead to ensure single asterisks
  converted = converted.replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, '<em>$1</em>');
  
  // Step 3: Handle any remaining standalone asterisks that might be formatting
  // Convert any remaining ** that weren't caught (edge cases)
  converted = converted.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
  
  // Step 4: Convert section references [SECTION X] to styled spans
  converted = converted.replace(/\[SECTION\s+(\d+)(?:,\s*SECTION\s+\d+)*\]/gi, '<span style="color: #666; font-size: 9pt;">[Section $1]</span>');
  
  // Step 5: Convert page references (Pages X-Y or Page X)
  converted = converted.replace(/\(Pages?\s+(\d+(?:-\d+)?)\)/gi, '<span style="color: #666; font-size: 9pt;">(Page $1)</span>');
  converted = converted.replace(/\(Page\s+(\d+)\)/gi, '<span style="color: #666; font-size: 9pt;">(Page $1)</span>');
  
  // Step 6: Convert exhibit references **EXHIBIT 'X'** to bold (if any remain)
  converted = converted.replace(/\*\*EXHIBIT\s+['"]?([A-Z0-9-]+)['"]?\*\*/gi, '<strong>EXHIBIT \'$1\'</strong>');
  
  return converted;
}

// Helper function to convert markdown table to HTML table
function convertMarkdownTableToHtml(tableLines) {
  if (!tableLines || tableLines.length < 2) return null;
  
  // Filter out separator lines (lines with only dashes, colons, pipes, and spaces)
  const validLines = tableLines.filter(line => {
    const trimmed = line.trim();
    return trimmed && !/^\|[\s\-:|]+\|?\s*$/.test(trimmed);
  });
  
  if (validLines.length === 0) return null;
  
  // Parse headers (first line)
  const headerLine = validLines[0];
  const headers = headerLine.split('|').map(h => h.trim()).filter(h => h);
  
  if (headers.length === 0) return null;
  
  // Parse data rows (remaining lines)
  const dataLines = validLines.slice(1);
  
  let html = '<table style="width: 100%; border-collapse: collapse; margin: 12pt 0; font-size: 11pt; border: 1px solid #000;">\n';
  html += '<thead>\n<tr style="background-color: #f0f0f0;">\n';
  
  headers.forEach(header => {
    const formattedHeader = convertMarkdownToHtml(header);
    html += `<th style="border: 1px solid #000; padding: 8pt; text-align: left; font-weight: bold; background-color: #f0f0f0;">${formattedHeader}</th>\n`;
  });
  
  html += '</tr>\n</thead>\n<tbody>\n';
  
  dataLines.forEach((line, index) => {
    const cells = line.split('|').map(c => c.trim()).filter(c => c);
    if (cells.length > 0) {
      // Pad cells if needed to match header count
      while (cells.length < headers.length) {
        cells.push('');
      }
      html += '<tr>\n';
      cells.slice(0, headers.length).forEach(cell => {
        const formattedCell = convertMarkdownToHtml(cell);
        html += `<td style="border: 1px solid #000; padding: 8pt; vertical-align: top;">${formattedCell}</td>\n`;
      });
      html += '</tr>\n';
    }
  });
  
  html += '</tbody>\n</table>\n';
  
  return html;
}

// Helper function to process text and convert markdown tables to HTML
function processTextWithTables(text) {
  if (!text || typeof text !== 'string') return '';
  
  const lines = text.split('\n');
  let result = '';
  let tableLines = [];
  let inTable = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();
    
    // Check if this is a table line (contains | and has proper format)
    const isTableLine = trimmedLine.includes('|') && trimmedLine.split('|').length >= 2;
    const isSeparator = /^\|[\s\-:|]+\|?\s*$/.test(trimmedLine);

    if (isTableLine || isSeparator) {
      if (!inTable) {
        // Start of a table
        inTable = true;
        tableLines = [];
      }
      tableLines.push(line);

      // Check if next line is not a table line (end of table)
      if (i < lines.length - 1) {
        const nextLine = lines[i + 1].trim();
        const nextIsTableLine = nextLine.includes('|') && nextLine.split('|').length >= 2;
        const nextIsSeparator = /^\|[\s\-:|]+\|?\s*$/.test(nextLine);
        
        if (!nextIsTableLine && !nextIsSeparator && nextLine.length > 0) {
          // End of table
          const tableHtml = convertMarkdownTableToHtml(tableLines);
          if (tableHtml) {
            result += tableHtml + '\n';
          } else {
            // If table conversion failed, add lines as-is
            result += tableLines.join('\n') + '\n';
          }
          inTable = false;
          tableLines = [];
        }
      } else {
        // Last line, end of table
        const tableHtml = convertMarkdownTableToHtml(tableLines);
        if (tableHtml) {
          result += tableHtml + '\n';
        } else {
          result += tableLines.join('\n') + '\n';
        }
        inTable = false;
        tableLines = [];
      }
    } else {
      // Not a table line
      if (inTable && tableLines.length > 0) {
        // End of table, convert it
        const tableHtml = convertMarkdownTableToHtml(tableLines);
        if (tableHtml) {
          result += tableHtml + '\n';
        } else {
          result += tableLines.join('\n') + '\n';
        }
        inTable = false;
        tableLines = [];
      }
      
      // Add regular text line
      if (trimmedLine) {
        result += line + '\n';
      } else {
        result += '\n';
      }
    }
  }
  
  // Handle remaining table if any
  if (inTable && tableLines.length > 0) {
    const tableHtml = convertMarkdownTableToHtml(tableLines);
    if (tableHtml) {
      result += tableHtml + '\n';
    } else {
      result += tableLines.join('\n') + '\n';
    }
  }
  
  // Now process the result to format paragraphs and lists
  const paragraphs = result.split(/\n\n+/).filter(p => p.trim());
  let formattedResult = '';
  
  paragraphs.forEach(para => {
    const trimmedPara = para.trim();
    
    // Skip if it's already HTML (table)
    if (trimmedPara.startsWith('<table')) {
      formattedResult += trimmedPara + '\n\n';
    } else if (trimmedPara.startsWith('*') || trimmedPara.startsWith('-')) {
      // Handle bullet points
      const bullets = trimmedPara.split(/\n(?=[*-])/).filter(b => b.trim());
      formattedResult += '<ul style="margin: 6pt 0; padding-left: 24pt;">\n';
      bullets.forEach(bullet => {
        let cleanBullet = bullet.replace(/^[*-]\s*/, '').trim();
        cleanBullet = convertMarkdownToHtml(cleanBullet);
        formattedResult += `<li style="margin: 3pt 0;">${cleanBullet}</li>\n`;
      });
      formattedResult += '</ul>\n\n';
    } else if (trimmedPara) {
      // Regular paragraph
      const formattedPara = convertMarkdownToHtml(trimmedPara);
      formattedResult += `<p style="margin: 6pt 0; text-indent: 0.5in;">${formattedPara}</p>\n\n`;
    }
  });
  
  return formattedResult;
}

export function renderSecretPromptResponse(response) {
  if (!response) {
    return '';
  }

  let jsonData = null;
  if (typeof response === 'object' && response !== null) {
    jsonData = response;
    console.log('[renderSecretPromptResponse] Response is already an object');
  } else if (typeof response === 'string') {
    // First, try to extract JSON from markdown code blocks
    const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/i);
    if (jsonMatch) {
      try {
        const jsonText = jsonMatch[1].trim();
        jsonData = JSON.parse(jsonText);
        console.log('[renderSecretPromptResponse] ✅ Successfully parsed JSON from markdown code block');
      } catch (e) {
        console.warn('[renderSecretPromptResponse] Failed to parse JSON from code block, trying partial parse:', e.message);
        jsonData = tryParsePartialJson(jsonMatch[1]);
        if (!jsonData) {
          try {
            // Try to fix common JSON issues
            let cleaned = jsonMatch[1].trim();
            // Remove trailing commas before closing braces/brackets
            cleaned = cleaned.replace(/,(\s*[}\]])/g, '$1');
            // Try to close unclosed strings
            const openQuotes = (cleaned.match(/"/g) || []).length;
            if (openQuotes % 2 !== 0) {
              cleaned += '"';
            }
            jsonData = JSON.parse(cleaned);
            console.log('[renderSecretPromptResponse] ✅ Successfully parsed after cleaning');
          } catch (e2) {
            console.warn('[renderSecretPromptResponse] Failed to parse cleaned JSON:', e2.message);
          }
        }
      }
    } else {
      // Try to find JSON in the string
      const trimmed = response.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          jsonData = JSON.parse(trimmed);
          console.log('[renderSecretPromptResponse] ✅ Successfully parsed direct JSON');
        } catch (e) {
          console.warn('[renderSecretPromptResponse] Failed to parse direct JSON, trying partial parse:', e.message);
          jsonData = tryParsePartialJson(response);
          if (!jsonData) {
            // Try to extract JSON from the string
            const jsonPattern = /\{[\s\S]{50,}\}/;
            const match = trimmed.match(jsonPattern);
            if (match) {
              try {
                let jsonStr = match[0];
                // Fix common issues
                jsonStr = jsonStr.replace(/,(\s*[}\]])/g, '$1');
                jsonData = JSON.parse(jsonStr);
                console.log('[renderSecretPromptResponse] ✅ Successfully parsed JSON from pattern match');
              } catch (e2) {
                jsonData = tryParsePartialJson(match[0]);
                if (!jsonData) {
                  console.warn('[renderSecretPromptResponse] Could not parse JSON from pattern match');
                  // Return as plain text if we can't parse
                  return response;
                }
              }
            } else {
              console.warn('[renderSecretPromptResponse] No JSON pattern found in response');
              return response;
            }
          }
        }
      } else {
        // Look for JSON anywhere in the string
        const jsonPattern = /\{[\s\S]{50,}\}/;
        const match = response.match(jsonPattern);
        if (match) {
          try {
            let jsonStr = match[0];
            // Fix common JSON issues
            jsonStr = jsonStr.replace(/,(\s*[}\]])/g, '$1');
            jsonData = JSON.parse(jsonStr);
            console.log('[renderSecretPromptResponse] ✅ Successfully parsed JSON from pattern match');
          } catch (e) {
            jsonData = tryParsePartialJson(match[0]);
            if (!jsonData) {
              console.warn('[renderSecretPromptResponse] Could not parse JSON from pattern match');
              return response;
            }
          }
        } else {
          console.warn('[renderSecretPromptResponse] No JSON pattern found in response');
          return response;
        }
      }
    }
  }

  if (!jsonData || typeof jsonData !== 'object') {
    console.warn('[renderSecretPromptResponse] No valid JSON data found, attempting additional parsing');
    // If it's a string that looks like JSON but couldn't be parsed, try one more time
    if (typeof response === 'string') {
      console.warn('[renderSecretPromptResponse] Attempting final JSON parse attempt');
      try {
        // Remove markdown code blocks
        let cleaned = response.trim()
          .replace(/```json\s*/gi, '')
          .replace(/```\s*/g, '')
          .trim();
        
        // Try to extract JSON if it's embedded in text
        if (!cleaned.startsWith('{') && !cleaned.startsWith('[')) {
          const jsonPattern = /\{[\s\S]{50,}\}/;
          const match = cleaned.match(jsonPattern);
          if (match) {
            cleaned = match[0];
          }
        }
        
        // Fix common JSON issues
        cleaned = cleaned.replace(/,(\s*[}\]])/g, '$1');
        
        jsonData = JSON.parse(cleaned);
        console.log('[renderSecretPromptResponse] ✅ Successfully parsed on final attempt');
      } catch (e) {
        console.error('[renderSecretPromptResponse] Final parse attempt failed:', e.message);
        // If we still can't parse, but it looks like JSON, show a formatted error message
        if (response.includes('schemas') || response.includes('generated_sections') || response.includes('output_summary_template')) {
          console.warn('[renderSecretPromptResponse] Response appears to be JSON but parsing failed, returning formatted error');
          return `<div style="font-family: 'Times New Roman', serif; padding: 20px; color: #d32f2f;">
            <h2 style="color: #d32f2f;">⚠️ Error Rendering Document</h2>
            <p>The response contains structured data but could not be parsed. Please check the console for details.</p>
            <pre style="background: #f5f5f5; padding: 10px; border: 1px solid #ddd; overflow-x: auto;">${response.substring(0, 500)}...</pre>
          </div>`;
        }
        return response; // Return original if all parsing fails
      }
    } else {
      return response;
    }
  }
  
  console.log('[renderSecretPromptResponse] Processing JSON data structure:', {
    hasSchemas: !!(jsonData.schemas),
    hasOutputTemplate: !!(jsonData.schemas?.output_summary_template),
    hasGeneratedSections: !!(jsonData.generated_sections || jsonData.schemas?.output_summary_template?.generated_sections),
    keys: Object.keys(jsonData)
  });
  
  console.log('[renderSecretPromptResponse] Processing JSON data structure:', {
    hasSchemas: !!(jsonData.schemas),
    hasOutputTemplate: !!(jsonData.schemas?.output_summary_template),
    hasGeneratedSections: !!(jsonData.generated_sections || jsonData.schemas?.output_summary_template?.generated_sections)
  });

  let markdown = '';

  function parseAnnexureSummary(text) {
    if (!text) return '';
    
    const exhibits = [];
    
    const lines = text.split('\n').filter(line => line.trim());
    
    lines.forEach(line => {
      const exhibitMatch = line.match(/\*\*Exhibit\s+([A-Z0-9-]+(?:\s*\([^)]+\))?):\*\*\s*(.+)/i);
      if (exhibitMatch) {
        const exhibit = exhibitMatch[1].trim();
        let description = exhibitMatch[2].trim();
        
        const sectionMatches = description.match(/\[SECTION\s+(\d+)(?:,\s*SECTION\s+\d+)*\]/g);
        let pageRef = 'N/A';
        if (sectionMatches && sectionMatches.length > 0) {
          const sectionNums = [];
          sectionMatches.forEach(match => {
            const nums = match.match(/\d+/g);
            if (nums) sectionNums.push(...nums);
          });
          const uniqueSections = [...new Set(sectionNums)].sort((a, b) => parseInt(a) - parseInt(b));
          pageRef = uniqueSections.length > 0 ? uniqueSections.join(', ') : 'N/A';
        }
        
        const pageNumMatch = description.match(/(?:page|pages?|pg\.?)\s*(\d+(?:-\d+)?)/i);
        if (pageNumMatch) {
          pageRef = pageNumMatch[1];
        }
        
        let cleanDescription = description.replace(/\[SECTION\s+\d+(?:,\s*SECTION\s+\d+)*\]/g, '').trim();
        
        let keyInsight = cleanDescription;
        
        const importantPhrases = [
          /(?:proves?|shows?|demonstrates?|confirms?|establishes?|indicates?)\s+([^.]+)/i,
          /(?:evidence|proof|confirmation|establishment)\s+of\s+([^.]+)/i,
        ];
        
        for (const pattern of importantPhrases) {
          const match = cleanDescription.match(pattern);
          if (match) {
            keyInsight = match[1] || match[0];
            break;
          }
        }
        
        if (keyInsight.length > 150) {
          const sentenceMatch = keyInsight.match(/^(.{0,150}[.!?])\s/);
          if (sentenceMatch) {
            keyInsight = sentenceMatch[1];
          } else {
            keyInsight = keyInsight.substring(0, 147) + '...';
          }
        }
        
        cleanDescription = cleanDescription.replace(/\s+/g, ' ').trim();
        
        exhibits.push({
          exhibit: exhibit.replace(/\(Colly\.\)/i, '(Colly.)'),
          description: cleanDescription,
          pageRef: pageRef,
          keyInsight: keyInsight
        });
      }
    });
    
    if (exhibits.length > 0) {
      let table = '| EXHIBIT | DESCRIPTION | PAGE REF. | KEY INSIGHT |\n';
      table += '|---------|-------------|-----------|-------------|\n';
      exhibits.forEach(exp => {
        const safeDesc = exp.description.replace(/\|/g, '\\|').replace(/\n/g, ' ');
        const safeInsight = exp.keyInsight.replace(/\|/g, '\\|').replace(/\n/g, ' ');
        table += `| ${exp.exhibit} | ${safeDesc} | ${exp.pageRef} | ${safeInsight} |\n`;
      });
      return table;
    }
    
    return text;
  }

  function formatProceduralTimeline(text) {
    if (!text) return '';

    // Matches dates in DD.MM.YYYY, DD/MM/YYYY, DD-MM-YYYY formats (with optional spaces
    // around the separator — e.g. "18 / 06 / 2001" as produced by some OCR sources).
    // The date may or may not be followed by a colon inside the bold markers.
    const datePattern = /\*\*(\d{1,2}\s*[.\/\-]\s*\d{1,2}\s*[.\/\-]\s*\d{4})\s*:?\*\*\s*([\s\S]*?)(?=\n{1,2}\*\*\d{1,2}\s*[.\/\-]|\s*$)/g;
    const events = [];
    let match;

    while ((match = datePattern.exec(text)) !== null) {
      const rawDate = match[1].replace(/\s+/g, '');
      const event = (match[2] || '')
        .trim()
        .replace(/\[SECTION\s+\d+(?:,\s*SECTION\s+\d+)*\]/g, '')
        .replace(/\n+/g, ' ')
        .replace(/\|/g, '\\|')
        .trim();
      if (rawDate) {
        events.push({ date: rawDate, event });
      }
    }

    if (events.length > 0) {
      // Return a GFM markdown table — works in both the HTML path (via processTextWithTables)
      // and the plain-markdown path (via ReactMarkdown + remarkGfm + markdownTableComponents).
      let table = '| Date | Event |\n|------|-------|\n';
      events.forEach(({ date, event }) => {
        table += `| ${date} | ${event} |\n`;
      });
      return table;
    }

    return text;
  }

  if (jsonData.schemas && jsonData.schemas.output_summary_template) {
    const template = jsonData.schemas.output_summary_template;
    
    // Document Header - Word Document Style
    if (template.metadata) {
      markdown += '<div style="font-family: \'Times New Roman\', serif; line-height: 1.6; max-width: 8.5in; margin: 0 auto; padding: 1in;">\n\n';
      
      if (template.metadata.document_title) {
        const formattedTitle = convertMarkdownToHtml(template.metadata.document_title);
        markdown += `<h1 style="text-align: center; font-size: 18pt; font-weight: bold; margin-bottom: 12pt; text-transform: uppercase;">${formattedTitle}</h1>\n\n`;
      }
      
      markdown += '<div style="margin-bottom: 24pt;">\n';
      if (template.metadata.case_title) {
        const formattedCaseTitle = convertMarkdownToHtml(template.metadata.case_title);
        markdown += `<p style="margin: 6pt 0;"><strong>Case Title:</strong> ${formattedCaseTitle}</p>\n`;
      }
      if (template.metadata.date && !isReplaceableMetadataDate(template.metadata.date)) {
        const formattedDate = convertMarkdownToHtml(template.metadata.date);
        markdown += `<p style="margin: 6pt 0;"><strong>Date:</strong> ${formattedDate}</p>\n`;
      }
      if (template.metadata.prepared_by && !isPlaceholderPreparedBy(template.metadata.prepared_by)) {
        const formattedPreparedBy = convertMarkdownToHtml(template.metadata.prepared_by);
        markdown += `<p style="margin: 6pt 0;"><strong>Prepared By:</strong> ${formattedPreparedBy}</p>\n`;
      }
      markdown += '</div>\n\n';
      
      markdown += '<hr style="border: none; border-top: 1px solid #000; margin: 24pt 0;" />\n\n';
    }

    if (template.generated_sections) {
      const sectionOrder = [
        { key: '2_1_ground_wise_summary', title: '2.1 Ground-wise Summary with Supporting Facts' },
        { key: '2_2_annexure_summary', title: '2.2 Annexure Summary with Page References' },
        { key: '2_3_risk_and_weak_points', title: '2.3 Risk and Weak Points' },
        { key: '2_4_expected_counter_arguments', title: '2.4 Expected Counter Arguments' },
        { key: '2_5_evidence_matrix', title: '2.5 Evidence Matrix' },
        { key: '2_6_opponent_submissions_summary', title: '2.6 Summary of Opponent\'s Submissions' },
        { key: '2_7_procedural_timeline_summary', title: '2.7 Procedural Timeline Summary' },
        { key: '2_8_legal_strategy_note', title: '2.8 Legal Strategy Note' },
        { key: '2_9_compliance_and_deficiency_summary', title: '2.9 Compliance and Deficiency Summary' },
        { key: '2_10_court_history_summary', title: '2.10 Court History Summary' },
      ];

      sectionOrder.forEach(({ key, title }) => {
        const section = template.generated_sections[key];
        if (section && section.generated_text) {
          const text = section.generated_text.trim();
          if (text && !text.match(/^Summary Type:\s*(Extractive|Abstractive|Extractive \+ Abstractive)$/i)) {
            // Section Header - Word Document Style
            markdown += `<h2 style="font-size: 14pt; font-weight: bold; margin-top: 24pt; margin-bottom: 12pt; color: #1a1a1a; page-break-after: avoid;">${title}</h2>\n\n`;
            
            // Section Content
            markdown += '<div style="margin-bottom: 18pt; text-align: justify;">\n';
            
            if (key === '2_2_annexure_summary') {
              const tableContent = parseAnnexureSummary(text);
              if (tableContent && tableContent.includes('|')) {
                // Convert markdown table to HTML table for better Word-like formatting
                const lines = tableContent.split('\n').filter(l => l.trim());
                const headerLine = lines[0];
                const separatorLine = lines[1];
                const dataLines = lines.slice(2);
                
                if (headerLine && dataLines.length > 0) {
                  const headers = headerLine.split('|').map(h => h.trim()).filter(h => h);
                  markdown += '<table style="width: 100%; border-collapse: collapse; margin: 12pt 0; font-size: 11pt;">\n';
                  markdown += '<thead>\n<tr style="background-color: #f0f0f0;">\n';
                  headers.forEach(header => {
                    const formattedHeader = convertMarkdownToHtml(header);
                    markdown += `<th style="border: 1px solid #000; padding: 8pt; text-align: left; font-weight: bold;">${formattedHeader}</th>\n`;
                  });
                  markdown += '</tr>\n</thead>\n<tbody>\n';
                  
                  dataLines.forEach(line => {
                    const cells = line.split('|').map(c => c.trim()).filter(c => c);
                    if (cells.length > 0) {
                      markdown += '<tr>\n';
                      cells.forEach(cell => {
                        const formattedCell = convertMarkdownToHtml(cell).replace(/\|/g, '|');
                        markdown += `<td style="border: 1px solid #000; padding: 8pt; vertical-align: top;">${formattedCell}</td>\n`;
                      });
                      markdown += '</tr>\n';
                    }
                  });
                  
                  markdown += '</tbody>\n</table>\n';
                } else {
                  // parseAnnexureSummary returned a table string but it was empty — fall back
                  // to processTextWithTables so any embedded markdown tables are preserved
                  markdown += processTextWithTables(text);
                }
              } else {
                // No exhibit pattern found — render raw text, preserving any markdown tables
                markdown += processTextWithTables(text);
              }
            }
            else if (key === '2_7_procedural_timeline_summary') {
              const timelineContent = formatProceduralTimeline(text);
              // processTextWithTables converts GFM markdown tables → HTML tables and
              // wraps remaining paragraphs in <p> tags, preserving all table structure.
              const processedContent = processTextWithTables(timelineContent);
              markdown += processedContent;
            }
            else {
              // Process text with table detection and conversion
              const processedContent = processTextWithTables(text);
              markdown += processedContent;
            }
            
            markdown += '</div>\n\n';
            
            // Summary Type Footer
            if (section.required_summary_type) {
              markdown += `<p style="margin-top: 6pt; font-size: 10pt; font-style: italic; color: #666;"><em>Summary Type: ${section.required_summary_type}</em></p>\n\n`;
            }
            
            markdown += '<hr style="border: none; border-top: 1px solid #ddd; margin: 18pt 0;" />\n\n';
          }
        }
      });
      
      // Close document wrapper
      markdown += '</div>\n';
    }
  }
  else if (jsonData.generated_sections) {
    if (jsonData.metadata) {
      if (jsonData.metadata.document_title) {
        markdown += `# ${jsonData.metadata.document_title}\n\n`;
      }
      if (jsonData.metadata.case_title) {
        markdown += `**Case:** ${jsonData.metadata.case_title}\n\n`;
      }
      if (jsonData.metadata.date && !isReplaceableMetadataDate(jsonData.metadata.date)) {
        markdown += `**Date:** ${jsonData.metadata.date}\n\n`;
      }
      if (jsonData.metadata.prepared_by && !isPlaceholderPreparedBy(jsonData.metadata.prepared_by)) {
        markdown += `**Prepared By:** ${jsonData.metadata.prepared_by}\n\n`;
      }
      markdown += '---\n\n';
    }

    if (jsonData.title) {
      markdown += `# ${jsonData.title}\n\n`;
    }

    if (jsonData.summary) {
      markdown += `> ${jsonData.summary}\n\n`;
      markdown += '---\n\n';
    }

    const sectionOrder = [
      { key: '2_1_ground_wise_summary', title: 'Ground-wise Summary' },
      { key: '2_2_annexure_summary', title: 'Annexure Summary' },
      { key: '2_3_risk_and_weak_points', title: 'Risk and Weak Points' },
      { key: '2_4_expected_counter_arguments', title: 'Expected Counter Arguments' },
      { key: '2_5_evidence_matrix', title: 'Evidence Matrix' },
      { key: '2_6_opponent_submissions_summary', title: 'Opponent Submissions Summary' },
      { key: '2_7_procedural_timeline_summary', title: 'Procedural Timeline Summary' },
      { key: '2_8_legal_strategy_note', title: 'Legal Strategy Note' },
      { key: '2_9_compliance_and_deficiency_summary', title: 'Compliance and Deficiency Summary' },
      { key: '2_10_court_history_summary', title: 'Court History Summary' },
    ];

    sectionOrder.forEach(({ key, title }) => {
      const section = jsonData.generated_sections[key];
      if (section && section.generated_text) {
        const text = section.generated_text.trim();
        if (text && !text.match(/^Summary Type:\s*(Extractive|Abstractive|Extractive \+ Abstractive)$/i) && text.length > 10) {
          markdown += `## ${title}\n\n`;
          
          if (key === '2_2_annexure_summary') {
            const tableContent = parseAnnexureSummary(text);
            markdown += tableContent || text;
          }
          else if (key === '2_7_procedural_timeline_summary') {
            const timelineContent = formatProceduralTimeline(text);
            markdown += timelineContent || text;
          }
          else if (key === '2_5_evidence_matrix') {
            let cleanedText = text.replace(/\[List key documents[^\]]*\]/gi, '');
            cleanedText = cleanedText.replace(/\[Witness Name\]:\s*\[Role[^\]]*\]/gi, '');
            cleanedText = cleanedText.replace(/\[Expert Name\]:\s*\[Expertise[^\]]*\]/gi, '');
            cleanedText = cleanedText.replace(/\[Description[^\]]*\]/gi, '');
            cleanedText = cleanedText.replace(/\[Date\]:\s*\[Description[^\]]*\]/gi, '');
            cleanedText = cleanedText.replace(/\[Relevant[^\]]*\]/gi, '');
            cleanedText = cleanedText.replace(/\[Case Name\]:\s*\[Holding[^\]]*\]/gi, '');
            cleanedText = cleanedText.replace(/\[Burden[^\]]*\]/gi, '');
            cleanedText = cleanedText.replace(/\[Monetary[^\]]*\]/gi, '');
            cleanedText = cleanedText.replace(/\[Specific[^\]]*\]/gi, '');
            cleanedText = cleanedText.replace(/\[Dismissal[^\]]*\]/gi, '');
            cleanedText = cleanedText.replace(/\[Date\]:\s*\[Motion[^\]]*\]/gi, '');
            cleanedText = cleanedText.replace(/\[Any temporary[^\]]*\]/gi, '');
            cleanedText = cleanedText.replace(/\[Summary[^\]]*\]/gi, '');
            cleanedText = cleanedText.replace(/\[Pending[^\]]*\]/gi, '');
            cleanedText = cleanedText.replace(/\[Upcoming[^\]]*\]/gi, '');
            cleanedText = cleanedText.replace(/\[When[^\]]*\]/gi, '');
            cleanedText = cleanedText.replace(/\[Court's[^\]]*\]/gi, '');
            cleanedText = cleanedText.replace(/\[Summary[^\]]*\]/gi, '');
            cleanedText = cleanedText.replace(/\[Specific[^\]]*\]/gi, '');
            cleanedText = cleanedText.replace(/\[Yes\/No[^\]]*\]/gi, '');
            cleanedText = cleanedText.replace(/\[Any collection[^\]]*\]/gi, '');
            cleanedText = cleanedText.replace(/\[Award[^\]]*\]/gi, '');
            cleanedText = cleanedText.replace(/\[Any additional[^\]]*\]/gi, '');
            cleanedText = cleanedText.replace(/\[List of all[^\]]*\]/gi, '');
            cleanedText = cleanedText.replace(/\[Name\]/gi, '');
            cleanedText = cleanedText.replace(/\[Date\]/gi, '');
            cleanedText = cleanedText.replace(/\n{3,}/g, '\n\n');
            markdown += cleanedText.trim() || text;
          }
          else {
            markdown += text;
          }
          
          markdown += '\n\n';
          markdown += '---\n\n';
        }
      }
    });

    if (jsonData.keyFindings && Array.isArray(jsonData.keyFindings) && jsonData.keyFindings.length > 0) {
      markdown += '## Key Findings\n\n';
      jsonData.keyFindings.forEach((finding) => {
        if (finding && typeof finding === 'string' && finding.trim()) {
          markdown += `- ${finding}\n`;
        }
      });
      markdown += '\n---\n\n';
    }

    if (jsonData.recommendations && Array.isArray(jsonData.recommendations) && jsonData.recommendations.length > 0) {
      markdown += '## Recommendations\n\n';
      jsonData.recommendations.forEach((recommendation) => {
        if (recommendation && typeof recommendation === 'string' && recommendation.trim()) {
          markdown += `- ${recommendation}\n`;
        }
      });
      markdown += '\n';
    }
  }
  else {
    if (jsonData.title) {
      markdown += `# ${jsonData.title}\n\n`;
    }

    if (jsonData.summary) {
      markdown += `> ${jsonData.summary}\n\n`;
      markdown += '---\n\n';
    }

    if (jsonData.sections && Array.isArray(jsonData.sections)) {
      jsonData.sections.forEach((section, index) => {
        if (section.heading) {
          markdown += `## ${section.heading}\n\n`;
        }
        
        if (section.content) {
          markdown += `${section.content}\n\n`;
        }

        if (section.subsections && Array.isArray(section.subsections)) {
          section.subsections.forEach((subsection) => {
            if (subsection.heading) {
              markdown += `### ${subsection.heading}\n\n`;
            }
            
            if (subsection.content) {
              markdown += `${subsection.content}\n\n`;
            }
          });
        }

        if (index < jsonData.sections.length - 1) {
          markdown += '---\n\n';
        }
      });
    }

    if (jsonData.keyFindings && Array.isArray(jsonData.keyFindings) && jsonData.keyFindings.length > 0) {
      markdown += '## Key Findings\n\n';
      jsonData.keyFindings.forEach((finding) => {
        if (finding && typeof finding === 'string' && finding.trim()) {
          markdown += `- ${finding}\n`;
        }
      });
      markdown += '\n';
    }

    if (jsonData.recommendations && Array.isArray(jsonData.recommendations) && jsonData.recommendations.length > 0) {
      markdown += '## Recommendations\n\n';
      jsonData.recommendations.forEach((recommendation) => {
        if (recommendation && typeof recommendation === 'string' && recommendation.trim()) {
          markdown += `- ${recommendation}\n`;
        }
      });
      markdown += '\n';
    }

    if (jsonData.metadata && typeof jsonData.metadata === 'object') {
      const metadataEntries = Object.entries(jsonData.metadata).filter(([_, value]) => value);
      if (metadataEntries.length > 0) {
        markdown += '---\n\n';
        markdown += '### Metadata\n\n';
        metadataEntries.forEach(([key, value]) => {
          const readableKey = key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase()).trim();
          markdown += `**${readableKey}:** ${value}\n\n`;
        });
      }
    }
  }

  // If markdown contains HTML (Word document style), return as-is
  // Otherwise, return markdown for ReactMarkdown to process
  if (markdown.includes('<div style=') || markdown.includes('<h1 style=') || markdown.includes('<h2 style=')) {
    return markdown.trim();
  }
  
  return markdown.trim();
}

export function isStructuredJsonResponse(response) {
  if (!response) return false;
  
  if (typeof response === 'object' && response !== null) {
    // Check for structured JSON patterns
    if (response.title || response.sections || response.summary) return true;
    if (response.schemas && response.schemas.output_summary_template) return true;
    if (response.generated_sections) return true;
    if (response.metadata && response.generated_sections) return true;
    // Check if it looks like a structured response object
    if (typeof response === 'object' && Object.keys(response).length > 0) {
      const keys = Object.keys(response);
      if (keys.some(k => k.includes('section') || k.includes('metadata') || k.includes('schema'))) {
        return true;
      }
    }
    return false;
  }
  
  if (typeof response === 'string') {
    let jsonToCheck = response;
    
    // Extract JSON from markdown code blocks
    const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/i);
    if (jsonMatch) {
      jsonToCheck = jsonMatch[1].trim();
    } else {
      jsonToCheck = response.trim();
    }
    
    // Check if it starts with JSON structure
    if (jsonToCheck.startsWith('{') || jsonToCheck.startsWith('[')) {
      try {
        const parsed = JSON.parse(jsonToCheck);
        if (parsed.title || parsed.sections || parsed.summary) return true;
        if (parsed.schemas && parsed.schemas.output_summary_template) return true;
        if (parsed.generated_sections) return true;
        if (parsed.metadata && parsed.generated_sections) return true;
        // Check for any structured pattern
        if (typeof parsed === 'object' && Object.keys(parsed).length > 0) {
          const keys = Object.keys(parsed);
          if (keys.some(k => k.includes('section') || k.includes('metadata') || k.includes('schema'))) {
            return true;
          }
        }
      } catch (e) {
        // Try to find JSON pattern in the string
        const jsonPattern = /\{[\s\S]{50,}\}/;
        const match = jsonToCheck.match(jsonPattern);
        if (match) {
          try {
            let jsonStr = match[0];
            // Fix common JSON issues
            jsonStr = jsonStr.replace(/,(\s*[}\]])/g, '$1');
            const parsed = JSON.parse(jsonStr);
            if (parsed.schemas && parsed.schemas.output_summary_template) return true;
            if (parsed.generated_sections) return true;
            if (parsed.metadata && parsed.generated_sections) return true;
            // Check for structured pattern
            if (typeof parsed === 'object' && Object.keys(parsed).length > 0) {
              const keys = Object.keys(parsed);
              if (keys.some(k => k.includes('section') || k.includes('metadata') || k.includes('schema'))) {
                return true;
              }
            }
          } catch (e2) {
            // Try partial parse
            const partial = tryParsePartialJson(match[0]);
            if (partial) {
              if (partial.schemas && partial.schemas.output_summary_template) return true;
              if (partial.generated_sections) return true;
            }
            return false;
          }
        }
        return false;
      }
    } else {
      // Look for JSON anywhere in the string
      const jsonPattern = /\{[\s\S]{50,}\}/;
      const match = jsonToCheck.match(jsonPattern);
      if (match) {
        try {
          let jsonStr = match[0];
          jsonStr = jsonStr.replace(/,(\s*[}\]])/g, '$1');
          const parsed = JSON.parse(jsonStr);
          if (parsed.schemas && parsed.schemas.output_summary_template) return true;
          if (parsed.generated_sections) return true;
          if (parsed.metadata && parsed.generated_sections) return true;
          return true;
        } catch (e) {
          const partial = tryParsePartialJson(match[0]);
          if (partial && (partial.schemas || partial.generated_sections)) {
            return true;
          }
        }
      }
    }
    return false;
  }
  
  return false;
}

function isPlaceholderPreparedBy(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return !normalized || ['legal analyst', 'actual preparer name', 'not specified in document', 'unknown', 'n/a', 'na'].includes(normalized);
}

function isReplaceableMetadataDate(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return !normalized
    || ['actual date', 'date', 'not specified in document', 'unknown', 'n/a', 'na'].includes(normalized)
    || /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());
}
