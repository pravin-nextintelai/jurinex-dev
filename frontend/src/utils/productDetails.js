/**
 * Long-form content for the per-product pages at /products/<id>.
 * Written from the Jurinex Beginner's User Guide and the platform
 * deck. Keep claims to shipped behaviour; no invented numbers.
 *
 * Shape per product:
 *   title, lede            hero headline and standfirst
 *   figure                 { query, inputLabel, stack?, caption, outputLabel, lines }  hero diagram
 *   liveLede               one line under "A live look"
 *   steps[]                numbered "how it works" cards, each with on-screen labels
 *   uses[]                 { title, text, before, after }  numbered use cases
 *   pipeline               { heading, items[], note }  arrow strip
 *   columns[]              { icon, title, text, bullets[] }  capability columns
 *   table                  { heading, lede, rows[{ icon, label, value }] }  optional
 *   tips                   { heading, items[{ title, text }] }
 *   faqs[]                 { q, a }
 */
export const PRODUCT_DETAILS = {
  "create-case": {
    title: "Creating and Managing a Case",
    lede:
      "A case is a folder for one matter: its documents, details, AI analysis and conversations. Creating one takes four steps, and everything you do afterwards reads from what was built here.",
    figure: {
      query: "Writ_Petition_2598.pdf · Annexures A to F · Impugned order (scan)",
      inputLabel: "Upload",
      caption: "Case memory · built once",
      outputLabel: "Case · ready to answer",
      lines: ["Case Summary and Case Brief", "List of Dates & Events, linked to pages", "Hearing Preparation and Prayer Matrix", "Statute & Section Radar, Gap Reasoning"],
    },
    liveLede:
      "The Case Briefs screen: five counters across the top, the Ongoing, Pending, Disposed and Draft tabs, and every matter with its court, type, advocate, next hearing, status and document count.",
    steps: [
      {
        title: "Upload",
        screen: ["Initiate tab", "Drag & drop or Browse", "Auto Remind Next Hearing", "Auto Fill · Continue"],
        text: "Upload the case documents to begin, one file or many. Drag them into the upload box or browse from your computer. PDF, DOC, DOCX, TXT, JPEG, PNG and GIF are accepted, up to 200 MB per file. Clean scans work best.",
      },
      {
        title: "Auto Fill, or not",
        screen: ["Details tab", "Case title, prefix, number", "Court, bench, case type", "Filing and hearing dates"],
        text: "Click Auto Fill and Jurinex reads the documents and extracts the details: title, court, bench, case type, filing date, parties and prayer. Or skip it, click Continue, and fill them in yourself on the Details and Parties screens.",
      },
      {
        title: "Review",
        screen: ["Review tab", "Parties involved", "Confirmation checkbox", "Create Case"],
        text: "The review screen shows everything you entered: case particulars, petitioners and respondents with their advocates, status and dates. Go Back to fix anything, tick the confirmation and click Create Case.",
      },
      {
        title: "Processing",
        screen: ["AI Analysis Status", "OCR Extraction", "Document Processing", "Generating Chronology"],
        text: "Jurinex reads the documents in the background. Once processing completes, the case is ready to answer questions, and the chronology, summaries and briefs are waiting inside it.",
      },
    ],
    pipeline: {
      heading: "What happens in the background",
      items: ["OCR Extraction", "Document Processing", "Generating Chronology", "Ready to Answer"],
      note: "Processing typically takes one to three minutes for a 50-page document. You can close the browser and come back to it.",
    },
    columns: [
      {
        icon: "ClipboardList",
        title: "Case details, structured",
        text: "The Details screen holds everything a court file needs, so later drafts and searches can use it.",
        bullets: [
          "Case title, prefix and number",
          "Adjudicating authority, court or tribunal, and bench",
          "Case nature, type and sub-type",
          "Date of filing, next hearing date and status",
          "Auto Remind Next Hearing, switched on at upload",
        ],
      },
      {
        icon: "Users",
        title: "Parties and advocates",
        text: "Petitioners and respondents are recorded separately, each with a party type and advocate on record.",
        bullets: [
          "Individual, company or government authority",
          "Advocate name per party",
          "Add as many petitioners or respondents as the matter has",
          "Edit the case at any time from the case view",
        ],
      },
      {
        icon: "Layers",
        title: "One case memory",
        text: "Everything below opens inside the case and already knows it. Nothing is re-uploaded or re-explained.",
        bullets: [
          "Docs: add papers as the matter grows",
          "Chrono: stays current with every filing",
          "Drafts: already know facts and parties",
          "Citation: matched to the pleaded grounds",
          "Chat: ask the case, with full context",
        ],
      },
    ],
    table: {
      heading: "Preset prompts inside a case",
      lede: "The case workspace ships with one-click preset prompts, grouped by task. Pick one and Jurinex runs it on the full case file.",
      rows: [
        { icon: "AlignLeft", label: "Summarisation", value: "Grounds · Grounds with workflows · Case summary · Concise summary" },
        { icon: "PenLine", label: "Drafting", value: "Start drafting" },
        { icon: "Scale", label: "Citation", value: "Citation finder" },
        { icon: "ShieldCheck", label: "Prelitigation", value: "Grievance · Client brief · Prelitigation" },
        { icon: "FileCheck2", label: "Court Ready Documents", value: "List of dates & events" },
        { icon: "Target", label: "Cross Examination", value: "Adverse witness cross bank generator" },
      ],
      note: "Every answer carries a confidence level and links back to the source document. Always read it before it goes to a court or a client.",
    },
    tips: {
      heading: "Good to know",
      items: [
        { title: "Merge conversations", text: "Combine multiple conversations on a case into a single document when you want one clean record of the analysis." },
        { title: "Add documents later", text: "Use the Document button in the case view to add papers as the matter grows. The chronology and summaries pick them up." },
        { title: "Meaningful names", text: "\"Sharma v. Patil, Property Dispute\" is much easier to find later than \"Case 1\"." },
        { title: "Password-protected PDFs", text: "Remove the password before uploading, otherwise the AI cannot read the file." },
        { title: "Treat it like a smart junior", text: "The AI may occasionally miss a date or mis-read a name. Read the output before relying on it." },
        { title: "Skip what you do not have", text: "Details and Parties can be skipped and filled in later. The case is still created." },
      ],
    },
    uses: [
      { title: "Matter intake in minutes", text: "Upload the bundle, let Auto Fill read the particulars, confirm and create. The case exists before the client has left the room.", before: "Typing case details by hand", after: "Particulars extracted from the papers" },
      { title: "Chronology without a spreadsheet", text: "Every dated event across the bundle is sequenced and linked to the page that proves it.", before: "Days building a list of dates", after: "Generated during processing" },
      { title: "One memory for the whole matter", text: "Summaries, briefs, drafts and citations all read from the same processed case.", before: "Re-uploading files to every tool", after: "Upload once, understood forever" },
      { title: "Hearing prep from the file itself", text: "Case Brief, Hearing Preparation and Gap Reasoning are ready when processing ends.", before: "Late nights before the hearing", after: "Structured notes waiting inside the case" },
    ],
    faqs: [
      { q: "Can I create a case without any documents?", a: "Yes. Upload can be skipped and the details typed in by hand. Add the papers later from the case view and processing starts then." },
      { q: "What if Auto Fill gets a field wrong?", a: "Every extracted field is editable on the Details and Parties screens before you confirm, and the case can be edited afterwards from the case view." },
      { q: "Does processing continue if I close the browser?", a: "Yes. OCR, document processing and chronology generation run on the server. Come back whenever you like." },
      { q: "Where do I find my cases afterwards?", a: "Open Ongoing Cases from the sidebar. The list shows title, case number, court, type, advocate, next hearing, status and document count, with tabs for Ongoing, Pending, Disposed and Draft." },
    ],
  },

  "case-storage": {
    title: "Case Storage, Search and Branding",
    lede:
      "Case Storage is the document vault: every file and every case folder, searchable in seconds and exportable under your own letterhead.",
    figure: {
      query: "\"show-cause notice\" · Bombay High Court · Aurangabad · 2024 to 2026",
      inputLabel: "Search",
      caption: "Advance Search across every matter",
      outputLabel: "Results · 3 matches",
      lines: ["Writ Petition 2598 of 2024 · PDF · 5.3 MB", "Annexures A to F · PDF · 31.2 MB", "Reply to Show Cause · DOCX · 214 KB", "Export on your letterhead · DOCX or PDF"],
    },
    liveLede:
      "The Case Storage vault: search, Filters, Upload, New Folder, Create Document and Custom Branding in the toolbar, the My Documents and My Cases switch, the storage meter, and folders and files in a grid.",
    steps: [
      {
        title: "Open the vault",
        screen: ["My Documents (n)", "My Cases (n)", "Search bar", "Storage meter"],
        text: "Click Case Storage on the sidebar. The My Documents tab holds the files you have uploaded; the My Cases tab holds one folder for every case you have created.",
      },
      {
        title: "Upload or create",
        screen: ["Upload", "Create Document", "Google Docs · Zoho", "New folder"],
        text: "Use Upload to add files without opening a case, or Create Document to start a new file in the built-in Google Docs or Zoho editors. New folders keep things tidy.",
      },
      {
        title: "Find it fast",
        screen: ["Filters", "Grid · List", "Sort by Name, Date, Size", "Recently used"],
        text: "Type a few words in the search bar, narrow with Filters, switch between grid and list, and sort by name, date, size or recently used.",
      },
      {
        title: "Brand every export",
        screen: ["Custom Branding", "Create New Profile", "Live preview", "Set as default"],
        text: "Open Custom Branding, create a profile with your letterhead, logo and chamber details, and set it as default. Every DOCX or PDF you export uses it.",
      },
    ],
    pipeline: {
      heading: "Advance Search, when the simple box is not enough",
      items: ["Court and bench", "Case type and status", "Date range", "Keywords in content"],
      note: "Combine any of these filters, add more than one, and order the results ascending or descending. Keywords search inside the document text, not just the file name.",
    },
    columns: [
      {
        icon: "FolderTree",
        title: "Two document spaces",
        text: "My Documents holds your own files, independent of any case. My Cases holds the documents of every case you have created.",
        bullets: [
          "My Documents: upload or create your own files",
          "Built-in Google Docs and Zoho editors",
          "My Cases: one folder per created case",
          "New folders, filters, grid or list view",
        ],
      },
      {
        icon: "Filter",
        title: "Advance Search",
        text: "A structured search for firms with many matters. Combine any of these filters.",
        bullets: [
          "Court, bench and adjudicating authority",
          "Case nature, case type and case status",
          "Date range between any two dates",
          "Keywords inside document content",
        ],
      },
      {
        icon: "Stamp",
        title: "Custom Branding",
        text: "Branding profiles apply your firm identity to every document you export.",
        bullets: [
          "Firm name, address, phone, email and Bar Council number",
          "Logo, position, size and letterhead alignment",
          "Font, paper size (A4 is standard in India) and orientation",
          "Live preview, then export PDF or DOCX",
        ],
      },
    ],
    table: {
      heading: "Setting up a branding profile",
      lede: "From Case Storage, click Custom Branding at the top right, then Create New Profile.",
      rows: [
        { icon: "Building2", label: "Identity", value: "Firm or advocate name, tagline, office address, phone, email, Bar Council number" },
        { icon: "Image", label: "Logo", value: "PNG with a transparent background looks best; choose left, centre or right, and set width and height" },
        { icon: "Type", label: "Layout", value: "Font, paper size, orientation and letterhead alignment, previewed live on a sample page" },
        { icon: "ToggleRight", label: "Default", value: "Switch Set as default on and every future export uses this profile automatically" },
        { icon: "Import", label: "Reuse", value: "Import from an existing profile to start a variant for another court or partner" },
      ],
    },
    tips: {
      heading: "Good to know",
      items: [
        { title: "Upload without a case", text: "Files in My Documents can be attached to a case later, or used directly in Quick Chat and AI Drafting." },
        { title: "Storage meter", text: "The bar at the bottom of the vault shows how much of your plan's storage is in use." },
        { title: "Sort by what matters", text: "Recently used is the quickest way back to yesterday's bundle." },
        { title: "Clean scans", text: "Use a phone scanner app rather than a photograph so keyword search finds the text inside." },
        { title: "One profile per court", text: "Branding profiles carry a court field, so a Supreme Court letterhead and a District Court one can live side by side." },
        { title: "Download invoices monthly", text: "Not a storage feature, but the same habit: keep your records and GST filings in order." },
      ],
    },
    uses: [
      { title: "Find the right file, fast", text: "Search by a few words, then narrow by court, bench, type, status, dates or keywords in the text.", before: "Hunting through folders and email", after: "Structured search across every matter" },
      { title: "Keep personal and case files apart", text: "My Documents for your own files, My Cases for one folder per matter.", before: "Everything in one download folder", after: "Two spaces, clearly separated" },
      { title: "Draft inside the vault", text: "Create a document with the built-in Google Docs or Zoho editors, right where the papers are.", before: "Switching between apps", after: "Editors built into storage" },
      { title: "Export on your letterhead", text: "Save a branding profile once and every DOCX or PDF carries the chamber's identity.", before: "Re-formatting every export", after: "Set as default, applied automatically" },
    ],
    faqs: [
      { q: "Is there a difference between My Documents and a case's Docs tab?", a: "Yes. My Documents is your personal file space. A case's Docs tab holds only the papers processed into that case memory. Files can be moved from one to the other." },
      { q: "Can keyword search look inside scanned PDFs?", a: "Yes, once a document has been through OCR. Advance Search's Keywords filter matches text in the document content." },
      { q: "Does branding change the draft itself?", a: "No. It applies the letterhead, logo, font and paper settings at export. The words of the draft are unchanged." },
      { q: "Who can see my storage?", a: "Only users in your firm with permission. Firm admins control who can upload, view and manage cases under Settings." },
    ],
  },

  "quick-chat": {
    title: "Ask Questions, Get Verifiable Answers",
    lede:
      "Quick Chat is the fastest way into a case file. Upload the documents, ask in plain language, and read the answer with its confidence level and clickable source citations.",
    figure: {
      query: "What is the prayer, and which sections are relied on?",
      inputLabel: "Query",
      stack: ["Attached document · 14 pages", "Case memory, when attached", "Preset workflows", "Role selector", "Source citations"],
      caption: "Grounded in your own papers",
      outputLabel: "Answer · confidence high",
      lines: ["Prayer: quash the order dated 12 Jan 2026 · p. 11", "Stay of demand pending disposal · p. 11", "Articles 226 and 227 · Section 73, CGST Act · p. 6 to 8", "Verification certificate · suggested follow-ups"],
    },
    liveLede:
      "Chat with Me: a question about the writ petition, the answer listing every exhibit from the index, Research further suggestions above it, and the preset groups and role selector by the input box.",
    steps: [
      {
        title: "Open Quick Chat",
        screen: ["Chat with Me", "New Conversation", "Prompt buttons", "Role selector"],
        text: "From the main navigation. A fresh conversation opens with the prompt buttons ready below the input box.",
      },
      {
        title: "Upload the case documents",
        screen: ["Paperclip attach", "Case dropdown", "File name at top", "Pages processed"],
        text: "Attach one or more files with the paperclip, or pick an existing case from the dropdown at the top. The case name appears at the top once processed.",
      },
      {
        title: "Ask your question",
        screen: ["Input box", "Case Summary", "List of Dates & Events", "Statute & Section Finder"],
        text: "Type it in the box, or use the one-click prompt buttons. Set the role selector if you want the answer framed for petitioner or respondent.",
      },
      {
        title: "Read, verify, follow up",
        screen: ["Confidence level", "Source citations", "Suggested follow-ups", "Copy · Download · Print"],
        text: "Answers arrive as structured notes with a verification certificate and confidence level. Click a citation to open the source, tap a suggested follow-up, or start a New Conversation.",
      },
    ],
    pipeline: {
      heading: "One-click prompt buttons",
      items: ["Case Summary", "List of Dates & Events", "Case Gist", "Grounds", "Hearing Preparation", "Generate a Brief", "Client Brief", "Statute & Section Finder"],
      note: "Also available: Basic Drafting assistant, Structured Case Intake & Analysis and Smart Draft. The same presets run inside every case.",
    },
    columns: [
      {
        icon: "MessageSquareText",
        title: "Examples of what to ask",
        text: "Anything about the file, the way you would brief a junior.",
        bullets: [
          "\"Summarise this case in five sentences.\"",
          "\"What are the important dates in this matter?\"",
          "\"List all the parties and their roles.\"",
          "\"What sections of the IPC / BNS are mentioned?\"",
          "\"What is the prayer of the petitioner?\"",
          "\"Draft a short reply to this notice.\"",
        ],
      },
      {
        icon: "BadgeCheck",
        title: "Confidence on every answer",
        text: "Jurinex shows how sure it is, so you know what to double-check.",
        bullets: [
          "H, High: the AI is confident, usually fine to rely on",
          "M, Medium: double-check the point before you use it",
          "L, Low: verify against the original document yourself",
          "RV, Requires Verification: the AI cannot decide, check the source",
        ],
      },
      {
        icon: "Link2",
        title: "Built for verification",
        text: "Every answer is grounded in the papers you gave it.",
        bullets: [
          "Clickable source citations open the original passage",
          "Verification certificate lists what was cross-checked",
          "Suggested follow-ups proposed from the file itself",
          "Thumbs up or down to tell us how the answer landed",
          "Copy, download or print any response",
        ],
      },
    ],
    table: {
      heading: "What a structured answer contains",
      lede: "A Case Summary, for example, comes back as a report rather than a paragraph.",
      rows: [
        { icon: "FileText", label: "Nature of document", value: "Petition type, number and the jurisdiction invoked" },
        { icon: "Landmark", label: "Court and jurisdiction", value: "Court name, location, bench and the articles or sections relied on" },
        { icon: "TableProperties", label: "Factual matrix", value: "Parties, dates and evidence in a structured table" },
        { icon: "ListChecks", label: "Verification certificate", value: "Facts extracted verbatim, no assumptions beyond stated facts, provisions cross-verified" },
        { icon: "Gauge", label: "Confidence level", value: "High, Medium, Low or Requires Verification, with a disclaimer to review the original" },
      ],
    },
    tips: {
      heading: "Good to know",
      items: [
        { title: "Merge conversations", text: "Combine multiple chats into a single document, here and in Ongoing Cases." },
        { title: "Summarise before you read", text: "Run Case Summary on a long bundle first. You get the highlights, then read the pages that matter." },
        { title: "New Conversation keeps the old one", text: "Start fresh without losing the previous thread. History stays available." },
        { title: "Private and encrypted", text: "Jurinex never shares your case data with anyone outside your firm." },
        { title: "Verify case laws", text: "When the chat cites a judgment, click through and read the original before relying on it." },
        { title: "Keyboard shortcut", text: "Ctrl + N starts a new chat from anywhere in the app." },
      ],
    },
    uses: [
      { title: "Summarise before you read", text: "Run Case Summary on a long bundle and read only the pages that matter.", before: "Reading 300 pages end to end", after: "Highlights in a minute, with citations" },
      { title: "Answer a client on the spot", text: "Ask what the prayer is or which sections apply, and quote the source page.", before: "Calling back after checking the file", after: "A sourced answer during the call" },
      { title: "Prepare with presets", text: "One-click Grounds, Hearing Preparation, Client Brief or Statute & Section Finder.", before: "Writing prompts from scratch", after: "Preset workflows, no prompt writing" },
      { title: "Know what to double-check", text: "Every answer carries High, Medium, Low or Requires Verification.", before: "Trusting or discarding blindly", after: "Confidence shown on each answer" },
    ],
    faqs: [
      { q: "Do I need to create a case first?", a: "No. Quick Chat works over any uploaded file. Attach a case only when you want the answer to draw on the full case memory." },
      { q: "Can I chat in Hindi or Marathi?", a: "Yes. Set AI Language Preference in your Profile and answers come back in that language." },
      { q: "What does Requires Verification mean?", a: "The AI could not settle the point from the documents alone. Open the cited source and decide yourself before using it." },
      { q: "Where do my conversations go?", a: "They are saved with the file or case they belong to, and can be merged into one document from the conversation menu." },
    ],
  },

  "ai-drafting": {
    title: "The Drafting Workflow",
    lede:
      "Pick what kind of work it is, choose a template, give it context. Then the pipeline drafts, polishes and self-checks before you review and download.",
    figure: {
      query: "Writ Petition (Certiorari) · attach case: Sharma Traders v. Patil Industries",
      inputLabel: "Template",
      caption: "Automatic pipeline · about 30 seconds",
      outputLabel: "Draft · 4 of 4 sections",
      lines: ["Cause Title and Case Particulars · Concise", "Grounds · Detailed", "Jurisdiction and Prayer · Detailed", "DOCX or PDF on your letterhead"],
    },
    liveLede:
      "The Start a draft picker: Litigation drafting routed to the case chat, and Conveyancing, Corporate and contracts and General drafting through the guided template picker, with recent drafts and templates below.",
    steps: [
      {
        title: "Choose a category",
        screen: ["Case chat: Start drafting", "My templates", "Browse Templates", "Recent Drafts"],
        text: "Litigation drafts run inside the case chat. Conveyancing, corporate and contracts, and general drafting run through the guided picker.",
      },
      {
        title: "Pick a template",
        screen: ["System Templates", "My Templates", "Sections preview", "Use this template · Clone and use"],
        text: "Browse the category, Partition, Mortgage, Lease, Gift Deed and more, from system templates or your own saved templates. Preview the sections, then Use this template or Clone and use.",
      },
      {
        title: "Initialization",
        screen: ["Attach case", "Context files", "Formatting (court)", "Language"],
        text: "Attach a case for its facts, or upload supporting documents, not both. Optionally set court formatting and the output language.",
      },
      {
        title: "Automatic pipeline",
        screen: ["Agent activity", "Extract facts", "Generate", "Self-check"],
        text: "Jurinex runs every step itself, extract facts, map to template, generate, polish, self-check, live on screen in the agent activity panel.",
      },
      {
        title: "Review sections",
        screen: ["Detailed · Concise · Short", "Update with instruction", "Previous · Next section", "Google Docs · Zoho"],
        text: "Every section opens for review. Refine it with an instruction, set it to Detailed, Concise or Short, or edit in the built-in Google Docs and Zoho editors.",
      },
      {
        title: "Generate and download",
        screen: ["Generate document", "Page preview", "Download DOCX · PDF", "Save to case"],
        text: "Assemble the reviewed sections into one complete draft, preview it page by page, then download as DOCX or PDF with your branding, or save it back to the case.",
      },
    ],
    pipeline: {
      heading: "The automatic pipeline",
      items: ["Extract Facts", "Map to Template", "Generate Draft", "Polish & Complete", "Self-Check"],
      note: "A first full draft usually takes about 30 seconds. Section config lets you switch off any section you do not need before it runs.",
    },
    columns: [
      {
        icon: "LayoutTemplate",
        title: "Template library",
        text: "Ready-made system templates, plus your own. Clone any system template and edit it into a house style.",
        bullets: [
          "Writ Petition, Bail Application, Revision Petition",
          "Legal Notice and Reply to Notice",
          "Leave and Licence, Employment, Franchise Agreements",
          "Sale, Gift and Mortgage Deeds, Partnership Deed",
          "Power of Attorney, Arbitration Appeal, Suit for Partition",
        ],
      },
      {
        icon: "SlidersHorizontal",
        title: "Section control",
        text: "Every standard section is on by default. You decide the shape of the document.",
        bullets: [
          "Toggle any section off",
          "Detailed, Concise or Short, per section",
          "Editable description and instruction per section",
          "Update with instruction to redraft one section only",
          "Previous and next section navigation while reviewing",
        ],
      },
      {
        icon: "Landmark",
        title: "Court-ready output",
        text: "Formatted for the bench you are filing in, on your letterhead.",
        bullets: [
          "Court formatting selected at initialization",
          "English or Marathi output",
          "Custom branding applied at export",
          "DOCX and PDF download",
          "Recent drafts listed with Draft or Generated status",
        ],
      },
    ],
    table: {
      heading: "What a template looks like inside",
      lede: "A Bail Application, for example, ships with seven sections. Each can be kept, trimmed or switched off.",
      rows: [
        { icon: "FileText", label: "Section 1", value: "Cause Title and Case Particulars" },
        { icon: "FileText", label: "Section 2", value: "Humble Application and Grounds" },
        { icon: "FileText", label: "Section 3", value: "Jurisdiction and Prayer" },
        { icon: "FileText", label: "Section 4", value: "Signature Block" },
        { icon: "FileText", label: "Section 5", value: "Verification" },
        { icon: "FileText", label: "Section 6", value: "Affidavit in Support" },
        { icon: "FileText", label: "Section 7", value: "List of Annexures" },
      ],
    },
    tips: {
      heading: "Good to know",
      items: [
        { title: "More facts, better draft", text: "Brief facts, cause of action with dates, relief sought and any annexures. Grammar does not matter; the AI turns notes into legal language." },
        { title: "Either a case or context files", text: "Attach case is disabled while context files are selected, and vice versa. Pick the source that has the facts." },
        { title: "Create your own template", text: "Upload a document from My Templates to turn a past filing into a reusable template." },
        { title: "Read before filing", text: "Check names, dates, sections of law and prayer. The AI is a helper, not a substitute for your legal mind." },
        { title: "Save it to the case", text: "Generated drafts can be saved into the case folder so they sit with the papers they came from." },
        { title: "Keyboard shortcut", text: "Ctrl + S saves what you are editing." },
      ],
    },
    uses: [
      { title: "Petitions from the case memory", text: "Start drafting inside the case chat; facts, parties and court are already known.", before: "Retyping facts into a template", after: "Draft built from the processed case" },
      { title: "Agreements from the picker", text: "Leave and Licence, Employment, Partnership, Sale and Gift Deeds from system or saved templates.", before: "Copying an old file and editing", after: "Guided template, section by section" },
      { title: "Control the shape", text: "Switch sections off, set each to Detailed, Concise or Short, and redraft one section with an instruction.", before: "All-or-nothing generation", after: "Section-level control" },
      { title: "File in the right format", text: "Court formatting, English or Marathi, and custom branding applied at export.", before: "Formatting by hand for each bench", after: "Court-ready DOCX or PDF" },
    ],
    faqs: [
      { q: "Where do litigation drafts start?", a: "Inside the case chat, using the Start drafting preset or Basic Drafting assistant. The draft already knows the facts, parties and court from the case memory." },
      { q: "Can I edit the generated text directly?", a: "Yes. Edit any section on screen, send an instruction to redraft it, or open it in the built-in Google Docs or Zoho editor." },
      { q: "Does the AI invent facts to fill gaps?", a: "No. Missing facts are left for you to supply. The self-check step flags sections that need input rather than guessing." },
      { q: "Can juniors use my templates?", a: "Templates saved under My Templates are available to users in your firm according to the permissions set by your admin." },
    ],
  },

  "citation-research": {
    title: "The Citation Research Workflow",
    lede:
      "Point it at a matter, choose the legal focus, and get back reviewed authorities with links to the original judgments.",
    figure: {
      query: "Alternate remedy · natural justice · acting for the petitioner",
      inputLabel: "Focus",
      stack: ["Matter context", "Spotted issues and pleaded grounds", "Editable search queries", "Indian Kanoon", "Good-law check"],
      caption: "Reviewed authorities, with reasoning",
      outputLabel: "Authorities · verified",
      lines: ["Whirlpool Corp. v. Registrar of Trade Marks, (1998) 8 SCC 1", "Harbanslal Sahnia v. Indian Oil, (2003) 2 SCC 107", "Radha Krishan Industries v. State of H.P., (2021) 6 SCC 771", "Each linked to the original judgment"],
    },
    liveLede:
      "Citation Research set-up: choose the material, set acting-for and legal focus, switch on Boolean precision, then Analyse matter, with your recent analyses saved on the right.",
    steps: [
      {
        title: "Choose the research material",
        screen: ["Select a case", "Upload document", "Paste text"],
        text: "Use an existing case, upload one document, or paste the case text you want authorities for.",
      },
      {
        title: "Set the legal focus",
        screen: ["Issues and grounds", "Issue spotting", "Pleaded grounds", "Petitioner · Respondent · Auto"],
        text: "Pick what to extract, issues and grounds, issue spotting, or pleaded grounds, acting for petitioner, respondent or auto.",
      },
      {
        title: "Analyse the matter",
        screen: ["Matter context", "Spotted issues", "Pleaded grounds"],
        text: "Jurinex reads the material and builds the matter context, the spotted issues and the pleaded grounds.",
      },
      {
        title: "Review and select issues",
        screen: ["Legal question", "Analysis note", "Editable search queries", "Boolean operators"],
        text: "Each issue carries its legal question, an analysis note and editable search queries. Select the ones that matter, and tighten a query with Boolean operators if you want precision.",
      },
      {
        title: "Search authorities",
        screen: ["Find authorities", "Indian Kanoon", "Related citations"],
        text: "Run the search and retrieve multiple related citations for the selected issues from Indian Kanoon.",
      },
      {
        title: "Citation review report",
        screen: ["Why it fits", "Still good law", "Open judgment", "Save to case"],
        text: "A detailed review of every authority, why it fits, and whether it still stands, each linked back to the original Indian Kanoon judgment. Save the analysis to the case.",
      },
    ],
    pipeline: {
      heading: "What comes back",
      items: ["Multiple related authorities", "Detailed citation review", "Original Indian Kanoon links"],
      note: "Zero-hallucination policy. If the system is not confident, it flags rather than invents.",
    },
    columns: [
      {
        icon: "Crosshair",
        title: "Legal focus modes",
        text: "Tell Jurinex what to look for before it looks.",
        bullets: [
          "Issues and grounds: the full map of the matter",
          "Issue spotting: what could be argued that has not been pleaded",
          "Pleaded grounds: authorities for what is already on record",
          "Acting for petitioner, respondent or auto-detect",
        ],
      },
      {
        icon: "BookMarked",
        title: "Authorities you can rely on",
        text: "Each citation comes with its reasoning, not just a name.",
        bullets: [
          "Court-approved citation formats",
          "Why it fits, written against your ground",
          "Checks on whether the judgment still stands",
          "Multiple related authorities per issue",
          "Links back to the source judgment",
        ],
      },
      {
        icon: "Save",
        title: "Saved for the hearing",
        text: "Research stays with the matter it was done for.",
        bullets: [
          "Saved analyses inside the case",
          "Re-run with new documents as the matter grows",
          "Reach it from case chat with Research further",
          "Suggested precedent searches proposed from the case itself",
        ],
      },
    ],
    table: {
      heading: "An issue card, explained",
      lede: "After analysis, every spotted issue arrives as a card you can edit before searching.",
      rows: [
        { icon: "HelpCircle", label: "Legal question", value: "The precise question of law the issue raises, in one sentence" },
        { icon: "StickyNote", label: "Analysis note", value: "How the issue sits in the matter and which facts bear on it" },
        { icon: "Search", label: "Search queries", value: "Editable queries, with Boolean precision when you need to narrow the field" },
        { icon: "CheckSquare", label: "Selection", value: "Tick the issues that matter; only those are searched" },
      ],
    },
    tips: {
      heading: "Good to know",
      items: [
        { title: "Always read the original", text: "Click the citation link and read the judgment. Do not rely on summaries alone." },
        { title: "Start from the case", text: "Choosing an existing case means the pleaded grounds are already known, so the search starts sharper." },
        { title: "Paste when you must", text: "No document yet? Paste the order, notice or issue as text and research from there." },
        { title: "Edit the queries", text: "The generated search queries are a starting point. Adjust them the way you would in a law library." },
        { title: "Flags, not guesses", text: "When confidence is low the report says so. Treat those entries as leads to verify." },
        { title: "From chat, too", text: "\"Find Supreme Court authority on inadequate reply time\" in Quick Chat hands off to the same engine." },
      ],
    },
    uses: [
      { title: "Authorities for a pleaded ground", text: "Point it at the case, choose pleaded grounds, and get citations that fit the ground with the reasoning.", before: "Hours in a case-law database", after: "Matched authorities in minutes" },
      { title: "Spot what has not been pleaded", text: "Issue spotting surfaces arguable points the pleadings do not yet raise.", before: "Relying on memory", after: "Spotted issues from the material" },
      { title: "Verify before you cite", text: "Every authority links to the original Indian Kanoon judgment and is checked for whether it still stands.", before: "Discovering an overruled case in court", after: "Good-law check and a link to the source" },
      { title: "Research that stays with the matter", text: "Saved analyses live inside the case for the next hearing.", before: "Research memos lost in email", after: "Saved to the case, re-runnable" },
    ],
    faqs: [
      { q: "Which database does it search?", a: "Indian Kanoon. Every authority links back to the original judgment there." },
      { q: "Can it tell me if a judgment has been overruled?", a: "The review checks whether each authority still stands and flags where it has been doubted, distinguished or overruled. Verify against the original before citing." },
      { q: "Do I have to pick a side?", a: "No. Choose petitioner, respondent, or leave it on auto and Jurinex infers the side from the material." },
      { q: "Is the research saved?", a: "Yes. Saved analyses live inside the case and can be reopened or re-run at the next hearing." },
    ],
  },
}
