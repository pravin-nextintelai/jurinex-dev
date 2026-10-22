// import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
// import {
//   Search, Download, Printer, ArrowLeft, Save, Share2,
//   Settings, MoreVertical, Clock, Users, FileText,
//   ChevronDown, Bell, User, Loader, X
// } from "lucide-react";
// import { CKEditor } from "@ckeditor/ckeditor5-react";
// import ClassicEditor from "@ckeditor/ckeditor5-build-classic";
// import Templates from "../components/Templates";
// import ApiService from "@/shared/api/api";
// import '../styles/ckeditor-a4.css';

// const generateUserId = () => {
//   const stored = localStorage.getItem('documentEditorUserId') || localStorage.getItem('userId');
//   if (stored) return stored;
  
//   const newId = 'user_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
//   localStorage.setItem('documentEditorUserId', newId);
//   return newId;
// };

// const createStorageKey = (userId, templateId, suffix = '') => {
//   return `docEditor_${userId}_${templateId || 'blank'}${suffix ? '_' + suffix : ''}`;
// };

// const downloadBlob = (filename, blob) => {
//   const url = URL.createObjectURL(blob);
//   const a = document.createElement("a");
//   a.href = url;
//   a.download = filename;
//   document.body.appendChild(a);
//   a.click();
//   a.remove();
//   URL.revokeObjectURL(url);
// };

// const useAutoSave = (content, storageKey, templateId, delay = 3000) => {
//   const timeoutRef = useRef(null);
//   const [isSaving, setIsSaving] = useState(false);
//   const [lastSaved, setLastSaved] = useState(null);

//   useEffect(() => {
//     if (timeoutRef.current) {
//       clearTimeout(timeoutRef.current);
//     }

//     timeoutRef.current = setTimeout(async () => {
//       if (content && typeof content === 'string') {
//         setIsSaving(true);
//         try {
//           localStorage.setItem(storageKey, content);
//           localStorage.setItem(storageKey + '_lastSaved', new Date().toISOString());
          
//           if (typeof templateId === 'string' && !templateId.includes('-')) {
//             const blob = new Blob([content], { type: 'text/html' });
//             const file = new File([blob], 'document.html', { type: 'text/html' });
            
//             await ApiService.saveUserDraft(templateId, 'Auto-saved Document', file);
//           }
          
//           setLastSaved(new Date());
//         } catch (error) {
//           console.error('Auto-save failed:', error);
//         } finally {
//           setIsSaving(false);
//         }
//       }
//     }, delay);

//     return () => {
//       if (timeoutRef.current) {
//         clearTimeout(timeoutRef.current);
//       }
//     };
//   }, [content, storageKey, templateId, delay]);

//   return { isSaving, lastSaved };
// };

// const DraftingPage = () => {
//   const userId = useMemo(() => generateUserId(), []);
  
//   const [searchQuery, setSearchQuery] = useState("");
//   const [isMenuOpen, setIsMenuOpen] = useState(false);
//   const [documentList, setDocumentList] = useState([]);
//   const [isLoading, setIsLoading] = useState(false);
//   const [error, setError] = useState(null);
//   const [showDiscardDialog, setShowDiscardDialog] = useState(false);

//   const currentSessionKey = 'drafting_current_session';
//   const currentSessionData = JSON.parse(localStorage.getItem(currentSessionKey) || 'null');

//   const [selectedTemplate, setSelectedTemplate] = useState(() => {
//     if (currentSessionData && currentSessionData.selectedTemplate) {
//       return currentSessionData.selectedTemplate;
//     }
//     return null;
//   });

//   const [fileName, setFileName] = useState(() => {
//     if (currentSessionData && currentSessionData.fileName) {
//       return currentSessionData.fileName;
//     }
//     return "Untitled Document";
//   });

//   const [editorContent, setEditorContent] = useState(() => {
//     if (currentSessionData && currentSessionData.editorContent) {
//       return currentSessionData.editorContent;
//     }
//     return '';
//   });

//   const location = window.location;
//   const queryParams = new URLSearchParams(location.search);
//   const templateIdFromUrl = queryParams.get('templateId');
//   const editUrlFromUrl = queryParams.get('editUrl');

//   console.log('DraftingPage: Initializing with URL Params:', { templateIdFromUrl, editUrlFromUrl });
//   console.log('DraftingPage: Current session data:', currentSessionData);

//   const currentStorageKey = useMemo(() => 
//     createStorageKey(userId, selectedTemplate?.id, 'content'), 
//     [userId, selectedTemplate?.id]
//   );

//   const fileNameStorageKey = useMemo(() => 
//     createStorageKey(userId, selectedTemplate?.id, 'fileName'), 
//     [userId, selectedTemplate?.id]
//   );

//   const { isSaving, lastSaved } = useAutoSave(editorContent, currentStorageKey, selectedTemplate?.id);

//   useEffect(() => {
//     const sessionData = {
//       selectedTemplate,
//       fileName,
//       editorContent,
//       lastModified: new Date().toISOString()
//     };
//     localStorage.setItem(currentSessionKey, JSON.stringify(sessionData));
//   }, [selectedTemplate, fileName, editorContent, currentSessionKey]);

//   useEffect(() => {
//     const loadTemplateFromUrl = async () => {
//       if (templateIdFromUrl && !currentSessionData) {
//         try {
//           setIsLoading(true);
//           setError(null);
//           let templateToLoad = null;

//           if (templateIdFromUrl) {
//             const result = await ApiService.openTemplateForEditing(templateIdFromUrl);
//             const htmlContent = result?.html || result || '';
            
//             templateToLoad = {
//               id: templateIdFromUrl,
//               name: result?.name || 'Document from Backend',
//               content: htmlContent,
//               isBackendTemplate: true,
//             };
            
//             setEditorContent(typeof htmlContent === 'string' ? htmlContent : '');
//             setFileName(templateToLoad.name?.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase() || 'document');
//           } else {
//             setEditorContent('');
//             setFileName('Untitled Document');
//           }
//           setSelectedTemplate(templateToLoad);
//         } catch (err) {
//           console.error('Error loading template from URL:', err);
//           setError(`Failed to load document: ${err.message}`);
//           setSelectedTemplate(null);
//           setEditorContent('');
//           setFileName('Untitled Document');
//         } finally {
//           setIsLoading(false);
//         }
//       }
//     };
//     loadTemplateFromUrl();
//   }, [templateIdFromUrl, editUrlFromUrl, currentSessionData]);

//   useEffect(() => {
//     if (selectedTemplate && selectedTemplate.id) {
//       const savedContent = localStorage.getItem(currentStorageKey);
//       const savedFileName = localStorage.getItem(fileNameStorageKey);
      
//       if (!currentSessionData || !currentSessionData.editorContent) {
//         if (savedContent) {
//           setEditorContent(savedContent);
//         }
//       }
      
//       if (!currentSessionData || !currentSessionData.fileName) {
//         if (savedFileName) {
//           setFileName(savedFileName);
//         }
//       }
//     }
//   }, [selectedTemplate, currentStorageKey, fileNameStorageKey, currentSessionData]);

//   useEffect(() => {
//     if (selectedTemplate && selectedTemplate.id && editorContent) {
//       localStorage.setItem(currentStorageKey, editorContent);
//     }
//   }, [editorContent, currentStorageKey, selectedTemplate]);

//   useEffect(() => {
//     if (selectedTemplate && selectedTemplate.id && fileName && fileName !== "Untitled Document") {
//       localStorage.setItem(fileNameStorageKey, fileName);
//     }
//   }, [fileName, fileNameStorageKey, selectedTemplate]);

//   useEffect(() => {
//     const loadDocumentList = () => {
//       const allKeys = Object.keys(localStorage);
//       const userDocs = allKeys
//         .filter(key => key.startsWith(`docEditor_${userId}_`) && key.endsWith('_content'))
//         .map(key => {
//           const parts = key.split('_');
//           const templateId = parts[2];
//           const content = localStorage.getItem(key);
//           const lastSavedKey = key + '_lastSaved';
//           const lastSaved = localStorage.getItem(lastSavedKey);
//           const fileNameKey = key.replace('_content', '_fileName');
//           const fileName = localStorage.getItem(fileNameKey) || 'Untitled Document';
          
//           return {
//             id: key,
//             templateId,
//             fileName,
//             content,
//             lastSaved: lastSaved ? new Date(lastSaved) : new Date(),
//             wordCount: content ? content.replace(/<[^>]*>/g, '').split(/\s+/).filter(Boolean).length : 0
//           };
//         })
//         .sort((a, b) => new Date(b.lastSaved) - new Date(a.lastSaved));
      
//       setDocumentList(userDocs);
//     };

//     loadDocumentList();
//   }, [userId, editorContent]);

//   const handleTemplateSelection = useCallback(async (template) => {
//     const hasChanges = editorContent && editorContent.trim() !== '' && 
//                       (!selectedTemplate || editorContent !== (selectedTemplate.content || ''));
    
//     if (hasChanges) {
//       window.pendingTemplate = template;
//       setShowDiscardDialog(true);
//       return;
//     }
    
//     await selectTemplate(template);
//   }, [editorContent, selectedTemplate]);

//   const selectTemplate = useCallback(async (template) => {
//     try {
//       setIsLoading(true);
//       setError(null);
      
//       console.log('Template selected:', template);

//       let fetchedHtmlContent = '';
//       try {
//         const result = await ApiService.openTemplateForEditing(template.id);
//         console.log('Backend template result:', result);
        
//         if (typeof result === 'string') {
//           fetchedHtmlContent = result;
//         } else if (result && typeof result === 'object') {
//           fetchedHtmlContent = result.html || result.content || '';
//         }
        
//         fetchedHtmlContent = typeof fetchedHtmlContent === 'string' ? fetchedHtmlContent : '';
        
//         setSelectedTemplate({
//           ...template,
//           content: fetchedHtmlContent,
//           isBackendTemplate: true,
//         });
        
//         setFileName(template.name?.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase() || 'document');
        
//       } catch (err) {
//         console.error('Error opening backend template:', err);
//         setError('Failed to open backend template. Please try again.');
        
//         fetchedHtmlContent = template.content || '';
//         setSelectedTemplate({
//           ...template,
//           content: fetchedHtmlContent,
//         });
//         setFileName(template.name?.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase() || 'document');
//       }

//         const specificTemplateStorageKey = createStorageKey(userId, template.id, 'content');
//         const savedContent = localStorage.getItem(specificTemplateStorageKey);
        
//         if (savedContent) {
//           setEditorContent(savedContent);
//           console.log('Loaded content from localStorage for template:', template.id);
//         } else {
//           setEditorContent(fetchedHtmlContent);
//           console.log('Loaded content from fetched HTML for template:', template.id);
//         }
      
//     } catch (error) {
//       console.error('Error selecting template:', error);
//       setError('Failed to load template. Please try again.');
      
//       const fallbackContent = template.content || '';
//       setSelectedTemplate({
//         ...template,
//         content: fallbackContent,
//       });
//       setEditorContent(typeof fallbackContent === 'string' ? fallbackContent : '');
//       setFileName(template.name?.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase() || 'document');
//     } finally {
//       setIsLoading(false);
//     }
//   }, [userId, createStorageKey]);

//   const handleEditorChange = useCallback((content) => {
//     const stringContent = typeof content === 'string' ? content : '';
//     setEditorContent(stringContent);
//     console.log('Editor content changed:', typeof stringContent, stringContent.substring(0, 100));
//   }, []);

//   const exportToPDF = useCallback(() => {
//     const printWindow = window.open('', '_blank');
//     const contentToPrint = typeof editorContent === 'string' ? editorContent : '';

//     const printHtml = `
//       <!DOCTYPE html>
//       <html>
//         <head>
//           <title>${fileName}</title>
//           <link rel="stylesheet" href="https://cdn.ckeditor.com/ckeditor5/41.4.2/classic/ckeditor.css">
//           <style>
//             body {
//               font-family: 'Times New Roman', serif;
//               margin: 0;
//               padding: 40px;
//               background-color: white;
//               line-height: 1.6;
//               color: #1a1a1a;
//             }
//             @page {
//               margin: 1in;
//             }
//             @media print {
//               body { margin: 0; padding: 0; }
//               .no-print { display: none; }
//             }
//             .ck-content {
//               word-wrap: break-word;
//             }
//             h1, h2, h3, h4, h5, h6 {
//               margin-top: 1.5em;
//               margin-bottom: 0.5em;
//               page-break-after: avoid;
//             }
//             table {
//               border-collapse: collapse;
//               width: 100%;
//               margin: 1em 0;
//             }
//             th, td {
//               border: 1px solid #ccc;
//               padding: 8px;
//               text-align: left;
//             }
//             th { background-color: #f5f5f5; }
//             .page-break { page-break-before: always; }
//           </style>
//         </head>
//         <body class="ck-content">
//           ${contentToPrint}
//         </body>
//       </html>
//     `;

//     printWindow.document.write(printHtml);
//     printWindow.document.close();
//     printWindow.onload = () => {
//       printWindow.focus();
//       printWindow.print();
//       printWindow.close();
//     };
//   }, [editorContent, fileName]);

//   const exportToHTML = useCallback(() => {
//     const contentToExport = typeof editorContent === 'string' ? editorContent : '';
//     const htmlContent = `
//       <!DOCTYPE html>
//       <html>
//         <head>
//           <meta charset="UTF-8">
//           <title>${fileName}</title>
//           <link rel="stylesheet" href="https://cdn.ckeditor.com/ckeditor5/41.4.2/classic/ckeditor.css">
//           <style>
//             body {
//               font-family: 'Times New Roman', serif;
//               max-width: 800px;
//               margin: 0 auto;
//               padding: 40px;
//               line-height: 1.6;
//               color: #1a1a1a;
//             }
//             .ck-content {
//               word-wrap: break-word;
//             }
//             h1, h2, h3, h4, h5, h6 { margin-top: 1.5em; margin-bottom: 0.5em; }
//             p { margin-bottom: 1em; }
//             table { border-collapse: collapse; width: 100%; margin: 1em 0; }
//             th, td { border: 1px solid #ccc; padding: 8px; text-align: left; }
//             th { background-color: #f5f5f5; }
//             img { max-width: 100%; height: auto; }
//           </style>
//         </head>
//         <body class="ck-content">
//           ${contentToExport}
//         </body>
//       </html>
//     `;
    
//     downloadBlob(`${fileName}.html`, new Blob([htmlContent], { type: "text/html;charset=utf-8" }));
//   }, [editorContent, fileName]);

//   const exportToText = useCallback(() => {
//     const contentToExport = typeof editorContent === 'string' ? editorContent : '';
//     const tempDiv = document.createElement('div');
//     tempDiv.innerHTML = contentToExport;
//     const textContent = tempDiv.textContent || tempDiv.innerText || '';
    
//     downloadBlob(`${fileName}.txt`, new Blob([textContent], { type: "text/plain;charset=utf-8" }));
//   }, [editorContent, fileName]);

//   const handleBackToTemplates = useCallback(async () => {
//     const hasChanges = editorContent && editorContent.trim() !== '' && 
//                       (!selectedTemplate || editorContent !== (selectedTemplate.content || ''));
    
//     if (hasChanges) {
//       window.pendingAction = 'backToTemplates';
//       setShowDiscardDialog(true);
//       return;
//     }
    
//     await goBackToTemplates();
//   }, [editorContent, selectedTemplate]);

//   const goBackToTemplates = useCallback(async () => {
//     try {
//       if (editorContent && selectedTemplate) {
//         localStorage.setItem(currentStorageKey, editorContent);
//         localStorage.setItem(currentStorageKey + '_lastSaved', new Date().toISOString());
        
//         if (selectedTemplate.id && typeof selectedTemplate.id === 'string' && !selectedTemplate.id.includes('-')) {
//           const blob = new Blob([editorContent], { type: 'text/html' });
//           const file = new File([blob], fileName + '.html', { type: 'text/html' });
          
//           await ApiService.saveUserDraft(selectedTemplate.id, fileName, file);
//         }
//       }
//     } catch (error) {
//       console.error('Error saving before exit:', error);
//     }
    
//     localStorage.removeItem(currentSessionKey);
    
//     setSelectedTemplate(null);
//     setEditorContent('');
//     setFileName('Untitled Document');
//     setError(null);
//   }, [editorContent, selectedTemplate, currentStorageKey, fileName, currentSessionKey]);

//   const handleManualSave = useCallback(async () => {
//     try {
//       setIsLoading(true);
      
//       localStorage.setItem(currentStorageKey, editorContent);
//       localStorage.setItem(currentStorageKey + '_lastSaved', new Date().toISOString());
      
//       if (selectedTemplate?.id && typeof selectedTemplate.id === 'string' && !selectedTemplate.id.includes('-')) {
//         const blob = new Blob([editorContent], { type: 'text/html' });
//         const file = new File([blob], fileName + '.html', { type: 'text/html' });
          
//         await ApiService.saveUserDraft(selectedTemplate.id, fileName, file);
//       }
      
//       setError(null);
      
//     } catch (error) {
//       console.error('Manual save failed:', error);
//       setError('Failed to save document. Please try again.');
//     } finally {
//       setIsLoading(false);
//     }
//   }, [editorContent, currentStorageKey, selectedTemplate, fileName]);

//   const handleDiscardChanges = useCallback(async () => {
//     setShowDiscardDialog(false);
    
//     if (window.pendingTemplate) {
//       await selectTemplate(window.pendingTemplate);
//       window.pendingTemplate = null;
//     } else if (window.pendingAction === 'backToTemplates') {
//       await goBackToTemplates();
//       window.pendingAction = null;
//     }
//   }, [selectTemplate, goBackToTemplates]);

//   const handleKeepChanges = useCallback(() => {
//     setShowDiscardDialog(false);
//     window.pendingTemplate = null;
//     window.pendingAction = null;
//   }, []);

//   return (
//     <div className="flex h-screen bg-gray-50">
//       {!selectedTemplate ? (
//         <div className="flex-1 flex flex-col">
//           <header className="bg-white border-b border-gray-200 px-6 py-4">
//             <div className="flex items-center justify-between">
//               <div>
//                 <h1 className="text-2xl font-bold text-gray-900">Document Templates</h1>
//                 <p className="text-sm text-gray-600 mt-1">Choose a template to start creating your document</p>
//               </div>
//               <div className="flex items-center space-x-4">
//                 <div className="flex items-center space-x-2 text-sm text-gray-600">
//                   <User className="w-4 h-4" />
//                   <span>User: {userId.slice(-8)}</span>
//                 </div>
//                 {documentList.length > 0 && (
//                   <div className="relative">
//                     <button
//                       onClick={() => setIsMenuOpen(!isMenuOpen)}
//                       className="flex items-center space-x-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
//                     >
//                       <FileText className="w-4 h-4" />
//                       <span>Recent Documents ({documentList.length})</span>
//                       <ChevronDown className="w-4 h-4" />
//                     </button>
                    
//                     {isMenuOpen && (
//                       <div className="absolute right-0 mt-2 w-80 bg-white rounded-lg shadow-lg border border-gray-200 z-10">
//                         <div className="p-4 border-b border-gray-100">
//                           <h3 className="font-semibold text-gray-900">Recent Documents</h3>
//                         </div>
//                         <div className="max-h-64 overflow-y-auto">
//                           {documentList.slice(0, 10).map((doc) => (
//                             <button
//                               key={doc.id}
//                               onClick={() => {
//                                 const template = { id: doc.templateId, content: doc.content };
//                                 handleTemplateSelection(template);
//                                 setIsMenuOpen(false);
//                               }}
//                               className="w-full text-left p-3 hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
//                             >
//                               <div className="flex justify-between items-start">
//                                 <div className="flex-1 min-w-0">
//                                   <p className="font-medium text-gray-900 truncate">{doc.fileName}</p>
//                                   <p className="text-sm text-gray-600">{doc.wordCount} words</p>
//                                 </div>
//                                 <div className="text-xs text-gray-500 ml-2">
//                                   {new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(
//                                     Math.floor((doc.lastSaved - new Date()) / (1000 * 60 * 60 * 24)),
//                                     'day'
//                                   )}
//                                 </div>
//                               </div>
//                             </button>
//                           ))}
//                         </div>
//                       </div>
//                     )}
//                   </div>
//                 )}
//               </div>
//             </div>
//           </header>

//           <div className="bg-white border-b border-gray-200 px-6 py-4">
//             <div className="max-w-md">
//               <div className="relative">
//                 <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
//                 <input
//                   type="text"
//                   value={searchQuery}
//                   onChange={(e) => setSearchQuery(e.target.value)}
//                   placeholder="Search templates..."
//                   className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
//                 />
//               </div>
//             </div>
//           </div>

//           {error && (
//             <div className="bg-red-50 border-l-4 border-red-400 p-4 mx-6 mt-4">
//               <div className="flex">
//                 <div className="ml-3">
//                   <p className="text-sm text-red-700">{error}</p>
//                 </div>
//               </div>
//             </div>
//           )}

//           <div className="flex-1 overflow-auto px-6 py-6">
//             <Templates onSelectTemplate={handleTemplateSelection} query={searchQuery} />
//           </div>
//         </div>
//       ) : (
//         <div className="flex-1 flex flex-col">
//           <header className="bg-white border-b border-gray-200 px-6 py-3">
//             <div className="flex items-center justify-between">
//               <div className="flex items-center space-x-4">
//                 <button
//                   onClick={handleBackToTemplates}
//                   disabled={isLoading}
//                   className="flex items-center space-x-2 px-3 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
//                   title="Back to Templates"
//                 >
//                   <ArrowLeft className="h-4 w-4" />
//                   <span className="text-sm font-medium">Templates</span>
//                 </button>
                
//                 <div className="h-6 w-px bg-gray-300"></div>
                
//                 <div className="flex items-center space-x-3">
//                   <input
//                     type="text"
//                     value={fileName}
//                     onChange={(e) => setFileName(e.target.value)}
//                     className="text-lg font-semibold bg-transparent border-none focus:outline-none focus:ring-2 focus:ring-blue-500 rounded px-2 py-1 min-w-0 w-64"
//                     placeholder="Document name"
//                     disabled={isLoading}
//                   />
                  
//                   <div className="flex items-center space-x-2 text-xs text-gray-500">
//                     {isSaving ? (
//                       <>
//                         <Loader className="w-3 h-3 animate-spin" />
//                         <span>Saving...</span>
//                       </>
//                     ) : lastSaved ? (
//                       <>
//                         <Clock className="w-3 h-3" />
//                         <span>
//                           Saved {new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(
//                             Math.floor((lastSaved - new Date()) / (1000 * 60)),
//                             'minute'
//                           )}
//                         </span>
//                       </>
//                     ) : (
//                       <span className="text-yellow-600">● Unsaved changes</span>
//                     )}
//                   </div>
//                 </div>
//               </div>

//               <div className="flex items-center space-x-2">
//                 <button
//                   onClick={handleManualSave}
//                   disabled={isLoading || isSaving}
//                   className="flex items-center space-x-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
//                   title="Save Document"
//                 >
//                   {isLoading ? (
//                     <Loader className="h-4 w-4 animate-spin" />
//                   ) : (
//                     <Save className="h-4 w-4" />
//                   )}
//                   <span className="text-sm">Save</span>
//                 </button>

//                 <div className="relative">
//                   <button
//                     onClick={() => setIsMenuOpen(!isMenuOpen)}
//                     disabled={isLoading}
//                     className="flex items-center space-x-2 px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
//                   >
//                     <Download className="h-4 w-4" />
//                     <span className="text-sm">Export</span>
//                     <ChevronDown className="h-4 w-4" />
//                   </button>
                  
//                   {isMenuOpen && (
//                     <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 z-10">
//                       <div className="py-1">
//                         <button
//                           onClick={() => {
//                             exportToPDF();
//                             setIsMenuOpen(false);
//                           }}
//                           className="flex items-center space-x-2 w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
//                         >
//                           <Printer className="w-4 h-4" />
//                           <span>Export as PDF</span>
//                         </button>
//                         <button
//                           onClick={() => {
//                             exportToHTML();
//                             setIsMenuOpen(false);
//                           }}
//                           className="flex items-center space-x-2 w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
//                         >
//                           <FileText className="w-4 h-4" />
//                           <span>Export as HTML</span>
//                         </button>
//                         <button
//                           onClick={() => {
//                             exportToText();
//                             setIsMenuOpen(false);
//                           }}
//                           className="flex items-center space-x-2 w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
//                         >
//                           <FileText className="w-4 h-4" />
//                           <span>Export as Text</span>
//                         </button>
//                       </div>
//                     </div>
//                   )}
//                 </div>

//                 <div className="flex items-center space-x-2 text-sm text-gray-600 bg-gray-100 px-3 py-2 rounded-lg">
//                   <User className="w-4 h-4" />
//                   <span>User: {userId.slice(-8)}</span>
//                 </div>
//               </div>
//             </div>

//             {error && (
//               <div className="mt-2 text-sm text-red-600 bg-red-50 px-3 py-1 rounded">
//                 {error}
//               </div>
//             )}
//           </header>

//           <div className="flex-1 overflow-auto">
//             <CKEditor
//               editor={ClassicEditor}
//               data={typeof editorContent === 'string' ? editorContent : ''}
//               onReady={editor => {
//                 console.log('Editor is ready to use!', editor);
//               }}
//               onChange={(event, editor) => {
//                 const data = editor.getData();
//                 handleEditorChange(data);
//               }}
//               onBlur={(event, editor) => {
//                 console.log('Blur.', editor);
//               }}
//               onFocus={(event, editor) => {
//                 console.log('Focus.', editor);
//               }}
//             />
//           </div>
//         </div>
//       )}

//       {showDiscardDialog && (
//         <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
//           <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
//             <div className="p-6">
//               <div className="flex items-center space-x-3">
//                 <div className="flex-shrink-0">
//                   <div className="w-10 h-10 bg-yellow-100 rounded-full flex items-center justify-center">
//                     <span className="text-yellow-600 text-xl">⚠️</span>
//                   </div>
//                 </div>
//                 <div className="flex-1">
//                   <h3 className="text-lg font-semibold text-gray-900">Unsaved Changes</h3>
//                   <p className="text-sm text-gray-600 mt-1">
//                     You have unsaved changes that will be lost if you continue. Do you want to discard your changes?
//                   </p>
//                 </div>
//               </div>
              
//               <div className="flex space-x-3 mt-6">
//                 <button
//                   onClick={handleKeepChanges}
//                   className="flex-1 px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors"
//                 >
//                   Keep Editing
//                 </button>
//                 <button
//                   onClick={handleDiscardChanges}
//                   className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
//                 >
//                   Discard Changes
//                 </button>
//               </div>
//             </div>
//           </div>
//         </div>
//       )}

//       {isMenuOpen && (
//         <div
//           className="fixed inset-0 z-0"
//           onClick={() => setIsMenuOpen(false)}
//         />
//       )}

//       {isLoading && (
//         <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50">
//           <div className="bg-white p-6 rounded-lg shadow-xl flex items-center space-x-3">
//             <Loader className="h-5 w-5 animate-spin text-blue-600" />
//             <span>Loading...</span>
//           </div>
//         </div>
//       )}
//     </div>
//   );
// };

// export default DraftingPage;



import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import {
  Search, Download, Printer, ArrowLeft, Save, Share2,
  Settings, MoreVertical, Clock, Users, FileText,
  ChevronDown, Bell, User, Loader, X, FileUp, CheckCircle, AlertCircle
} from "lucide-react";
import { CKEditor } from "@ckeditor/ckeditor5-react";
import ClassicEditor from "@ckeditor/ckeditor5-build-classic";
import Templates from "../components/Templates";
import ApiService from "@/shared/api/api";
import draftApi from "../api/draftApi";
import '../styles/ckeditor-a4.css';

const generateUserId = () => {
  const stored = localStorage.getItem('documentEditorUserId') || localStorage.getItem('userId');
  if (stored) return stored;
  
  const newId = 'user_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
  localStorage.setItem('documentEditorUserId', newId);
  return newId;
};

const createStorageKey = (userId, templateId, suffix = '') => {
  return `docEditor_${userId}_${templateId || 'blank'}${suffix ? '_' + suffix : ''}`;
};

const downloadBlob = (filename, blob) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

const useAutoSave = (content, storageKey, templateId, delay = 3000) => {
  const timeoutRef = useRef(null);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);

  useEffect(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(async () => {
      if (content && typeof content === 'string') {
        setIsSaving(true);
        try {
          localStorage.setItem(storageKey, content);
          localStorage.setItem(storageKey + '_lastSaved', new Date().toISOString());
          
          if (typeof templateId === 'string' && !templateId.includes('-')) {
            const blob = new Blob([content], { type: 'text/html' });
            const file = new File([blob], 'document.html', { type: 'text/html' });
            
            await ApiService.saveUserDraft(templateId, 'Auto-saved Document', file);
          }
          
          setLastSaved(new Date());
        } catch (error) {
          console.error('Auto-save failed:', error);
        } finally {
          setIsSaving(false);
        }
      }
    }, delay);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [content, storageKey, templateId, delay]);

  return { isSaving, lastSaved };
};

const DraftingPage = () => {
  const userId = useMemo(() => generateUserId(), []);
  
  // Check for ms_connected IMMEDIATELY (synchronous, before any state)
  // This ensures we detect it before component renders
  const urlParamsCheck = new URLSearchParams(window.location.search);
  const msConnectedFromUrl = urlParamsCheck.get('ms_connected');
  const platformFromUrlCheck = urlParamsCheck.get('platform');
  const shouldOpenWord = msConnectedFromUrl === 'true';
  const isMicrosoftWordModeCheck = platformFromUrlCheck === 'microsoft-word';
  
  console.log('[DraftingPage] ⚡ Component initialization - URL check:', {
    msConnected: msConnectedFromUrl,
    shouldOpenWord,
    platform: platformFromUrlCheck,
    isMicrosoftWordMode: isMicrosoftWordModeCheck,
    fullUrl: window.location.href,
    pathname: window.location.pathname
  });
  
  const [searchQuery, setSearchQuery] = useState("");
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [documentList, setDocumentList] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingDocuments, setIsLoadingDocuments] = useState(false);
  const [error, setError] = useState(null);
  const [showDocumentList, setShowDocumentList] = useState(false);
  const [showDiscardDialog, setShowDiscardDialog] = useState(false);
  const [msConnected, setMsConnected] = useState(false);
  const [checkingMsStatus, setCheckingMsStatus] = useState(false);
  const [currentDocumentId, setCurrentDocumentId] = useState(null);
  const [showWelcomeBack, setShowWelcomeBack] = useState(false);
  const [justConnected, setJustConnected] = useState(false);
  const [isOpeningWord, setIsOpeningWord] = useState(shouldOpenWord); // Initialize with URL check

  const currentSessionKey = 'drafting_current_session';
  const currentSessionData = JSON.parse(localStorage.getItem(currentSessionKey) || 'null');

  const [selectedTemplate, setSelectedTemplate] = useState(() => {
    if (currentSessionData && currentSessionData.selectedTemplate) {
      return currentSessionData.selectedTemplate;
    }
    return null;
  });

  const [fileName, setFileName] = useState(() => {
    if (currentSessionData && currentSessionData.fileName) {
      return currentSessionData.fileName;
    }
    return "Untitled Document";
  });

  const [editorContent, setEditorContent] = useState(() => {
    if (currentSessionData && currentSessionData.editorContent) {
      return currentSessionData.editorContent;
    }
    return '';
  });

  const location = window.location;
  const queryParams = new URLSearchParams(location.search);
  const templateIdFromUrl = queryParams.get('templateId');
  const editUrlFromUrl = queryParams.get('editUrl');
  const platformFromUrl = queryParams.get('platform'); // Detect platform from URL
  const isMicrosoftWordMode = platformFromUrl === 'microsoft-word';

  console.log('DraftingPage: Initializing with URL Params:', { templateIdFromUrl, editUrlFromUrl, platformFromUrl, isMicrosoftWordMode });
  console.log('DraftingPage: Current session data:', currentSessionData);

  const currentStorageKey = useMemo(() => 
    createStorageKey(userId, selectedTemplate?.id, 'content'), 
    [userId, selectedTemplate?.id]
  );

  const fileNameStorageKey = useMemo(() => 
    createStorageKey(userId, selectedTemplate?.id, 'fileName'), 
    [userId, selectedTemplate?.id]
  );

  const { isSaving, lastSaved } = useAutoSave(editorContent, currentStorageKey, selectedTemplate?.id);

  // Function to open Word (can be called by user click or automatically)
  // After Microsoft connection, try to create/open a Word document
  const openWordOnline = useCallback(async () => {
    console.log('[DraftingPage] 🎨 Opening Word Online after Microsoft connection...');
    
    try {
      // Check if we have content to export, or create a new document
      const hasContent = editorContent && editorContent.trim() !== '';
      
      if (hasContent && fileName) {
        // Export existing content to Word
        console.log('[DraftingPage] Exporting existing content to Word...');
        setIsLoading(true);
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = typeof editorContent === 'string' ? editorContent : '';
        const textContent = tempDiv.textContent || tempDiv.innerText || '';
        const contentWithBranding = textContent + '\n\n---\nContinue editing in Jurinex: ' + window.location.origin + '/drafting';
        
        const result = await draftApi.exportToWord(fileName, contentWithBranding, currentDocumentId);
        
        if (result && result.webUrl) {
          console.log('[DraftingPage] ✅ Opening Word document:', result.webUrl);
          const wordWindow = window.open(result.webUrl, '_blank', 'noopener,noreferrer');
          
          if (!wordWindow) {
            // Popup blocked - try fallback to Word Online launcher
            console.log('[DraftingPage] Popup blocked, trying Word Online launcher as fallback');
            const fallbackWindow = window.open('https://www.office.com/launch/word', '_blank', 'noopener,noreferrer');
            if (!fallbackWindow) {
              // Both failed - but don't show error, just log it
              console.error('[DraftingPage] Both popup attempts failed');
              setIsLoading(false);
              return false;
            }
          }
          
          setError(null);
          setIsLoading(false);
          
          // Clean up URL - preserve platform parameter
          const cleanUrl = window.location.pathname + '?platform=microsoft-word';
          window.history.replaceState({}, '', cleanUrl);
          
          setTimeout(() => {
            setIsOpeningWord(false);
            setShowWelcomeBack(true);
            setJustConnected(false);
            setTimeout(() => setShowWelcomeBack(false), 5000);
          }, 1500);
          
          return true;
        } else {
          // No webUrl - fallback to Word Online launcher
          console.log('[DraftingPage] No webUrl in response, opening Word Online launcher');
          const wordWindow = window.open('https://www.office.com/launch/word', '_blank', 'noopener,noreferrer');
          const cleanUrl = window.location.pathname + '?platform=microsoft-word';
          window.history.replaceState({}, '', cleanUrl);
          
          if (wordWindow) {
            setError(null);
            setIsLoading(false);
            setTimeout(() => {
              setIsOpeningWord(false);
              setShowWelcomeBack(true);
              setJustConnected(false);
              setTimeout(() => setShowWelcomeBack(false), 5000);
            }, 1500);
            return true;
          }
        }
      } else {
        // No content - just open Word Online launcher
        console.log('[DraftingPage] Opening Word Online launcher (no content to export)');
        const wordWindow = window.open('https://www.office.com/launch/word', '_blank', 'noopener,noreferrer');
        
        // Clean up URL - preserve platform parameter
        const cleanUrl = window.location.pathname + '?platform=microsoft-word';
        window.history.replaceState({}, '', cleanUrl);
        
        if (!wordWindow || wordWindow.closed || typeof wordWindow.closed === 'undefined') {
          // Popup blocked - don't show error, just log it
          console.warn('[DraftingPage] Popup blocked for Word Online launcher');
          setIsLoading(false);
          return false;
        }
        
        setError(null);
        setIsLoading(false);
        setTimeout(() => {
          setIsOpeningWord(false);
          setShowWelcomeBack(true);
          setJustConnected(false);
          setTimeout(() => setShowWelcomeBack(false), 5000);
        }, 1500);
        
        return true;
      }
    } catch (error) {
      console.error('[DraftingPage] Error opening Word:', error);
      // Don't show error to user - silently fallback to Word Online launcher
      console.log('[DraftingPage] Falling back to Word Online launcher due to error:', error.message);
      
      try {
        const wordWindow = window.open('https://www.office.com/launch/word', '_blank', 'noopener,noreferrer');
        const cleanUrl = window.location.pathname + '?platform=microsoft-word';
        window.history.replaceState({}, '', cleanUrl);
        
        if (wordWindow) {
          setError(null); // Clear any previous errors
          setIsLoading(false);
          setTimeout(() => {
            setIsOpeningWord(false);
            setShowWelcomeBack(true);
            setJustConnected(false);
            setTimeout(() => setShowWelcomeBack(false), 5000);
          }, 1500);
          return true;
        }
      } catch (fallbackError) {
        console.error('[DraftingPage] Fallback also failed:', fallbackError);
      }
      
      setIsLoading(false);
      // Don't show error to user - just log it
      setError(null);
      return false;
    }
  }, [editorContent, fileName, currentDocumentId]);

  // Handle OAuth callback FIRST (before other effects) - Try to open Word automatically
  useEffect(() => {
    console.log('[DraftingPage] 🔄 useEffect running - OAuth callback handler:', {
      shouldOpenWord,
      isOpeningWord,
      msConnectedFromUrl
    });
    
    // Only process if we detected ms_connected in URL during initialization
    if (shouldOpenWord && isOpeningWord) {
      console.log('[DraftingPage] ✅ OAuth callback confirmed: ms_connected=true - Attempting to open Word');
      
      setError(null);
      setJustConnected(true);
      
      // Try to open Word automatically (may be blocked by popup blocker)
      // Use a small delay to ensure component is fully mounted
      const timer = setTimeout(() => {
        openWordOnline();
      }, 100);
      
      // Update connection status in background (non-blocking)
      setTimeout(async () => {
        try {
          const status = await draftApi.getMicrosoftStatus();
          setMsConnected(status.isConnected || false);
          console.log('[DraftingPage] Microsoft connection status updated:', status.isConnected);
          
          // Refresh document list after successful connection
          if (status.isConnected && isMicrosoftWordMode) {
            console.log('[DraftingPage] Refreshing Word documents list after connection');
            setTimeout(async () => {
              try {
                const response = await draftApi.getWordDocuments();
                const documents = response.documents || response || [];
                const processedDocs = documents.map(doc => ({
                  ...doc,
                  canOpenInWord: !!(doc.word_file_id || doc.word_web_url),
                  hasWordIntegration: !!(doc.word_file_id || doc.word_web_url)
                }));
                setDocumentList(processedDocs);
                console.log('[DraftingPage] ✅ Word documents refreshed:', processedDocs.length);
              } catch (error) {
                console.error('[DraftingPage] Error refreshing documents:', error);
              }
            }, 2000); // Wait 2 seconds for backend to sync
          }
        } catch (error) {
          console.error('[DraftingPage] Error checking status (non-critical):', error);
        }
      }, 1000);
      
      return () => clearTimeout(timer);
    } else if (shouldOpenWord && !isOpeningWord) {
      // URL has ms_connected but state wasn't set - fix it
      console.log('[DraftingPage] ⚠️ ms_connected detected but isOpeningWord is false - fixing state');
      setIsOpeningWord(true);
    }
  }, [shouldOpenWord, isOpeningWord, msConnectedFromUrl, openWordOnline, isMicrosoftWordMode, editorContent, fileName, currentDocumentId]); // Run when these change
  
  // Check Microsoft connection status on mount and when template is selected
  useEffect(() => {
    const checkMicrosoftStatus = async () => {
      setCheckingMsStatus(true);
      try {
        const status = await draftApi.getMicrosoftStatus();
        setMsConnected(status.isConnected || false);
      } catch (error) {
        console.error('Error checking Microsoft status:', error);
        setMsConnected(false);
      } finally {
        setCheckingMsStatus(false);
      }
    };

    // Check on initial load (but only if not handling OAuth callback)
    const urlParams = new URLSearchParams(window.location.search);
    const platformParam = urlParams.get('platform');
    
    // Always check Microsoft status if platform=microsoft-word
    if (platformParam === 'microsoft-word' && urlParams.get('ms_connected') !== 'true') {
      checkMicrosoftStatus();
    } else if (platformParam !== 'microsoft-word' && urlParams.get('ms_connected') !== 'true') {
      // Check status for non-Microsoft Word mode too (existing behavior)
      checkMicrosoftStatus();
    }
    
    // Handle OAuth errors
    const error = urlParams.get('error');
    const errorDetails = urlParams.get('details');
    const adminConsentUrl = urlParams.get('admin_consent_url');
    
    // Handle error cases
    if (error) {
      let errorMessage = 'Failed to connect Microsoft account.';
      
      switch (error) {
        case 'pkce_expired':
          errorMessage = errorDetails || 'The connection request expired. Please try connecting again.';
          break;
        case 'auth_failed':
          errorMessage = errorDetails || 'Microsoft authentication failed. Please try again.';
          break;
        case 'admin_consent_required':
          errorMessage = adminConsentUrl 
            ? 'Your organization requires admin approval. Please contact your administrator to grant access, or use a personal Microsoft account (Outlook / Hotmail).'
            : 'Admin consent is required. Please contact your administrator.';
          break;
        case 'no_code':
          errorMessage = 'No authorization code received. Please try connecting again.';
          break;
        default:
          errorMessage = errorDetails || `Connection error: ${error}. Please try again.`;
      }
      
      setError(errorMessage);
      console.error('[DraftingPage] OAuth error:', { error, errorDetails, adminConsentUrl });
      
      // Clean up URL
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []); // Run once on mount to handle OAuth callback

  useEffect(() => {
    if (selectedTemplate || fileName || editorContent) {
      const sessionData = {
        selectedTemplate,
        fileName,
        editorContent,
        lastModified: new Date().toISOString()
      };
      localStorage.setItem(currentSessionKey, JSON.stringify(sessionData));
    }
  }, [selectedTemplate, fileName, editorContent, currentSessionKey]);

  useEffect(() => {
    const loadTemplateFromUrl = async () => {
      if (templateIdFromUrl && !currentSessionData) {
        try {
          setIsLoading(true);
          setError(null);
          let templateToLoad = null;

          if (templateIdFromUrl) {
            const result = await ApiService.openTemplateForEditing(templateIdFromUrl);
            const htmlContent = result?.html || result || '';
            
            templateToLoad = {
              id: templateIdFromUrl,
              name: result?.name || 'Document from Backend',
              content: htmlContent,
              isBackendTemplate: true,
            };
            
            setEditorContent(typeof htmlContent === 'string' ? htmlContent : '');
            setFileName(templateToLoad.name?.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase() || 'document');
          } else {
            setEditorContent('');
            setFileName('Untitled Document');
          }
          setSelectedTemplate(templateToLoad);
        } catch (err) {
          console.error('Error loading template from URL:', err);
          setError(`Failed to load document: ${err.message}`);
          setSelectedTemplate(null);
          setEditorContent('');
          setFileName('Untitled Document');
        } finally {
          setIsLoading(false);
        }
      }
    };
    loadTemplateFromUrl();
  }, [templateIdFromUrl, editUrlFromUrl, currentSessionData]);

  useEffect(() => {
    if (selectedTemplate && selectedTemplate.id) {
      const savedContent = localStorage.getItem(currentStorageKey);
      const savedFileName = localStorage.getItem(fileNameStorageKey);
      
      if (!currentSessionData || !currentSessionData.editorContent) {
        if (savedContent) {
          setEditorContent(savedContent);
        }
      }
      
      if (!currentSessionData || !currentSessionData.fileName) {
        if (savedFileName) {
          setFileName(savedFileName);
        }
      }
    }
  }, [selectedTemplate, currentStorageKey, fileNameStorageKey, currentSessionData]);

  useEffect(() => {
    if (selectedTemplate && selectedTemplate.id && editorContent) {
      localStorage.setItem(currentStorageKey, editorContent);
    }
  }, [editorContent, currentStorageKey, selectedTemplate]);

  useEffect(() => {
    if (selectedTemplate && selectedTemplate.id && fileName && fileName !== "Untitled Document") {
      localStorage.setItem(fileNameStorageKey, fileName);
    }
  }, [fileName, fileNameStorageKey, selectedTemplate]);

  // Fetch documents from backend API (platform-aware)
  useEffect(() => {
    const fetchDocuments = async () => {
      setIsLoadingDocuments(true);
      try {
        let documents = [];
        
        // Use Word documents API if platform is microsoft-word
        if (isMicrosoftWordMode) {
          console.log('[DraftingPage] Fetching Word documents (platform=microsoft-word)');
          const response = await draftApi.getWordDocuments();
          documents = response.documents || response || [];
          console.log('[DraftingPage] Fetched Word documents from backend:', documents);
          
          // Ensure documents have canOpenInWord property set based on word_file_id or word_web_url
          documents = documents.map(doc => ({
            ...doc,
            canOpenInWord: !!(doc.word_file_id || doc.word_web_url),
            hasWordIntegration: !!(doc.word_file_id || doc.word_web_url)
          }));
        } else {
          // Use regular documents API for other platforms
          console.log('[DraftingPage] Fetching regular documents');
          const response = await draftApi.getDocuments();
          documents = response.documents || response || [];
          console.log('[DraftingPage] Fetched documents from backend:', documents);
          
          // Also check for Word integration in regular documents
          documents = documents.map(doc => ({
            ...doc,
            canOpenInWord: !!(doc.word_file_id || doc.word_web_url),
            hasWordIntegration: !!(doc.word_file_id || doc.word_web_url)
          }));
        }
        
        console.log('[DraftingPage] Processed documents with Word flags:', documents);
        setDocumentList(documents);
      } catch (error) {
        console.error('[DraftingPage] Error fetching documents:', error);
        // Fallback to empty array if API fails
        setDocumentList([]);
      } finally {
        setIsLoadingDocuments(false);
      }
    };

    fetchDocuments();
  }, [userId, isMicrosoftWordMode]);

  const handleTemplateSelection = useCallback(async (template) => {
    const hasChanges = editorContent && editorContent.trim() !== '' && 
                      (!selectedTemplate || editorContent !== (selectedTemplate.content || ''));
    
    if (hasChanges) {
      window.pendingTemplate = template;
      setShowDiscardDialog(true);
      return;
    }
    
    await selectTemplate(template);
  }, [editorContent, selectedTemplate]);

  const selectTemplate = useCallback(async (template) => {
    try {
      setIsLoading(true);
      setError(null);
      
      console.log('Template selected:', template);

      let fetchedHtmlContent = '';
      try {
        const result = await ApiService.openTemplateForEditing(template.id);
        console.log('Backend template result:', result);
        
        if (typeof result === 'string') {
          fetchedHtmlContent = result;
        } else if (result && typeof result === 'object') {
          fetchedHtmlContent = result.html || result.content || '';
        }
        
        fetchedHtmlContent = typeof fetchedHtmlContent === 'string' ? fetchedHtmlContent : '';
        
        setSelectedTemplate({
          ...template,
          content: fetchedHtmlContent,
          isBackendTemplate: true,
        });
        
        setFileName(template.name?.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase() || 'document');
        
      } catch (err) {
        console.error('Error opening backend template:', err);
        setError('Failed to open backend template. Please try again.');
        
        fetchedHtmlContent = template.content || '';
        setSelectedTemplate({
          ...template,
          content: fetchedHtmlContent,
        });
        setFileName(template.name?.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase() || 'document');
      }

        const specificTemplateStorageKey = createStorageKey(userId, template.id, 'content');
        const savedContent = localStorage.getItem(specificTemplateStorageKey);
        
        if (savedContent) {
          setEditorContent(savedContent);
          console.log('Loaded content from localStorage for template:', template.id);
        } else {
          setEditorContent(fetchedHtmlContent);
          console.log('Loaded content from fetched HTML for template:', template.id);
        }
      
    } catch (error) {
      console.error('Error selecting template:', error);
      setError('Failed to load template. Please try again.');
      
      const fallbackContent = template.content || '';
      setSelectedTemplate({
        ...template,
        content: fallbackContent,
      });
      setEditorContent(typeof fallbackContent === 'string' ? fallbackContent : '');
      setFileName(template.name?.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase() || 'document');
    } finally {
      setIsLoading(false);
    }
  }, [userId, createStorageKey]);

  const handleEditorChange = useCallback((content) => {
    const stringContent = typeof content === 'string' ? content : '';
    setEditorContent(stringContent);
    console.log('Editor content changed:', typeof stringContent, stringContent.substring(0, 100));
  }, []);

  const exportToPDF = useCallback(() => {
    const printWindow = window.open('', '_blank');
    const contentToPrint = typeof editorContent === 'string' ? editorContent : '';

    const printHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>${fileName}</title>
          <link rel="stylesheet" href="https://cdn.ckeditor.com/ckeditor5/41.4.2/classic/ckeditor.css">
          <style>
            body {
              font-family: 'Times New Roman', serif;
              margin: 0;
              padding: 40px;
              background-color: white;
              line-height: 1.6;
              color: #1a1a1a;
            }
            @page {
              margin: 1in;
            }
            @media print {
              body { margin: 0; padding: 0; }
              .no-print { display: none; }
            }
            .ck-content {
              word-wrap: break-word;
            }
            h1, h2, h3, h4, h5, h6 {
              margin-top: 1.5em;
              margin-bottom: 0.5em;
              page-break-after: avoid;
            }
            table {
              border-collapse: collapse;
              width: 100%;
              margin: 1em 0;
            }
            th, td {
              border: 1px solid #ccc;
              padding: 8px;
              text-align: left;
            }
            th { background-color: #f5f5f5; }
            .page-break { page-break-before: always; }
          </style>
        </head>
        <body class="ck-content">
          ${contentToPrint}
        </body>
      </html>
    `;

    printWindow.document.write(printHtml);
    printWindow.document.close();
    printWindow.onload = () => {
      printWindow.focus();
      printWindow.print();
      printWindow.close();
    };
  }, [editorContent, fileName]);

  const exportToHTML = useCallback(() => {
    const contentToExport = typeof editorContent === 'string' ? editorContent : '';
    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <title>${fileName}</title>
          <link rel="stylesheet" href="https://cdn.ckeditor.com/ckeditor5/41.4.2/classic/ckeditor.css">
          <style>
            body {
              font-family: 'Times New Roman', serif;
              max-width: 800px;
              margin: 0 auto;
              padding: 40px;
              line-height: 1.6;
              color: #1a1a1a;
            }
            .ck-content {
              word-wrap: break-word;
            }
            h1, h2, h3, h4, h5, h6 { margin-top: 1.5em; margin-bottom: 0.5em; }
            p { margin-bottom: 1em; }
            table { border-collapse: collapse; width: 100%; margin: 1em 0; }
            th, td { border: 1px solid #ccc; padding: 8px; text-align: left; }
            th { background-color: #f5f5f5; }
            img { max-width: 100%; height: auto; }
          </style>
        </head>
        <body class="ck-content">
          ${contentToExport}
        </body>
      </html>
    `;
    
    downloadBlob(`${fileName}.html`, new Blob([htmlContent], { type: "text/html;charset=utf-8" }));
  }, [editorContent, fileName]);

  const exportToText = useCallback(() => {
    const contentToExport = typeof editorContent === 'string' ? editorContent : '';
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = contentToExport;
    const textContent = tempDiv.textContent || tempDiv.innerText || '';
    
    downloadBlob(`${fileName}.txt`, new Blob([textContent], { type: "text/plain;charset=utf-8" }));
  }, [editorContent, fileName]);

  const exportToWord = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Extract text content from HTML
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = typeof editorContent === 'string' ? editorContent : '';
      const textContent = tempDiv.textContent || tempDiv.innerText || '';

      // Add Jurinex branding to document content (invisible metadata)
      const contentWithBranding = textContent + '\n\n---\nContinue editing in Jurinex: ' + window.location.origin + '/drafting';

      const result = await draftApi.exportToWord(fileName, contentWithBranding, currentDocumentId);
      
      if (result.webUrl) {
        // Open Word Online editor in new tab
        // The webUrl should open directly in Word Online editor using user's own license
        console.log('[DraftingPage] 🎨 Jurinex: Opening Word Online editor:', result.webUrl);
        const wordWindow = window.open(result.webUrl, '_blank');
        
        if (!wordWindow) {
          // Popup blocked - show message
          setError('Please allow popups to open Word Online editor. You can also copy this URL: ' + result.webUrl);
        } else {
          setError(null);
          // Show Jurinex success message
          setShowWelcomeBack(true);
          setTimeout(() => {
            setShowWelcomeBack(false);
          }, 5000);
          console.log('[DraftingPage] ✅ Word document opened successfully via Jurinex');
        }
      } else {
        throw new Error('Word export succeeded but no URL returned');
      }
    } catch (error) {
      console.error('Error exporting to Word:', error);
      if (error.message?.includes('not connected')) {
        setError('Microsoft account not connected. Connect your Microsoft account through Jurinex to use Word Online.');
      } else {
        setError(error.message || 'Failed to export to Word via Jurinex. Please ensure your Microsoft account is connected.');
      }
    } finally {
      setIsLoading(false);
      setIsMenuOpen(false);
    }
  }, [editorContent, fileName, currentDocumentId]);

  const handleConnectMicrosoft = useCallback(async () => {
    try {
      setIsLoading(true);
      await draftApi.signInWithMicrosoft();
      // The user will be redirected to Microsoft OAuth, then back to the app
    } catch (error) {
      console.error('Error connecting Microsoft account:', error);
      setError('Failed to connect Microsoft account. Please try again.');
      setIsLoading(false);
    }
  }, []);

  const handleBackToTemplates = useCallback(async () => {
    const hasChanges = editorContent && editorContent.trim() !== '' && 
                      (!selectedTemplate || editorContent !== (selectedTemplate.content || ''));
    
    if (hasChanges) {
      window.pendingAction = 'backToTemplates';
      setShowDiscardDialog(true);
      return;
    }
    
    await goBackToTemplates();
  }, [editorContent, selectedTemplate]);

  const goBackToTemplates = useCallback(async () => {
    try {
      if (editorContent && selectedTemplate) {
        localStorage.setItem(currentStorageKey, editorContent);
        localStorage.setItem(currentStorageKey + '_lastSaved', new Date().toISOString());
        
        if (selectedTemplate.id && typeof selectedTemplate.id === 'string' && !selectedTemplate.id.includes('-')) {
          const blob = new Blob([editorContent], { type: 'text/html' });
          const file = new File([blob], fileName + '.html', { type: 'text/html' });
          
          await ApiService.saveUserDraft(selectedTemplate.id, fileName, file);
        }
      }
    } catch (error) {
      console.error('Error saving before exit:', error);
    }
    
    localStorage.removeItem(currentSessionKey);
    
    setSelectedTemplate(null);
    setEditorContent('');
    setFileName('Untitled Document');
    setError(null);
  }, [editorContent, selectedTemplate, currentStorageKey, fileName, currentSessionKey]);

  const handleManualSave = useCallback(async () => {
    try {
      setIsLoading(true);
      
      localStorage.setItem(currentStorageKey, editorContent);
      localStorage.setItem(currentStorageKey + '_lastSaved', new Date().toISOString());
      
      if (selectedTemplate?.id && typeof selectedTemplate.id === 'string' && !selectedTemplate.id.includes('-')) {
        const blob = new Blob([editorContent], { type: 'text/html' });
        const file = new File([blob], fileName + '.html', { type: 'text/html' });
          
        await ApiService.saveUserDraft(selectedTemplate.id, fileName, file);
      }
      
      setError(null);
      
    } catch (error) {
      console.error('Manual save failed:', error);
      setError('Failed to save document. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [editorContent, currentStorageKey, selectedTemplate, fileName]);

  const handleDiscardChanges = useCallback(async () => {
    setShowDiscardDialog(false);
    
    if (window.pendingTemplate) {
      await selectTemplate(window.pendingTemplate);
      window.pendingTemplate = null;
    } else if (window.pendingAction === 'backToTemplates') {
      await goBackToTemplates();
      window.pendingAction = null;
    }
  }, [selectTemplate, goBackToTemplates]);

  const handleKeepChanges = useCallback(() => {
    setShowDiscardDialog(false);
    window.pendingTemplate = null;
    window.pendingAction = null;
  }, []);

  // Show loading screen while opening Word (don't show landing page)
  if (isOpeningWord) {
    return (
      <div className="flex h-screen bg-gray-50 items-center justify-center">
        <div className="text-center max-w-md mx-auto px-6">
          <Loader className="h-12 w-12 animate-spin text-blue-600 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            <span className="text-blue-600">Jurinex</span> - Opening Word Online
          </h2>
          <p className="text-gray-600 mb-6">Please wait while we open Microsoft Word in a new tab...</p>
          
          {/* Always show button - popup blockers prevent automatic opening */}
          <div className="mt-6">
            <button
              onClick={() => {
                const opened = openWordOnline();
                if (opened) {
                  setError(null);
                }
              }}
              className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-4 px-10 rounded-lg transition-all flex items-center justify-center gap-3 mx-auto shadow-lg hover:shadow-xl transform hover:scale-105 text-lg"
            >
              <FileText className="w-6 h-6" />
              Open Word Online Now
            </button>
            {error && (
              <p className="text-sm text-red-600 mt-3 font-medium">{error}</p>
            )}
            {!error && (
              <p className="text-sm text-gray-600 mt-3">
                Click the button above to open Microsoft Word in a new tab
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-50">
      {!selectedTemplate ? (
        <div className="flex-1 flex flex-col">
          <header className="bg-white border-b border-gray-200 px-6 py-4">
            {/* Jurinex Welcome Back Banner */}
            {showWelcomeBack && (
              <div className="mb-4 bg-gradient-to-r from-blue-50 to-indigo-50 border-l-4 border-blue-500 p-4 rounded-lg shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <CheckCircle className="h-6 w-6 text-blue-600" />
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">Welcome back to Jurinex</h3>
                      <p className="text-sm text-gray-600">Your Word document is ready. Continue editing here or return to Word anytime.</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowWelcomeBack(false)}
                    className="text-gray-400 hover:text-gray-600 transition-colors"
                    aria-label="Dismiss"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>
            )}
            
            {/* Jurinex Connection Success Banner */}
            {justConnected && (
              <div className="mb-4 bg-green-50 border-l-4 border-green-500 p-4 rounded-lg shadow-sm">
                <div className="flex items-center space-x-3">
                  <CheckCircle className="h-6 w-6 text-green-600" />
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">Microsoft Word Connected via Jurinex</h3>
                    <p className="text-sm text-gray-600">Opening Word Online... You can now create and edit documents with your Microsoft account.</p>
                  </div>
                </div>
              </div>
            )}
            
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">
                  <span className="text-blue-600">Jurinex</span> Document Templates
                </h1>
                <p className="text-sm text-gray-600 mt-1">Choose a template to start creating your document with Jurinex</p>
              </div>
              <div className="flex items-center space-x-4">
                {/* Microsoft Connection Status */}
                {!checkingMsStatus && (
                  <div className="flex items-center space-x-2">
                    {msConnected ? (
                      <div className="flex items-center space-x-1 text-sm text-green-600 bg-green-50 px-3 py-2 rounded-lg border border-green-200">
                        <CheckCircle className="w-4 h-4" />
                        <span className="font-medium">Word Connected via Jurinex</span>
                      </div>
                    ) : (
                      <div className="flex flex-col items-start">
                        <button
                          onClick={handleConnectMicrosoft}
                          disabled={isLoading}
                          className="flex items-center space-x-1 text-sm text-blue-600 bg-blue-50 px-3 py-2 rounded-lg hover:bg-blue-100 transition-colors disabled:opacity-50 border border-blue-200"
                          title="Connect your Microsoft account to use Word Online through Jurinex"
                        >
                          <AlertCircle className="w-4 h-4" />
                          <span className="font-medium">Connect Word via Jurinex</span>
                        </button>
                        <div className="text-xs text-gray-500 mt-1 max-w-xs">
                          Powered by Jurinex • Requires Microsoft account (Outlook/Hotmail)
                        </div>
                      </div>
                    )}
                  </div>
                )}
                
                <div className="flex items-center space-x-2 text-sm text-gray-600">
                  <User className="w-4 h-4" />
                  <span>User: {userId.slice(-8)}</span>
                </div>
                {documentList.length > 0 && (
                  <div className="relative">
                    <button
                      onClick={() => setIsMenuOpen(!isMenuOpen)}
                      className="flex items-center space-x-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                    >
                      <FileText className="w-4 h-4" />
                      <span>Recent Documents ({documentList.length})</span>
                      <ChevronDown className="w-4 h-4" />
                    </button>
                    
                    {isMenuOpen && (
                      <div className="absolute right-0 mt-2 w-96 bg-white rounded-lg shadow-lg border border-gray-200 z-10">
                        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
                          <h3 className="font-semibold text-gray-900">My Documents</h3>
                          {isLoadingDocuments && <Loader className="w-4 h-4 animate-spin text-gray-400" />}
                        </div>
                        <div className="max-h-96 overflow-y-auto">
                          {documentList.length === 0 ? (
                            <div className="p-4 text-center text-gray-500 text-sm">
                              No documents yet. Create your first document!
                            </div>
                          ) : (
                            documentList.map((doc) => (
                              <div
                                key={doc.id}
                                className="p-3 hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
                              >
                                <div className="flex justify-between items-start gap-2">
                                  <div className="flex-1 min-w-0">
                                    <button
                                      onClick={() => {
                                        if (doc.content) {
                                          const template = { id: doc.id, content: doc.content };
                                          handleTemplateSelection(template);
                                        } else {
                                          // Load document from API
                                          draftApi.getDocument(doc.id).then(result => {
                                            const template = { id: result.id, content: result.content };
                                            handleTemplateSelection(template);
                                          }).catch(err => {
                                            setError('Failed to load document: ' + err.message);
                                          });
                                        }
                                        setIsMenuOpen(false);
                                      }}
                                      className="text-left w-full"
                                    >
                                      <p className="font-medium text-gray-900 truncate">{doc.title || doc.fileName || 'Untitled Document'}</p>
                                      <div className="flex items-center gap-2 mt-1">
                                        <p className="text-xs text-gray-500">
                                          {doc.updated_at ? new Date(doc.updated_at).toLocaleDateString() : 'Recently'}
                                        </p>
                                        {doc.hasWordIntegration && (
                                          <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                                            Word
                                          </span>
                                        )}
                                      </div>
                                    </button>
                                  </div>
                                  {doc.canOpenInWord && (
                                    <button
                                      onClick={async (e) => {
                                        e.stopPropagation();
                                        setIsLoading(true);
                                        setError(null);
                                        try {
                                          console.log('[DraftingPage] Opening Word document:', doc.id, doc.title);
                                          const result = await draftApi.reopenWordDocument(doc.id);
                                          console.log('[DraftingPage] Reopen Word document result:', result);
                                          
                                          if (result && result.webUrl) {
                                            console.log('[DraftingPage] Opening Word URL:', result.webUrl);
                                            const wordWindow = window.open(result.webUrl, '_blank', 'noopener,noreferrer');
                                            if (!wordWindow) {
                                              setError('Popup blocked! Please allow popups to open Word document. URL: ' + result.webUrl);
                                            } else {
                                              setError(null);
                                              console.log('[DraftingPage] ✅ Word document opened successfully');
                                            }
                                          } else {
                                            console.error('[DraftingPage] ❌ No webUrl in response:', result);
                                            setError('Failed to open Word document: No URL returned from server. Response: ' + JSON.stringify(result));
                                          }
                                        } catch (error) {
                                          console.error('[DraftingPage] ❌ Error opening Word document:', error);
                                          setError('Failed to open Word document: ' + (error.message || error.toString()));
                                        } finally {
                                          setIsLoading(false);
                                        }
                                      }}
                                      className="flex-shrink-0 ml-2 p-1.5 text-blue-600 hover:bg-blue-50 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                      title="Open in Word"
                                      disabled={isLoading}
                                    >
                                      <FileText className="w-4 h-4" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </header>

          <div className="bg-white border-b border-gray-200 px-6 py-4">
            <div className="max-w-md">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search templates..."
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border-l-4 border-red-400 p-4 mx-6 mt-4">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-start">
                    <AlertCircle className="h-5 w-5 text-red-400 mt-0.5 mr-2 flex-shrink-0" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-red-800">Connection Error</p>
                      <p className="text-sm text-red-700 mt-1">{error}</p>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setError(null)}
                  className="ml-4 text-red-400 hover:text-red-600 transition-colors"
                  aria-label="Dismiss error"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
          )}

          <div className="flex-1 overflow-auto px-6 py-6">
            <Templates onSelectTemplate={handleTemplateSelection} query={searchQuery} />
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col">
          <header className="bg-white border-b border-gray-200 px-6 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <button
                  onClick={handleBackToTemplates}
                  disabled={isLoading}
                  className="flex items-center space-x-2 px-3 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
                  title="Back to Templates"
                >
                  <ArrowLeft className="h-4 w-4" />
                  <span className="text-sm font-medium">Templates</span>
                </button>
                
                <div className="h-6 w-px bg-gray-300"></div>
                
                <div className="flex items-center space-x-3">
                  <input
                    type="text"
                    value={fileName}
                    onChange={(e) => setFileName(e.target.value)}
                    className="text-lg font-semibold bg-transparent border-none focus:outline-none focus:ring-2 focus:ring-blue-500 rounded px-2 py-1 min-w-0 w-64"
                    placeholder="Document name"
                    disabled={isLoading}
                  />
                  
                  <div className="flex items-center space-x-2 text-xs text-gray-500">
                    {isSaving ? (
                      <>
                        <Loader className="w-3 h-3 animate-spin" />
                        <span>Saving...</span>
                      </>
                    ) : lastSaved ? (
                      <>
                        <Clock className="w-3 h-3" />
                        <span>
                          Saved {new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(
                            Math.floor((lastSaved - new Date()) / (1000 * 60)),
                            'minute'
                          )}
                        </span>
                      </>
                    ) : (
                      <span className="text-yellow-600">● Unsaved changes</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={handleManualSave}
                  disabled={isLoading || isSaving}
                  className="flex items-center space-x-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                  title="Save Document"
                >
                  {isLoading ? (
                    <Loader className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  <span className="text-sm">Save</span>
                </button>

                <div className="relative">
                  <button
                    onClick={() => setIsMenuOpen(!isMenuOpen)}
                    disabled={isLoading}
                    className="flex items-center space-x-2 px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                  >
                    <Download className="h-4 w-4" />
                    <span className="text-sm">Export</span>
                    <ChevronDown className="h-4 w-4" />
                  </button>
                  
                  {isMenuOpen && (
                    <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 z-10">
                      <div className="py-1">
                        <button
                          onClick={() => {
                            exportToPDF();
                            setIsMenuOpen(false);
                          }}
                          className="flex items-center space-x-2 w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                        >
                          <Printer className="w-4 h-4" />
                          <span>Export as PDF</span>
                        </button>
                        <button
                          onClick={() => {
                            exportToHTML();
                            setIsMenuOpen(false);
                          }}
                          className="flex items-center space-x-2 w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                        >
                          <FileText className="w-4 h-4" />
                          <span>Export as HTML</span>
                        </button>
                        <button
                          onClick={() => {
                            exportToText();
                            setIsMenuOpen(false);
                          }}
                          className="flex items-center space-x-2 w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                        >
                          <FileText className="w-4 h-4" />
                          <span>Export as Text</span>
                        </button>
                        <div className="border-t border-gray-200 my-1"></div>
                        <button
                          onClick={exportToWord}
                          disabled={!msConnected || isLoading}
                          className="flex items-center space-x-2 w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                          title={!msConnected ? "Connect Microsoft account to export to Word" : "Export to Microsoft Word"}
                        >
                          <FileUp className="w-4 h-4" />
                          <span>Export to Word</span>
                          {msConnected && <CheckCircle className="w-3 h-3 text-green-600" />}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Microsoft Connection Status */}
                {!checkingMsStatus && (
                  <div className="flex items-center space-x-2">
                    {msConnected ? (
                      <div className="flex items-center space-x-1 text-sm text-green-600 bg-green-50 px-3 py-2 rounded-lg border border-green-200">
                        <CheckCircle className="w-4 h-4" />
                        <span>Word Connected via Jurinex</span>
                      </div>
                    ) : (
                      <button
                        onClick={handleConnectMicrosoft}
                        disabled={isLoading}
                        className="flex items-center space-x-1 text-sm text-blue-600 bg-blue-50 px-3 py-2 rounded-lg hover:bg-blue-100 transition-colors disabled:opacity-50 border border-blue-200"
                        title="Connect your Microsoft account to use Word Online through Jurinex"
                      >
                        <AlertCircle className="w-4 h-4" />
                        <span>Connect Word via Jurinex</span>
                      </button>
                    )}
                  </div>
                )}

                <div className="flex items-center space-x-2 text-sm text-gray-600 bg-gray-100 px-3 py-2 rounded-lg">
                  <User className="w-4 h-4" />
                  <span>User: {userId.slice(-8)}</span>
                </div>
              </div>
            </div>

            {error && (
              <div className="mt-2 text-sm text-red-600 bg-red-50 px-3 py-1 rounded">
                {error}
              </div>
            )}
          </header>

          <div className="flex-1 overflow-auto">
            <CKEditor
              editor={ClassicEditor}
              data={typeof editorContent === 'string' ? editorContent : ''}
              onReady={editor => {
                console.log('Editor is ready to use!', editor);
              }}
              onChange={(event, editor) => {
                const data = editor.getData();
                handleEditorChange(data);
              }}
              onBlur={(event, editor) => {
                console.log('Blur.', editor);
              }}
              onFocus={(event, editor) => {
                console.log('Focus.', editor);
              }}
            />
          </div>
        </div>
      )}

      {showDiscardDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="p-6">
              <div className="flex items-center space-x-3">
                <div className="flex-shrink-0">
                  <div className="w-10 h-10 bg-yellow-100 rounded-full flex items-center justify-center">
                    <span className="text-yellow-600 text-xl">⚠️</span>
                  </div>
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-gray-900">Unsaved Changes</h3>
                  <p className="text-sm text-gray-600 mt-1">
                    You have unsaved changes that will be lost if you continue. Do you want to discard your changes?
                  </p>
                </div>
              </div>
              
              <div className="flex space-x-3 mt-6">
                <button
                  onClick={handleKeepChanges}
                  className="flex-1 px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors"
                >
                  Keep Editing
                </button>
                <button
                  onClick={handleDiscardChanges}
                  className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                >
                  Discard Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isMenuOpen && (
        <div
          className="fixed inset-0 z-0"
          onClick={() => setIsMenuOpen(false)}
        />
      )}

      {isLoading && (
        <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-xl flex items-center space-x-3">
            <Loader className="h-5 w-5 animate-spin text-blue-600" />
            <span>Loading...</span>
          </div>
        </div>
      )}
    </div>
  );
};
export default DraftingPage;