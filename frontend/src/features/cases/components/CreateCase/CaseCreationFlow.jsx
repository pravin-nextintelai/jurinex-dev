// import React, { useState, useEffect } from 'react';
// import {
//   Scale, Building2, Users, Tag, FolderPlus, CheckCircle,
//   AlertCircle, RotateCcw, Clock, Save
// } from 'lucide-react';

// import OverviewStep from './steps/OverviewStep';
// import JurisdictionStep from './steps/JurisdictionStep';
// import PartiesStep from './steps/PartiesStep';
// import CategoryStep from './steps/CategoryStep';
// import DatesStep from './steps/DatesStep';
// import ReviewStep from './steps/ReviewStep';
// import { useAutoSave } from '../../hooks/useAutoSave';

// const CaseCreationFlow = ({ onComplete, onCancel, userId = null, skipDraftPrompt = false }) => {
//   const [currentStep, setCurrentStep] = useState(1);
//   const [isLoading, setIsLoading] = useState(true);
//   const [showDraftPrompt, setShowDraftPrompt] = useState(false);

//   const [caseData, setCaseData] = useState({
//     caseTitle: '',
//     caseType: '',
//     caseTypeId: '',
//     subType: '',
//     subTypeId: '',
//     caseNumber: '',
//     courtName: '',
//     courtId: '',
//     filingDate: '',
//     category: '',
//     primaryCategory: '',
//     subCategory: '',
//     complexity: '',
//     monetaryValue: '',
//     priorityLevel: 'Medium',
//     courtLevel: 'High Court',
//     benchDivision: '',
//     jurisdiction: 'Delhi',
//     state: 'Delhi',
//     judges: [],
//     courtRoomNo: '',
//     petitioners: [{ fullName: '', role: '', advocateName: '', barRegistration: '', contact: '' }],
//     respondents: [{ fullName: '', role: '', advocateName: '', barRegistration: '', contact: '' }],
//     nextHearingDate: '',
//     deadlineDate: '',
//     servedDate: '',
//     lastUpdated: '',
//     currentStatus: 'Active',
//     uploadedFiles: []
//   });

//   const {
//     saveStatus,
//     lastSaveTime,
//     actualUserId,
//     manualSave,
//     loadDraft,
//     deleteDraft,
//     resetAutoSave
//   } = useAutoSave(caseData, currentStep, userId, true);

//   useEffect(() => {
//     const init = async () => {
//       if (!actualUserId || !Number.isInteger(actualUserId)) {
//         setIsLoading(false);
//         return;
//       }
//       try {
//         const draft = await loadDraft();
//         if (draft && draft.draft_data) {
//           if (skipDraftPrompt) {
//             let draftData = draft.draft_data;
            
//             if (draftData.caseType && !isNaN(draftData.caseType)) {
//               console.log('⚠️ Old draft detected with case type ID:', draftData.caseType);
//               draftData = { ...draftData, caseTypeId: draftData.caseType };
//             }
//             if (draftData.courtName && !isNaN(draftData.courtName)) {
//               console.log('⚠️ Old draft detected with court ID:', draftData.courtName);
//               draftData = { ...draftData, courtId: draftData.courtName };
//             }
//             if (draftData.subType && !isNaN(draftData.subType)) {
//               console.log('⚠️ Old draft detected with sub-type ID:', draftData.subType);
//               draftData = { ...draftData, subTypeId: draftData.subType };
//             }
            
//             setCaseData(draftData);
//             setCurrentStep(draft.last_step || 1);
            
//             if (resetAutoSave) {
//               resetAutoSave(draftData);
//             }
            
//             console.log('✅ Draft loaded directly (skipped popup)');
//           } else {
//             setShowDraftPrompt(true);
//           }
//         }
//       } catch (err) {
//         console.error("Failed to load draft:", err);
//       } finally {
//         setIsLoading(false);
//       }
//     };
//     init();
//   }, [actualUserId, loadDraft, skipDraftPrompt]);

//   const handleLoadDraft = async () => {
//     const draft = await loadDraft();
//     if (draft) {
//       let draftData = draft.draft_data;
      
//       if (draftData.caseType && !isNaN(draftData.caseType)) {
//         console.log('⚠️ Old draft detected with case type ID:', draftData.caseType);
//         draftData = { ...draftData, caseTypeId: draftData.caseType };
//       }
//       if (draftData.courtName && !isNaN(draftData.courtName)) {
//         console.log('⚠️ Old draft detected with court ID:', draftData.courtName);
//         draftData = { ...draftData, courtId: draftData.courtName };
//       }
//       if (draftData.subType && !isNaN(draftData.subType)) {
//         console.log('⚠️ Old draft detected with sub-type ID:', draftData.subType);
//         draftData = { ...draftData, subTypeId: draftData.subType };
//       }
      
//       setCaseData(draftData);
//       setCurrentStep(draft.last_step || 1);
      
//       if (resetAutoSave) {
//         resetAutoSave(draftData);
//       }
//     }
//     setShowDraftPrompt(false);
//   };

//   const handleStartFresh = async () => {
//     await deleteDraft();
//     setShowDraftPrompt(false);
//   };

//   const handleBack = () => {
//     if (currentStep > 1) setCurrentStep(currentStep - 1);
//   };

//   const handleNext = () => {
//     if (currentStep < 6) {
//       setCurrentStep(currentStep + 1);
//     }
//   };

//   const handleResetToFirstStep = () => {
//     setCaseData({
//       caseTitle: '', caseType: '', caseTypeId: '', subType: '', subTypeId: '', caseNumber: '',
//       courtName: '', courtId: '', filingDate: '', category: '', primaryCategory: '',
//       subCategory: '', complexity: '', monetaryValue: '', priorityLevel: 'Medium',
//       courtLevel: 'High Court', benchDivision: '', jurisdiction: 'Delhi',
//       state: 'Delhi', judges: [], courtRoomNo: '',
//       petitioners: [{ fullName: '', role: '', advocateName: '', barRegistration: '', contact: '' }],
//       respondents: [{ fullName: '', role: '', advocateName: '', barRegistration: '', contact: '' }],
//       nextHearingDate: '', deadlineDate: '', servedDate: '', currentStatus: 'Active', uploadedFiles: []
//     });
//     setCurrentStep(1);
//   };

//   const handleCaseCreated = async () => {
//     await deleteDraft();
//     console.log("Case created successfully → Draft deleted from database");
//   };

//   const steps = [
//     { number: 1, name: 'Overview', icon: Scale },
//     { number: 2, name: 'Jurisdiction', icon: Building2 },
//     { number: 3, name: 'Parties', icon: Users },
//     { number: 4, name: 'Category', icon: Tag },
//     { number: 5, name: 'Dates', icon: FolderPlus },
//     { number: 6, name: 'Review', icon: CheckCircle }
//   ];

//   const getAutoSaveIcon = () => {
//     switch (saveStatus) {
//       case 'saving': return <RotateCcw className="w-4 h-4 mr-1 animate-spin" />;
//       case 'saved': return <CheckCircle className="w-4 h-4 mr-1" />;
//       case 'error': return <AlertCircle className="w-4 h-4 mr-1" />;
//       default: return <Clock className="w-4 h-4 mr-1" />;
//     }
//   };

//   const getAutoSaveText = () => {
//     switch (saveStatus) {
//       case 'saving': return 'Saving...';
//       case 'saved': return lastSaveTime ? `Saved at ${lastSaveTime.toLocaleTimeString()}` : 'Saved';
//       case 'error': return 'Save failed';
//       default: return 'Auto-save enabled';
//     }
//   };

//   const getAutoSaveColor = () => {
//     return saveStatus === 'saved' ? 'text-[#21C1B6]' :
//            saveStatus === 'error' ? 'text-red-600' :
//            saveStatus === 'saving' ? 'text-blue-600' : 'text-gray-500';
//   };

//   if (isLoading) {
//     return (
//       <div className="min-h-screen bg-[#FDFCFB] flex items-center justify-center">
//         <div className="text-center">
//           <RotateCcw className="w-8 h-8 animate-spin text-[#21C1B6] mb-3" />
//           <p className="text-gray-600">Loading your case form...</p>
//         </div>
//       </div>
//     );
//   }

//   if (showDraftPrompt) {
//     return (
//       <div className="min-h-screen bg-[#FDFCFB] flex items-center justify-center p-4">
//         <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full text-center">
//           <div className="w-16 h-16 bg-[#21C1B6] bg-opacity-10 rounded-full flex items-center justify-center mx-auto mb-4">
//             <Scale className="w-10 h-10 text-[#21C1B6]" />
//           </div>
//           <h2 className="text-2xl font-bold text-gray-900 mb-3">Resume Previous Draft?</h2>
//           <p className="text-gray-600 mb-8">
//             We found an incomplete case draft. Would you like to continue from where you left off?
//           </p>
//           <div className="flex gap-4">
//             <button
//               onClick={handleStartFresh}
//               className="flex-1 px-6 py-3 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition"
//             >
//               Start Fresh
//             </button>
//             <button
//               onClick={handleLoadDraft}
//               className="flex-1 px-6 py-3 bg-[#21C1B6] text-white rounded-md hover:bg-[#1AA89E] transition"
//             >
//               Resume Draft
//             </button>
//           </div>
//         </div>
//       </div>
//     );
//   }

//   return (
//     <div className="min-h-screen bg-[#FDFCFB]">
//       <div className="bg-white border-b shadow-sm sticky top-0 z-10">
//         <div className="max-w-6xl mx-auto px-8 py-6">
//           <div className="flex items-center justify-between mb-6">
//             <div>
//               <h1 className="text-2xl font-bold text-gray-800">Create New Case</h1>
//               <p className="text-sm text-gray-500">
//                 Step {currentStep} of 6
//               </p>
//             </div>
//             <button onClick={onCancel} className="text-gray-500 hover:text-gray-700 text-sm">
//               Cancel
//             </button>
//           </div>

//           <div className="flex items-center justify-between">
//             {steps.map((step, index) => (
//               <React.Fragment key={step.number}>
//                 <div className="flex flex-col items-center">
//                   <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
//                     currentStep >= step.number ? 'bg-[#21C1B6] text-white' : 'bg-gray-200 text-gray-400'
//                   }`}>
//                     <step.icon className="w-5 h-5" />
//                   </div>
//                   <span className={`text-xs mt-2 ${currentStep >= step.number ? 'text-gray-700 font-medium' : 'text-gray-400'}`}>
//                     {step.name}
//                   </span>
//                 </div>
//                 {index < steps.length - 1 && (
//                   <div className={`flex-1 h-1 mx-2 transition-all ${currentStep > step.number ? 'bg-[#21C1B6]' : 'bg-gray-200'}`} />
//                 )}
//               </React.Fragment>
//             ))}
//           </div>
//         </div>
//       </div>

//       <div className="max-w-4xl mx-auto px-8 py-8">
//         <div className="bg-white rounded-lg shadow-sm p-8 min-h-[500px]">
//           {currentStep === 1 && <OverviewStep caseData={caseData} setCaseData={setCaseData} />}
//           {currentStep === 2 && <JurisdictionStep caseData={caseData} setCaseData={setCaseData} />}
//           {currentStep === 3 && <PartiesStep caseData={caseData} setCaseData={setCaseData} />}
//           {currentStep === 4 && <CategoryStep caseData={caseData} setCaseData={setCaseData} />}
//           {currentStep === 5 && <DatesStep caseData={caseData} setCaseData={setCaseData} />}
//           {currentStep === 6 && (
//             <ReviewStep
//               caseData={caseData}
//               onBack={handleBack}
//               onResetToFirstStep={handleResetToFirstStep}
//               onComplete={handleCaseCreated}
//             />
//           )}
//         </div>

//         {currentStep < 6 && (
//           <div className="mt-6 flex justify-between items-center">
//             <div className="flex items-center space-x-4">
//               <span className={`inline-flex items-center text-sm ${getAutoSaveColor()}`}>
//                 {getAutoSaveIcon()}
//                 {getAutoSaveText()}
//               </span>
//               <button
//                 onClick={manualSave}
//                 className="inline-flex items-center px-3 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition"
//               >
//                 <Save className="w-3 h-3 mr-1" />
//                 Force Save
//               </button>
//             </div>

//             <div className="flex space-x-2">
//               {currentStep > 1 && (
//                 <button
//                   onClick={handleBack}
//                   className="px-4 py-1.5 border border-[#21C1B6] text-[#21C1B6] rounded-sm text-sm hover:bg-[#E6F8F7] transition"
//                 >
//                   Back
//                 </button>
//               )}
//               {currentStep < 6 && (
//                 <button
//                   onClick={handleNext}
//                   className="px-4 py-1.5 border border-[#21C1B6] text-[#21C1B6] rounded-sm text-sm hover:bg-[#E6F8F7] transition"
//                 >
//                   Skip
//                 </button>
//               )}
//               <button
//                 onClick={handleNext}
//                 className="px-4 py-1.5 bg-[#21C1B6] text-white rounded-sm text-sm font-medium hover:bg-[#1AA89E] transition flex items-center"
//               >
//                 Continue
//                 <span className="ml-1">→</span>
//               </button>
//             </div>
//           </div>
//         )}
//       </div>
//     </div>
//   );
// };

// export default CaseCreationFlow;


import React, { useState, useEffect } from 'react';
import { toast } from 'react-toastify';
import { Upload, Scale, Users, FolderPlus, CheckCircle, AlertCircle, RotateCcw, LogOut } from 'lucide-react';
import UploadStep from './steps/UploadStep.jsx';
import OverviewStep from './steps/OverviewStep.jsx';
import PartiesStep from './steps/PartiesStep.jsx';
import DatesStep from './steps/DatesStep.jsx';
import ReviewStep from './steps/ReviewStep.jsx';
import { useAutoSave } from '../../hooks/useAutoSave';

// Survive a refresh mid-flow: the processed documents (tempFolderName) and the
// auto-filled fields live only in memory, so a crash or refresh before the case
// was created silently lost everything the user had just processed.
const CREATE_CASE_PERSIST_KEY = 'jurinex.createCase.v1';
const CREATE_CASE_PERSIST_TTL_MS = 24 * 60 * 60 * 1000;

const loadPersistedFlow = () => {
  try {
    const saved = JSON.parse(sessionStorage.getItem(CREATE_CASE_PERSIST_KEY) || 'null');
    if (saved && Date.now() - (saved.ts || 0) < CREATE_CASE_PERSIST_TTL_MS) return saved;
  } catch { /* corrupt state — start fresh */ }
  return null;
};

const clearPersistedFlow = () => {
  try { sessionStorage.removeItem(CREATE_CASE_PERSIST_KEY); } catch { /* non-fatal */ }
};

const CaseCreationFlow = ({ onComplete, onCancel, userId = null }) => {
  const [creationMode] = useState('auto-fill'); // Always auto-fill mode
  // Restored once per mount — refresh mid-flow resumes instead of starting over.
  const [persistedInit] = useState(loadPersistedFlow);
  const [currentStep, setCurrentStep] = useState(() => persistedInit?.currentStep || 1);
  const [isLoading, setIsLoading] = useState(true);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [editingFromReview, setEditingFromReview] = useState(false); // Track if editing from Review page
  const [editingStep, setEditingStep] = useState(null); // Track which step is being edited
  const [isUploadComplete, setIsUploadComplete] = useState(() => Boolean(persistedInit?.isUploadComplete)); // Track if upload and processing is complete
  const [caseData, setCaseData] = useState(() => persistedInit?.caseData ? { ...persistedInit.caseData } : {
    caseTitle: '',
    caseType: '',
    subType: '',
    caseNumber: '',
    casePrefix: '',
    caseYear: '',
    caseNature: '',
    courtName: '',
    filingDate: '',
    category: '',
    primaryCategory: '',
    subCategory: '',
    complexity: '',
    monetaryValue: '',
    priorityLevel: 'Medium',
    courtLevel: '',
    benchDivision: '',
    jurisdiction: '',
    jurisdictionName: '',
    jurisdictionId: '',
    state: '',
    judges: [],
    courtRoom: '',
    petitioners: [{ fullName: '', role: '', advocateName: '', barRegistration: '', contact: '' }],
    respondents: [{ fullName: '', role: '', advocateName: '', barRegistration: '', contact: '' }],
    nextHearingDate: '',
    deadlineDate: '',
    servedDate: '',
    lastUpdated: '',
    currentStatus: '',
    documentType: '',
    filedBy: '',
    uploadedFiles: [],
    autoFilledFields: [] // Track which fields were auto-filled for highlighting
  });

  // Auto-fill mode: no drafts (files are uploaded and extracted immediately)
  const { actualUserId, tokenError } = useAutoSave(
    caseData,
    currentStep,
    userId,
    false // Disable auto-save for auto-fill mode
  );

  // Persist the flow so a refresh (or a render crash) never loses processed
  // documents + extracted fields. Local File objects can't be serialized —
  // they are stripped; server-side file records (post-processing) survive.
  useEffect(() => {
    try {
      const serializableFiles = (caseData.uploadedFiles || []).filter(
        (f) => !(typeof File !== 'undefined' && f instanceof File)
      );
      sessionStorage.setItem(CREATE_CASE_PERSIST_KEY, JSON.stringify({
        caseData: { ...caseData, uploadedFiles: serializableFiles },
        currentStep,
        isUploadComplete,
        ts: Date.now(),
      }));
    } catch { /* storage full/unavailable — non-fatal */ }
  }, [caseData, currentStep, isUploadComplete]);

  // Tell the user their processed work was restored after a refresh.
  useEffect(() => {
    if (persistedInit?.caseData?.tempFolderName) {
      toast.info('Restored your in-progress case — the processed documents are still here.', { autoClose: 6000 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    console.log('🎯 CaseCreationFlow State:', {
      providedUserId: userId,
      actualUserId,
      userIdType: typeof actualUserId,
      isValidInteger: Number.isInteger(actualUserId) && actualUserId > 0,
      tokenError,
      draftLoaded,
      currentStep,
      hasData: Object.values(caseData).some(val => val && val !== '')
    });
  }, [userId, actualUserId, tokenError, draftLoaded, currentStep, caseData]);

  const handleTokenError = () => {
    localStorage.removeItem('token');
    
    
    console.log('🔄 Redirecting to login due to token error');
    alert('Your session has expired. Please log in again.');
    
    window.location.reload();
  };

  useEffect(() => {
    // Auto-fill mode doesn't use drafts, skip draft loading
    setDraftLoaded(true);
    setIsLoading(false);
  }, [actualUserId, tokenError]);

  // Reset upload completion status when returning to step 1
  useEffect(() => {
    if (currentStep === 1) {
      // Reset upload completion when user goes back to upload step
      setIsUploadComplete(false);
    }
  }, [currentStep]);


  const handleUploadComplete = () => {
    // After upload and extraction, go directly to Review page
    setCurrentStep(5); // Review step
  };

  const handleUploadStatusChange = (status) => {
    // Update upload completion status when upload status changes
    setIsUploadComplete(status === 'success');
  };

  const steps = [
    { number: 1, name: 'Upload', icon: Upload },
    { number: 2, name: 'Overview', icon: Scale },
    { number: 3, name: 'Parties', icon: Users },
    { number: 4, name: 'Dates', icon: FolderPlus },
    { number: 5, name: 'Review', icon: CheckCircle }
  ];


  const handleNext = async () => {
    // If editing from Review page, just return to Review
    if (editingFromReview) {
      setCurrentStep(5); // Review step
      setEditingFromReview(false);
      setEditingStep(null);
      return;
    }

    // Special case: If on step 1 (Upload) after completion, go directly to Review
    if (currentStep === 1) {
      setCurrentStep(5); // Go directly to Review page
      return;
    }

    // Normal flow: continue to next step
    const maxStep = 5;
    if (currentStep < maxStep) {
      setCurrentStep(currentStep + 1);
    } else if (onComplete) {
      clearPersistedFlow();
      onComplete(caseData);
    }
  };

  // Handle editing a specific step from Review page
  const handleEditFromReview = (stepNumber) => {
    setEditingFromReview(true);
    setEditingStep(stepNumber);
    setCurrentStep(stepNumber);
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleCancel = async () => {
    // No draft saving - just cancel
    clearPersistedFlow();
    if (onCancel) {
      onCancel();
    }
  };

  const handleResetToFirstStep = () => {
    clearPersistedFlow();
    setCaseData({
      caseTitle: '',
      caseType: '',
      subType: '',
      caseNumber: '',
      courtName: '',
      filingDate: '',
      category: '',
      primaryCategory: '',
      subCategory: '',
      complexity: '',
      monetaryValue: '',
      priorityLevel: 'Medium',
      courtLevel: '',
      benchDivision: '',
      jurisdiction: '',
      jurisdictionName: '',
      jurisdictionId: '',
      state: '',
      judges: [],
      courtRoom: '',
      petitioners: [{ fullName: '', role: '', advocateName: '', barRegistration: '', contact: '' }],
      respondents: [{ fullName: '', role: '', advocateName: '', barRegistration: '', contact: '' }],
      nextHearingDate: '',
      deadlineDate: '',
      servedDate: '',
      lastUpdated: '',
      currentStatus: '',
      uploadedFiles: []
    });
    setCurrentStep(1);
  };


  if (tokenError) {
    return (
      <div className="min-h-screen bg-[#FDFCFB] flex items-center justify-center">
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-md mx-4">
          <div className="text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="w-8 h-8 text-red-600" />
            </div>
            <h2 className="text-xl font-bold text-gray-800 mb-2">Authentication Error</h2>
            <p className="text-gray-600 mb-6">{tokenError}</p>
            <button
              onClick={handleTokenError}
              className="flex items-center justify-center px-4 py-2 bg-[#21C1B6] text-white rounded-md hover:bg-[#1AA89E] transition-colors w-full"
            >
              <LogOut className="w-4 h-4 mr-2" />
              Login Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!actualUserId || !Number.isInteger(actualUserId) || actualUserId <= 0) {
    return (
      <div className="min-h-screen bg-[#FDFCFB] flex items-center justify-center">
        <div className="flex flex-col items-center">
          <AlertCircle className="w-8 h-8 text-red-500 mb-2" />
          <p className="text-gray-600">Invalid User Authentication</p>
          <p className="text-sm text-gray-500 mt-1">
            Please ensure you are logged in with a valid account.
          </p>
          <button
            onClick={handleTokenError}
            className="mt-4 px-4 py-2 bg-[#21C1B6] text-white rounded-md hover:bg-[#1AA89E] transition-colors"
          >
            Login Again
          </button>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#FDFCFB] flex items-center justify-center">
        <div className="flex flex-col items-center">
          <RotateCcw className="w-8 h-8 animate-spin text-[#21C1B6] mb-2" />
          <p className="text-gray-600">Loading case form...</p>
          <p className="text-sm text-gray-500 mt-1">User ID: {actualUserId}</p>
        </div>
      </div>
    );
  }


  return (
    <div className="h-screen bg-[#F8FAFA] flex flex-col overflow-hidden">
      <div className="bg-white border-b border-gray-100 shadow-sm sticky top-0 z-10 flex-shrink-0">
        <div className="max-w-6xl mx-auto px-8 py-5">
          {/* Title row */}
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#21C1B6] to-[#1AA89E] flex items-center justify-center shadow-md shadow-[#21C1B6]/25">
                <Scale className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900 leading-tight">Create New Case</h1>
                <p className="text-xs text-gray-400 font-medium">Step {currentStep} of {steps.length}</p>
              </div>
            </div>
            <button
              onClick={handleCancel}
              className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700 hover:bg-gray-50 px-3 py-1.5 rounded-lg transition-all duration-200 font-medium"
            >
              <span>✕</span>
              Cancel
            </button>
          </div>

          {/* Step Progress */}
          <div className="flex items-center">
            {steps.map((step, index) => {
              const isCurrentStep = currentStep === step.number;
              const isCompletedStep = currentStep > step.number;

              return (
                <React.Fragment key={step.number}>
                  <div className="flex flex-col items-center gap-1.5 relative">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-300 ${
                        isCompletedStep
                          ? 'bg-[#21C1B6] text-white shadow-md shadow-[#21C1B6]/25'
                          : isCurrentStep
                          ? 'bg-gradient-to-br from-[#21C1B6] to-[#1AA89E] text-white shadow-lg shadow-[#21C1B6]/30 scale-105'
                          : 'bg-gray-100 text-gray-400'
                      }`}
                    >
                      {isCompletedStep
                        ? <CheckCircle className="w-4.5 h-4.5" style={{ width: 18, height: 18 }} />
                        : <step.icon className="w-4 h-4" />
                      }
                    </div>
                    <span className={`text-[11px] font-semibold whitespace-nowrap transition-colors duration-300 ${
                      isCurrentStep ? 'text-[#21C1B6]' :
                      isCompletedStep ? 'text-gray-600' : 'text-gray-300'
                    }`}>
                      {step.name}
                    </span>
                  </div>
                  {index < steps.length - 1 && (
                    <div className="flex-1 mx-2 mb-5 relative h-1 rounded-full overflow-hidden bg-gray-100">
                      <div
                        className="absolute inset-y-0 left-0 rounded-full transition-all duration-500 ease-out"
                        style={{
                          width: isCompletedStep ? '100%' : '0%',
                          background: 'linear-gradient(90deg, #21C1B6, #1AA89E)',
                        }}
                      />
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-8 py-8">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 min-h-[500px]">
            {/* Upload Step */}
            {currentStep === 1 && (
              <UploadStep 
                caseData={caseData} 
                setCaseData={setCaseData}
                onComplete={handleUploadComplete}
                onUploadStatusChange={handleUploadStatusChange}
              />
            )}
            
            {/* Form Steps */}
            {currentStep === 2 && (
              <OverviewStep caseData={caseData} setCaseData={setCaseData} />
            )}
            
            {currentStep === 3 && (
              <PartiesStep caseData={caseData} setCaseData={setCaseData} />
            )}
            
            {currentStep === 4 && (
              <DatesStep caseData={caseData} setCaseData={setCaseData} />
            )}
            
            {currentStep === 5 && (
              <ReviewStep
                caseData={caseData}
                onBack={handleBack}
                onResetToFirstStep={handleResetToFirstStep}
                onEditStep={handleEditFromReview}
                creationMode={creationMode}
                // The case now exists — wipe the refresh-resume state so the
                // wizard can never resurrect an already-created case.
                onComplete={clearPersistedFlow}
              />
            )}
          </div>

          {/* Navigation buttons */}
          {currentStep < 5 && !editingFromReview && (
            <div className="mt-6 flex justify-end">
              <div className="flex items-center gap-2">
                {currentStep > 1 && (
                  <button
                    onClick={handleBack}
                    className="px-5 py-2 border border-gray-200 text-gray-600 rounded-xl text-sm font-semibold hover:border-gray-300 hover:bg-gray-50 transition-all duration-200"
                  >
                    ← Back
                  </button>
                )}
                {currentStep > 1 && currentStep < 4 && (
                  <button
                    onClick={handleNext}
                    className="px-5 py-2 border border-[#21C1B6]/50 text-[#21C1B6] rounded-xl text-sm font-semibold hover:bg-[#21C1B6]/5 transition-all duration-200"
                  >
                    Skip
                  </button>
                )}
                {(currentStep !== 1 || isUploadComplete) && (
                  <button
                    onClick={handleNext}
                    className="px-6 py-2 bg-gradient-to-r from-[#21C1B6] to-[#1AA89E] text-white rounded-xl text-sm font-bold shadow-md shadow-[#21C1B6]/25 hover:shadow-lg hover:shadow-[#21C1B6]/35 hover:scale-[1.02] transition-all duration-200 flex items-center gap-1.5"
                  >
                    {currentStep === 1 ? 'Continue' : 'Continue'}
                    <span>→</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Navigation buttons when editing from Review */}
          {editingFromReview && (currentStep === 2 || currentStep === 3 || currentStep === 4) && (
            <div className="mt-6 flex justify-end">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setCurrentStep(5); setEditingFromReview(false); setEditingStep(null); }}
                  className="px-5 py-2 border border-gray-200 text-gray-600 rounded-xl text-sm font-semibold hover:bg-gray-50 transition-all duration-200"
                >
                  Cancel
                </button>
                <button
                  onClick={handleNext}
                  className="px-6 py-2 bg-gradient-to-r from-[#21C1B6] to-[#1AA89E] text-white rounded-xl text-sm font-bold shadow-md shadow-[#21C1B6]/25 hover:shadow-lg transition-all duration-200"
                >
                  Save Changes
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CaseCreationFlow;