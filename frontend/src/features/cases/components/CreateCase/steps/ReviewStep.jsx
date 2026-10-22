// import React, { useState } from "react";
// import { useNavigate } from "react-router-dom";
// import {
//   CheckCircle,
//   FolderOpen,
//   Upload,
//   Calendar,
//   Sparkles,
//   Loader2,
// } from "lucide-react";
// import { DOCS_BASE_URL } from "@/config/apiConfig";

// const ReviewStep = ({ caseData, onBack, onResetToFirstStep, onComplete }) => {
//   const navigate = useNavigate();
//   const [isCreating, setIsCreating] = useState(false);
//   const [isCreated, setIsCreated] = useState(false);
//   const [createdCase, setCreatedCase] = useState(null);
//   const [error, setError] = useState(null);

//   const handleCreateCase = async () => {
//     setIsCreating(true);
//     setError(null);

//     try {
//       const token = 
//         localStorage.getItem("authToken") ||
//         localStorage.getItem("token") ||
//         localStorage.getItem("access_token") ||
//         localStorage.getItem("jwt") ||
//         sessionStorage.getItem("authToken") ||
//         sessionStorage.getItem("token");

//       if (!token) {
//         throw new Error("Authentication token not found. Please login again.");
//       }

//       const requestBody = {
//         case_title: caseData.caseTitle || "Untitled Case",
//         case_number: caseData.caseNumber || null,
//         filing_date: caseData.filingDate || new Date().toISOString(),
//         case_type: caseData.caseType || caseData.category || "Criminal",
//         sub_type: caseData.subType || null,
//         court_name: caseData.courtName || "Delhi High Court",
//         court_level: caseData.courtLevel || null,
//         bench_division: caseData.benchDivision || null,
//         jurisdiction: caseData.jurisdiction || null,
//         state: caseData.state || null,
//         judges: caseData.judges || null,
//         court_room_no: caseData.courtRoomNo || null,
//         petitioners: caseData.petitioners || null,
//         respondents: caseData.respondents || null,
//         category_type: caseData.categoryType || null,
//         primary_category: caseData.primaryCategory || null,
//         sub_category: caseData.subCategory || null,
//         complexity: caseData.complexity || null,
//         monetary_value: caseData.monetaryValue || null,
//         priority_level: caseData.priorityLevel || null,
//         status: caseData.currentStatus || "Active",
//       };

//       const response = await fetch(`${DOCS_BASE_URL}/create`, {
//         method: "POST",
//         headers: {
//           "Content-Type": "application/json",
//           "Authorization": `Bearer ${token}`,
//         },
//         body: JSON.stringify(requestBody),
//       });

//       const data = await response.json();

//       if (!response.ok) {
//         throw new Error(data.error || `Server error: ${response.status}`);
//       }

//       setCreatedCase(data.case);
//       setIsCreated(true);

//       if (onComplete) {
//         onComplete(data.case);
//       }

//       console.log("Case created successfully & draft will be deleted:", data.case);

//     } catch (err) {
//       console.error("Error creating case:", err);
//       setError(err.message || "Failed to create case. Please try again.");
//     } finally {
//       setIsCreating(false);
//     }
//   };

//   const handleGoToCaseDetails = () => {
//     if (createdCase && createdCase.id) {
//       navigate(`/cases/${createdCase.id}`, { state: { case: createdCase } });
//     }
//   };

//   const handleCreateAnother = () => {
//     setIsCreated(false);
//     setCreatedCase(null);
//     setError(null);
//     onResetToFirstStep();
//   };

//   const displayCaseNumber = createdCase?.case_number || 
//     caseData.caseNumber || 
//     `CRL/${Math.floor(Math.random() * 1000)}/2025`;

//   if (!isCreated) {
//     return (
//       <div>
//         <div className="text-center mb-8">
//           <h2 className="text-2xl font-bold text-gray-900 mb-3">
//             Review Case Details
//           </h2>
//           <p className="text-sm text-gray-600">
//             Please review the case information before creating.
//           </p>
//         </div>

//         {error && (
//           <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
//             <p className="text-sm text-red-800">{error}</p>
//           </div>
//         )}

//         <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
//           <div className="flex items-center mb-4 pb-4 border-b border-gray-200">
//             <FolderOpen className="w-5 h-5 mr-2 text-[#9CDFE1]" />
//             <div>
//               <h3 className="text-lg font-semibold text-gray-900">
//                 Case Information
//               </h3>
//               <p className="text-xs text-gray-500">
//                 Key details for your case
//               </p>
//             </div>
//           </div>

//           <div className="grid grid-cols-2 gap-6">
//             <div className="space-y-4">
//               <div>
//                 <p className="text-xs text-gray-500 mb-1">Case Title</p>
//                 <p className="text-sm font-medium text-gray-900">
//                   {caseData.caseTitle || "Rajesh Kumar Singh vs State"}
//                 </p>
//               </div>
//               <div>
//                 <p className="text-xs text-gray-500 mb-1">Court</p>
//                 <p className="text-sm font-medium text-gray-900">
//                   {caseData.courtName || caseData.courtLevel || "Delhi High Court"}
//                 </p>
//               </div>
//               <div>
//                 <p className="text-xs text-gray-500 mb-1">Status</p>
//                 <p className="text-sm font-medium text-green-600 flex items-center">
//                   <span className="w-2 h-2 bg-green-500 rounded-full mr-2"></span>
//                   {caseData.currentStatus || "Active"}
//                 </p>
//               </div>
//             </div>

//             <div className="space-y-4">
//               <div>
//                 <p className="text-xs text-gray-500 mb-1">Case Number</p>
//                 <p className="text-sm font-medium text-gray-900">
//                   {caseData.caseNumber || "To be assigned"}
//                 </p>
//               </div>
//               <div>
//                 <p className="text-xs text-gray-500 mb-1">Filing Date</p>
//                 <p className="text-sm font-medium text-gray-900">
//                   {caseData.filingDate
//                     ? new Date(caseData.filingDate).toLocaleDateString("en-GB", {
//                         day: "2-digit",
//                         month: "short",
//                         year: "numeric",
//                       })
//                     : "15-Jan-2025"}
//                 </p>
//               </div>
//               <div>
//                 <p className="text-xs text-gray-500 mb-1">Case Type</p>
//                 <p className="text-sm font-medium text-gray-900">
//                   {caseData.caseType || caseData.category || "Criminal"}
//                 </p>
//               </div>
//             </div>
//           </div>

//           <div className="flex gap-3 mt-6 pt-6 border-t border-gray-200">
//             <button
//               onClick={onBack}
//               disabled={isCreating}
//               className="flex-1 px-4 py-3 bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
//             >
//               Back
//             </button>
//             <button
//               onClick={handleCreateCase}
//               disabled={isCreating}
//               className="flex-1 px-4 py-3 bg-[#21C1B6] text-white rounded-md hover:bg-[#1AA89E] transition-colors flex items-center justify-center text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
//             >
//               {isCreating ? (
//                 <>
//                   <Loader2 className="w-4 h-4 mr-2 animate-spin" />
//                   Creating Case...
//                 </>
//               ) : (
//                 <>
//                   <CheckCircle className="w-4 h-4 mr-2" />
//                   Create Case
//                 </>
//               )}
//             </button>
//           </div>
//         </div>
//       </div>
//     );
//   }

//   return (
//     <div>
//       <div className="flex justify-center mb-6">
//         <div className="w-16 h-16 bg-[#9CDFE1] rounded-full flex items-center justify-center">
//           <CheckCircle className="w-10 h-10 text-white" />
//         </div>
//       </div>

//       <div className="text-center mb-8">
//         <h2 className="text-2xl font-bold text-gray-900 mb-3">
//           Case Created Successfully!
//         </h2>
//         <p className="text-sm text-gray-600 mb-2">
//           Your case has been created and saved to your dashboard.{" "}
//           <strong>{displayCaseNumber}</strong>
//         </p>
//         <p className="text-sm text-gray-600">
//           You're all set to start managing your case with JuriNex.
//         </p>
//       </div>

//       <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
//         <div className="flex items-center mb-4 pb-4 border-b border-gray-200">
//           <FolderOpen className="w-5 h-5 mr-2 text-[#9CDFE1]" />
//           <div>
//             <h3 className="text-lg font-semibold text-gray-900">
//               Case Information
//             </h3>
//             <p className="text-xs text-gray-500">
//               Key details for your newly created case
//             </p>
//           </div>
//         </div>

//         <div className="grid grid-cols-2 gap-6">
//           <div className="space-y-4">
//             <div>
//               <p className="text-xs text-gray-500 mb-1">Case Title</p>
//               <p className="text-sm font-medium text-gray-900">
//                 {createdCase?.case_title || caseData.caseTitle || "Rajesh Kumar Singh vs State"}
//               </p>
//             </div>
//             <div>
//               <p className="text-xs text-gray-500 mb-1">Court</p>
//               <p className="text-sm font-medium text-gray-900">
//                 {createdCase?.court_name || caseData.courtName || "Delhi High Court"}
//               </p>
//             </div>
//             <div>
//               <p className="text-xs text-gray-500 mb-1">Status</p>
//               <p className="text-sm font-medium text-green-600 flex items-center">
//                 <span className="w-2 h-2 bg-green-500 rounded-full mr-2"></span>
//                 {createdCase?.status || caseData.currentStatus || "Active"}
//               </p>
//             </div>
//           </div>

//           <div className="space-y-4">
//             <div>
//               <p className="text-xs text-gray-500 mb-1">Case Number</p>
//               <p className="text-sm font-medium text-gray-900">{displayCaseNumber}</p>
//             </div>
//             <div>
//               <p className="text-xs text-gray-500 mb-1">Filing Date</p>
//               <p className="text-sm font-medium text-gray-900">
//                 {createdCase?.filing_date || caseData.filingDate
//                   ? new Date(createdCase?.filing_date || caseData.filingDate).toLocaleDateString("en-GB", {
//                       day: "2-digit",
//                       month: "short",
//                       year: "numeric",
//                     })
//                   : "15-Jan-2025"}
//               </p>
//             </div>
//             <div>
//               <p className="text-xs text-gray-500 mb-1">Case Type</p>
//               <p className="text-sm font-medium text-gray-900">
//                 {createdCase?.case_type || caseData.caseType || "Criminal"}
//               </p>
//             </div>
//           </div>
//         </div>

//         <div className="flex gap-3 mt-6 pt-6 border-t border-gray-200">
//           <button
//             onClick={handleGoToCaseDetails}
//             className="flex-1 px-4 py-3 bg-[#9CDFE1] text-white rounded-md hover:bg-[#87D8DB] transition-colors flex items-center justify-center text-sm font-medium"
//           >
//             <FolderOpen className="w-4 h-4 mr-2" />
//             Go to Case Details
//           </button>
//           <button
//             onClick={handleCreateAnother}
//             className="flex-1 px-4 py-3 bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors flex items-center justify-center text-sm font-medium"
//           >
//             <span className="mr-2 text-lg">+</span> Create Another Case
//           </button>
//         </div>
//       </div>

//       <div className="bg-gray-50 rounded-lg p-6 mt-6">
//         <h4 className="text-center text-base font-semibold text-gray-900 mb-2">
//           What's Next?
//         </h4>
//         <p className="text-center text-sm text-gray-600 mb-6">
//           Start managing your case efficiently with our AI-powered tools.
//         </p>

//         <div className="grid grid-cols-3 gap-6">
//           {[
//             { icon: Upload, label: "Upload Documents" },
//             { icon: Calendar, label: "Schedule Events" },
//             { icon: Sparkles, label: "AI Analysis" },
//           ].map(({ icon: Icon, label }) => (
//             <div key={label} className="text-center">
//               <div className="flex justify-center mb-3">
//                 <div className="w-12 h-12 bg-white border border-gray-200 rounded-lg flex items-center justify-center shadow-sm">
//                   <Icon className="w-6 h-6 text-[#9CDFE1]" />
//                 </div>
//               </div>
//               <p className="text-sm font-medium text-gray-900">{label}</p>
//             </div>
//           ))}
//         </div>
//       </div>
//     </div>
//   );
// };

// export default ReviewStep;





import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from '@/shared/context';
import {
  CheckCircle,
  FolderOpen,
  Upload,
  Calendar,
  Sparkles,
  Loader2,
  Scale,
  Users,
  FolderPlus,
  Edit,
  Building2,
  FileText,
} from "lucide-react";
import { DOCS_BASE_URL, CONTENT_SERVICE_DIRECT } from "@/config/apiConfig";
import { canUsePermission, PERMISSION_KEYS } from "@/shared/utils/permissions";

const ReviewStep = ({ caseData, onBack, onResetToFirstStep, onComplete, onEditStep, creationMode }) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [isCreating, setIsCreating] = useState(false);
  const [isCreated, setIsCreated] = useState(false);
  const [createdCase, setCreatedCase] = useState(null);
  const [error, setError] = useState(null);
  const [generatedCaseTitle, setGeneratedCaseTitle] = useState(null); // Store the generated case title
  const [disclaimerAccepted, setDisclaimerAccepted] = useState(false); // Disclaimer checkbox state
  const canCreateCases = canUsePermission(user, PERMISSION_KEYS.CREATE_CASE);

  // Format date helper function
  const formatDate = (dateString) => {
    if (!dateString) return "Not specified";
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) {
        // Try Indian format (dd/mm/yyyy)
        if (dateString.includes("/")) {
          return dateString;
        }
        return dateString;
      }
      return date.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
    } catch {
      return dateString;
    }
  };

  // Format date for display (handles both ISO and display formats)
  const formatDateDisplay = (dateString, displayFormat) => {
    if (displayFormat) return displayFormat;
    return formatDate(dateString);
  };

  const handleEditStep = (stepNumber) => {
    if (onEditStep) {
      // Map Review step numbers to actual step numbers based on creation mode
      // In auto-fill: Overview=2, Parties=3, Dates=4
      // In manual: Overview=1, Parties=2, Dates=3
      let actualStepNumber;
      if (creationMode === 'auto-fill') {
        actualStepNumber = stepNumber; // Already correct (2, 3, 4)
      } else {
        actualStepNumber = stepNumber - 1; // Manual mode (1, 2, 3)
      }
      onEditStep(actualStepNumber);
    } else if (onBack) {
      // Fallback: go back
      onBack();
    }
  };

 
  const handleCreateCase = async () => {
    // Prevent duplicate case creation
    if (isCreated || isCreating) {
      console.warn('Case creation already in progress or completed');
      return;
    }

    if (!canCreateCases) {
      setError('You do not have permission to create new cases.');
      return;
    }

    setIsCreating(true);
    setError(null);
  
    try {
      const token =
        localStorage.getItem("authToken") ||
        localStorage.getItem("token") ||
        localStorage.getItem("access_token") ||
        localStorage.getItem("jwt") ||
        sessionStorage.getItem("authToken") ||
        sessionStorage.getItem("token");
  
      if (!token) {
        throw new Error("Authentication token not found. Please login again.");
      }
  
      // Determine filed_by value based on boolean flags
      let filedByValue = null;
      if (caseData.filedByPlaintiff && caseData.filedByDefendant) {
        filedByValue = "Both";
      } else if (caseData.filedByPlaintiff) {
        filedByValue = "Plaintiff";
      } else if (caseData.filedByDefendant) {
        filedByValue = "Respondent";
      }
  
      // Generate case title from petitioners vs respondents if not provided
      let generatedCaseTitle = caseData.caseTitle;
      
      // Only generate if caseTitle is empty, null, undefined, or "Untitled Case"
      if (!generatedCaseTitle || generatedCaseTitle.trim() === "" || generatedCaseTitle === "Untitled Case") {
        const petitionerNames = caseData.petitioners && caseData.petitioners.length > 0
          ? caseData.petitioners.map(p => p.fullName).filter(Boolean)
          : [];
        
        const respondentNames = caseData.respondents && caseData.respondents.length > 0
          ? caseData.respondents.map(r => r.fullName).filter(Boolean)
          : [];
  
        if (petitionerNames.length > 0 && respondentNames.length > 0) {
          const petitionerPart = petitionerNames.length === 1
            ? petitionerNames[0]
            : `${petitionerNames[0]} & ${petitionerNames.length - 1} Other${petitionerNames.length - 1 > 1 ? 's' : ''}`;
          
          const respondentPart = respondentNames.length === 1
            ? respondentNames[0]
            : `${respondentNames[0]} & ${respondentNames.length - 1 > 1 ? 's' : ''}`;
          
          generatedCaseTitle = `${petitionerPart} vs ${respondentPart}`;
        } else if (petitionerNames.length > 0) {
          generatedCaseTitle = `${petitionerNames[0]} (Petitioner)`;
        } else if (respondentNames.length > 0) {
          generatedCaseTitle = `${respondentNames[0]} (Respondent)`;
        } else {
          // Last resort: use case number if available, otherwise default
          generatedCaseTitle = caseData.caseNumber 
            ? `Case ${caseData.caseNumber}`
            : "Untitled Case";
        }
      }
  
      const requestBody = {
        case_title: generatedCaseTitle,
        case_number: caseData.caseNumber || null,
        filing_date: caseData.filingDate || new Date().toISOString(),
        case_type: caseData.caseType || caseData.category || "Criminal",
        sub_type: caseData.subType || null,
        court_name: caseData.courtName || null,
        court_level: caseData.courtLevel || null,
        bench_division: caseData.benchName || caseData.benchDivision || null,
        jurisdiction: caseData.jurisdictionName || caseData.jurisdiction || null,
        // state: caseData.state || null,  // REMOVED
        judges: caseData.judges || null,
        court_room_no: caseData.courtRoom || caseData.courtRoomNo || null,
        petitioners: caseData.petitioners || null,
        respondents: caseData.respondents || null,
        category_type: caseData.categoryType || null,
        primary_category: caseData.primaryCategory || null,
        sub_category: caseData.subCategory || null,
        complexity: caseData.complexity || null,
        monetary_value: caseData.monetaryValue || null,
        priority_level: caseData.priorityLevel || null,
        status: caseData.currentStatus || "Active",
        case_prefix: caseData.casePrefix || null,
        case_year: caseData.caseYear || null,
        case_nature: caseData.caseNature || null,
        next_hearing_date: caseData.nextHearingDate || null,
        document_type: caseData.documentType || null,
        filed_by: filedByValue,
        temp_folder_name: caseData.tempFolderName || null, // Include temp folder name for file migration
      };
  
      console.log("Creating case with request body:", requestBody);
  
      const response = await fetch(`${DOCS_BASE_URL}/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(requestBody),
      });
  
      const data = await response.json();
  
      if (!response.ok) {
        console.error("Server error response:", data);
        throw new Error(data.error || data.details || `Server error: ${response.status}`);
      }
  
      setCreatedCase(data.case);
      setGeneratedCaseTitle(generatedCaseTitle); // Store the generated title
      setIsCreated(true);
  
      // Delete any existing draft when case is successfully created
      try {
        // Extract userId from token
        const tokenParts = token.split('.');
        if (tokenParts.length === 3) {
          const payload = JSON.parse(atob(tokenParts[1]));
          const userId = payload.userId || payload.user_id || payload.id || payload.sub;
          if (userId) {
            const draftResponse = await fetch(`${CONTENT_SERVICE_DIRECT}/case-draft/${userId}`, {
              method: 'DELETE',
              headers: {
                'Authorization': `Bearer ${token}`,
              },
            });
            if (draftResponse.ok || draftResponse.status === 404) {
              console.log('✅ Draft deleted after case creation');
            }
          }
        }
      } catch (draftError) {
        console.warn('⚠️ Error deleting draft (non-critical):', draftError);
      }
  
      if (onComplete) {
        onComplete(data.case);
      }
  
      console.log("Case created successfully:", data.case);
    } catch (err) {
      console.error("Error creating case:", err);
      setError(err.message || "Failed to create case. Please try again.");
    } finally {
      setIsCreating(false);
    }
  };

  const handleGoToCaseDetails = () => {
    if (createdCase && createdCase.id) {
      navigate(`/cases/${createdCase.id}`, { state: { case: createdCase } });
    }
  };

  const handleCreateAnother = () => {
    setIsCreated(false);
    setCreatedCase(null);
    setError(null);
    if (onResetToFirstStep) {
      onResetToFirstStep();
    }
  };

  const displayCaseNumber =
    createdCase?.case_number || caseData.caseNumber || "To be assigned";

  // Before Creation - Comprehensive Review UI
  if (!isCreated) {
    return (
      <div className="space-y-6">
        {/* Review Header */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 bg-[#21C1B6] rounded-full flex items-center justify-center">
              <CheckCircle className="w-10 h-10 text-white" />
            </div>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-3">
            Review Case Details
          </h2>
          <p className="text-sm text-gray-600">
            Please review all information before creating the case. You can edit any section by clicking the Edit button.
          </p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        {/* Section 1: Case Details */}
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
          <div className="bg-gray-50 px-6 py-4 border-b border-gray-200 rounded-t-lg flex items-center justify-between">
            <div className="flex items-center">
              <Scale className="w-5 h-5 mr-3 text-[#21C1B6]" />
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Case Details</h3>
                <p className="text-xs text-gray-500">Overview and case information</p>
              </div>
            </div>
            {onEditStep && (
              <button
                onClick={() => handleEditStep(2)}
                className="flex items-center px-3 py-1.5 text-sm text-[#21C1B6] border border-[#21C1B6] rounded hover:bg-[#E6F8F7] transition-colors"
              >
                <Edit className="w-4 h-4 mr-1.5" />
                Edit
              </button>
            )}
          </div>

          <div className="p-6 space-y-6">
            {/* Case Title - Most Important Field */}
            {caseData.caseTitle && (
              <div className="pb-4 border-b border-gray-200">
                <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">
                  Case Title / Name
                </label>
                <p className="text-lg font-semibold text-gray-900">
                  {caseData.caseTitle}
                </p>
              </div>
            )}

            {/* Row 1: Jurisdiction */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">
                  Adjudicating Authority
                </label>
                <p className="text-sm font-medium text-gray-900">
                  {(() => {
                    const jurisdictionDisplay = caseData.jurisdictionName || caseData.jurisdiction;
                    if (!jurisdictionDisplay) {
                      console.log("Jurisdiction data:", {
                        jurisdictionName: caseData.jurisdictionName,
                        jurisdiction: caseData.jurisdiction,
                        jurisdictionId: caseData.jurisdictionId,
                        fullCaseData: caseData
                      });
                    }
                    return jurisdictionDisplay || "Not specified";
                  })()}
                </p>
              </div>
              {caseData.courtLevel && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">
                    Court Level
                  </label>
                  <p className="text-sm font-medium text-gray-900">
                    {caseData.courtLevel}
                  </p>
                </div>
              )}
            </div>

            {/* Court Information */}
            {(caseData.courtName || caseData.benchName) && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
                {caseData.courtName && (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">
                      Court Name
                    </label>
                    <p className="text-sm font-medium text-gray-900">
                      {caseData.courtName}
                    </p>
                  </div>
                )}
                {caseData.benchName && (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">
                      Bench / Division
                    </label>
                    <p className="text-sm font-medium text-gray-900">
                      {caseData.benchName}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Row 2: Case Prefix, Number, Year */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {caseData.casePrefix && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">
                    Case Prefix
                  </label>
                  <p className="text-sm font-medium text-gray-900">
                    {caseData.casePrefix}
                  </p>
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">
                  Case Number
                </label>
                <p className="text-sm font-medium text-gray-900">
                  {caseData.caseNumber || "Not specified"}
                </p>
              </div>
              {caseData.caseYear && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">
                    Year
                  </label>
                  <p className="text-sm font-medium text-gray-900">
                    {caseData.caseYear}
                  </p>
                </div>
              )}
            </div>

            {/* Row 3: Case Type, Subtype, Case Nature */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">
                  Case Type
                </label>
                <p className="text-sm font-medium text-gray-900">
                  {caseData.caseType || "Not specified"}
                </p>
              </div>
              {caseData.subType && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">
                    Subtype
                  </label>
                  <p className="text-sm font-medium text-gray-900">
                    {caseData.subType}
                  </p>
                </div>
              )}
              {caseData.caseNature && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">
                    Case Nature
                  </label>
                  <p className="text-sm font-medium text-gray-900">
                    {caseData.caseNature}
                  </p>
                </div>
              )}
            </div>

            {/* Row 4: Court Name */}
            {caseData.courtName && (
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">
                  Court Name
                </label>
                <p className="text-sm font-medium text-gray-900">
                  {caseData.courtName}
                </p>
              </div>
            )}

            {/* Row 5: Filing Date, Next Hearing */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">
                  Filing Date
                </label>
                <p className="text-sm font-medium text-gray-900">
                  {formatDateDisplay(caseData.filingDate, caseData.displayFilingDate)}
                </p>
              </div>
              {(caseData.nextHearingDate || caseData.displayNextHearingDate) && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">
                    Next Hearing
                  </label>
                  <p className="text-sm font-medium text-gray-900">
                    {formatDateDisplay(caseData.nextHearingDate, caseData.displayNextHearingDate)}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Section 2: Parties Details */}
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
          <div className="bg-gray-50 px-6 py-4 border-b border-gray-200 rounded-t-lg flex items-center justify-between">
            <div className="flex items-center">
              <Users className="w-5 h-5 mr-3 text-[#21C1B6]" />
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Parties Details</h3>
                <p className="text-xs text-gray-500">Petitioners, respondents, and court information</p>
              </div>
            </div>
            {onEditStep && (
              <button
                onClick={() => handleEditStep(3)}
                className="flex items-center px-3 py-1.5 text-sm text-[#21C1B6] border border-[#21C1B6] rounded hover:bg-[#E6F8F7] transition-colors"
              >
                <Edit className="w-4 h-4 mr-1.5" />
                Edit
              </button>
            )}
          </div>

          <div className="p-6 space-y-6">
            {/* Court Information */}
            <div className="border-b border-gray-200 pb-6">
              <div className="flex items-center mb-4">
                <Building2 className="w-4 h-4 mr-2 text-gray-500" />
                <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Court Information</h4>
              </div>
              {/* <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
                {caseData.courtLevel && (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">
                      Court Level
                    </label>
                    <p className="text-sm font-medium text-gray-900">
                      {caseData.courtLevel}
                    </p>
                  </div>
                )}
                {caseData.benchDivision && (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">
                      Bench / Division
                    </label>
                    <p className="text-sm font-medium text-gray-900">
                      {caseData.benchDivision}
                    </p>
                  </div>
                )}

                {caseData.courtRoom && (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">
                      Court Room No.
                    </label>
                    <p className="text-sm font-medium text-gray-900">
                      {caseData.courtRoom}
                    </p>
                  </div>
                )}
              </div> */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
  {caseData.courtLevel && (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">
        Court Level
      </label>
      <p className="text-sm font-medium text-gray-900">
        {caseData.courtLevel}
      </p>
    </div>
  )}
  {caseData.benchDivision && (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">
        Bench / Division
      </label>
      <p className="text-sm font-medium text-gray-900">
        {caseData.benchDivision}
      </p>
    </div>
  )}
  {/* STATE SECTION REMOVED */}
  {caseData.courtRoom && (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">
        Court Room No.
      </label>
      <p className="text-sm font-medium text-gray-900">
        {caseData.courtRoom}
      </p>
    </div>
  )}
</div>
              {caseData.judges && caseData.judges.length > 0 && (
                <div className="mt-4">
                  <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">
                    Presiding Judge(s)
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {caseData.judges.map((judge, index) => (
                      <span
                        key={index}
                        className="inline-flex items-center px-3 py-1 bg-gray-100 text-gray-700 text-sm rounded-full"
                      >
                        {judge}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Petitioners */}
            {caseData.petitioners && caseData.petitioners.length > 0 && (
              <div className="border-b border-gray-200 pb-6">
                <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">
                  ⚖️ Petitioners / Plaintiffs
                </h4>
                <div className="space-y-4">
                  {caseData.petitioners.map((petitioner, index) => (
                    <div key={index} className="bg-gray-50 p-4 rounded-lg">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">
                            Full Name
                          </label>
                          <p className="text-sm font-medium text-gray-900">
                            {petitioner.fullName || "Not specified"}
                          </p>
                        </div>
                        {petitioner.role && (
                          <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">
                              Type
                            </label>
                            <p className="text-sm font-medium text-gray-900">
                              {petitioner.role}
                            </p>
                          </div>
                        )}
                        {petitioner.advocateName && (
                          <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">
                              Advocate Name
                            </label>
                            <p className="text-sm font-medium text-gray-900">
                              {petitioner.advocateName}
                            </p>
                          </div>
                        )}
                        {petitioner.barRegistration && (
                          <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">
                              Bar Registration No.
                            </label>
                            <p className="text-sm font-medium text-gray-900">
                              {petitioner.barRegistration}
                            </p>
                          </div>
                        )}
                        {petitioner.contact && (
                          <div className="md:col-span-2">
                            <label className="block text-xs font-medium text-gray-500 mb-1">
                              Contact Info
                            </label>
                            <p className="text-sm font-medium text-gray-900">
                              {petitioner.contact}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Respondents */}
            {caseData.respondents && caseData.respondents.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">
                  ⚖️ Respondents / Defendants
                </h4>
                <div className="space-y-4">
                  {caseData.respondents.map((respondent, index) => (
                    <div key={index} className="bg-gray-50 p-4 rounded-lg">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">
                            Full Name
                          </label>
                          <p className="text-sm font-medium text-gray-900">
                            {respondent.fullName || "Not specified"}
                          </p>
                        </div>
                        {respondent.role && (
                          <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">
                              Type
                            </label>
                            <p className="text-sm font-medium text-gray-900">
                              {respondent.role}
                            </p>
                          </div>
                        )}
                        {respondent.advocateName && (
                          <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">
                              Advocate Name
                            </label>
                            <p className="text-sm font-medium text-gray-900">
                              {respondent.advocateName}
                            </p>
                          </div>
                        )}
                        {respondent.barRegistration && (
                          <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">
                              Bar Registration No.
                            </label>
                            <p className="text-sm font-medium text-gray-900">
                              {respondent.barRegistration}
                            </p>
                          </div>
                        )}
                        {respondent.contact && (
                          <div className="md:col-span-2">
                            <label className="block text-xs font-medium text-gray-500 mb-1">
                              Contact Info
                            </label>
                            <p className="text-sm font-medium text-gray-900">
                              {respondent.contact}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Section 3: Dates & Documents */}
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
          <div className="bg-gray-50 px-6 py-4 border-b border-gray-200 rounded-t-lg flex items-center justify-between">
            <div className="flex items-center">
              <FolderPlus className="w-5 h-5 mr-3 text-[#21C1B6]" />
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Dates & Documents</h3>
                <p className="text-xs text-gray-500">Document details and uploads</p>
              </div>
            </div>
            {onEditStep && (
              <button
                onClick={() => handleEditStep(4)}
                className="flex items-center px-3 py-1.5 text-sm text-[#21C1B6] border border-[#21C1B6] rounded hover:bg-[#E6F8F7] transition-colors"
              >
                <Edit className="w-4 h-4 mr-1.5" />
                Edit
              </button>
            )}
          </div>

          <div className="p-6 space-y-6">
            {/* Current Case Status */}
            {caseData.currentStatus && (
              <div className="pb-4 border-b border-gray-200">
                <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">
                  Current Case Status
                </label>
                <div className="flex items-center">
                  <span className="w-2 h-2 bg-green-500 rounded-full mr-2"></span>
                  <p className="text-sm font-semibold text-gray-900">
                    {caseData.currentStatus}
                  </p>
                </div>
              </div>
            )}

            {/* Document Type */}
            {caseData.documentType && (
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">
                  Document Type
                </label>
                <p className="text-sm font-medium text-gray-900">
                  {caseData.documentType}
                </p>
              </div>
            )}

            {/* Filed By */}
            {/* {(caseData.filedByPlaintiff || caseData.filedByDefendant) && (
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">
                  Filed By
                </label>
                <div className="flex gap-4">
                  {caseData.filedByPlaintiff && (
                    <span className="inline-flex items-center px-3 py-1 bg-blue-50 text-blue-700 text-sm rounded-full border border-blue-200">
                      Plaintiff
                    </span>
                  )}
                  {caseData.filedByDefendant && (
                    <span className="inline-flex items-center px-3 py-1 bg-red-50 text-red-700 text-sm rounded-full border border-red-200">
                      Defendant
                    </span>
                  )}
                </div>
              </div>
            )} */}
{/* Filed By */}
{caseData.filedBy && (
  <div>
    <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">
      Filed By
    </label>
    <span className="inline-flex items-center px-3 py-1 bg-blue-50 text-blue-700 text-sm rounded-full border border-blue-200">
      {caseData.filedBy}
    </span>
  </div>
)}

{/* OR if you want to keep the existing display with both flags */}
{(caseData.filedByPlaintiff || caseData.filedByDefendant) && (
  <div>
    <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">
      Filed By
    </label>
    <div className="flex gap-4">
      {caseData.filedByPlaintiff && (
        <span className="inline-flex items-center px-3 py-1 bg-blue-50 text-blue-700 text-sm rounded-full border border-blue-200">
          Plaintiff
        </span>
      )}
      {caseData.filedByDefendant && (
        <span className="inline-flex items-center px-3 py-1 bg-red-50 text-red-700 text-sm rounded-full border border-red-200">
          Respondent
        </span>
      )}
    </div>
  </div>
)}
            {/* Document Date */}
            {(caseData.documentDate || caseData.displayDocumentDate) && (
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">
                  Document Date
                </label>
                <p className="text-sm font-medium text-gray-900">
                  {formatDateDisplay(caseData.documentDate, caseData.displayDocumentDate)}
                </p>
              </div>
            )}

            {/* Auto-remind */}
            {caseData.autoRemind && (
              <div className="flex items-center">
                <CheckCircle className="w-5 h-5 mr-2 text-green-600" />
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    Auto-remind enabled
                  </p>
                  <p className="text-xs text-gray-500">
                    You will receive notifications 24 hours before scheduled hearings
                  </p>
                </div>
              </div>
            )}

            {/* Uploaded Files */}
            {caseData.uploadedFiles && caseData.uploadedFiles.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-3 uppercase tracking-wide">
                  Uploaded Documents ({caseData.uploadedFiles.length})
                </label>
                <div className="space-y-2">
                  {caseData.uploadedFiles.map((file, index) => (
                    <div
                      key={index}
                      className="flex items-center p-3 bg-gray-50 rounded-lg border border-gray-200"
                    >
                      <FileText className="w-5 h-5 mr-3 text-gray-400" />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-900">
                          {file.name || `File ${index + 1}`}
                        </p>
                        {file.size && (
                          <p className="text-xs text-gray-500">
                            {(file.size / 1024).toFixed(2)} KB
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Disclaimer Section */}
        <div className="bg-[#E6F8F7] border border-[#21C1B6] border-opacity-30 rounded-xl p-5">
          <div className="mb-4">
            <p className="text-sm text-gray-800">
              <span className="font-semibold text-[#1AA89E]">Disclaimer:</span>{" "}
              <span className="text-gray-700">
                This information is AI-generated and must be reviewed before case creation.
              </span>
            </p>
          </div>
          <div className="flex items-center">
            <input
              type="checkbox"
              id="disclaimer-checkbox"
              checked={disclaimerAccepted}
              onChange={(e) => setDisclaimerAccepted(e.target.checked)}
              className="w-5 h-5 text-[#21C1B6] border-gray-300 rounded focus:ring-[#21C1B6] focus:ring-2 cursor-pointer"
            />
            <label
              htmlFor="disclaimer-checkbox"
              className="ml-3 text-sm font-medium text-gray-800 cursor-pointer"
            >
            Read and Confirm
            </label>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3 pt-4">
          <button
            onClick={onBack}
            disabled={isCreating}
            className="flex-1 px-4 py-3 bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Back
          </button>
          <button
            onClick={handleCreateCase}
            disabled={isCreating || isCreated || !disclaimerAccepted || !canCreateCases}
            className="flex-1 px-4 py-3 bg-[#21C1B6] text-white rounded-md hover:bg-[#1AA89E] transition-colors flex items-center justify-center text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            title={!canCreateCases ? 'You do not have permission to create new cases' : undefined}
          >
            {isCreating ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Creating Case...
              </>
            ) : isCreated ? (
              <>
                <CheckCircle className="w-4 h-4 mr-2" />
                Case Created
              </>
            ) : (
              <>
                <CheckCircle className="w-4 h-4 mr-2" />
                Confirm & Create Case
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

  // Success Screen - Preserved original design
  return (
    <div>
      <div className="flex justify-center mb-6">
        <div className="w-16 h-16 bg-[#9CDFE1] rounded-full flex items-center justify-center">
          <CheckCircle className="w-10 h-10 text-white" />
        </div>
      </div>

      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-3">
          Case Created Successfully!
        </h2>
        <p className="text-sm text-gray-600 mb-2">
          Your case has been created and saved to your dashboard.{" "}
          <strong>{displayCaseNumber}</strong>
        </p>
        <p className="text-sm text-gray-600">
          You're all set to start managing your case with JuriNex.
        </p>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
        <div className="flex items-center mb-4 pb-4 border-b border-gray-200">
          <FolderOpen className="w-5 h-5 mr-2 text-[#9CDFE1]" />
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Case Information</h3>
            <p className="text-xs text-gray-500">
              Key details for your newly created case
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6">
          <div className="space-y-4">
            <div>
              <p className="text-xs text-gray-500 mb-1">Case Title</p>
              <p className="text-sm font-medium text-gray-900">
                {createdCase?.case_title || generatedCaseTitle || caseData.caseTitle || "Case Title"}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Court</p>
              <p className="text-sm font-medium text-gray-900">
                {createdCase?.court_name || caseData.courtName || "Delhi High Court"}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Status</p>
              <p className="text-sm font-medium text-green-600 flex items-center">
                <span className="w-2 h-2 bg-green-500 rounded-full mr-2"></span>
                {createdCase?.status || caseData.currentStatus || "Active"}
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <p className="text-xs text-gray-500 mb-1">Case Number</p>
              <p className="text-sm font-medium text-gray-900">{displayCaseNumber}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Filing Date</p>
              <p className="text-sm font-medium text-gray-900">
                {createdCase?.filing_date || caseData.filingDate
                  ? formatDate(createdCase?.filing_date || caseData.filingDate)
                  : "Not specified"}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Case Type</p>
              <p className="text-sm font-medium text-gray-900">
                {createdCase?.case_type || caseData.caseType || "Criminal"}
              </p>
            </div>
          </div>
        </div>

        <div className="flex gap-3 mt-6 pt-6 border-t border-gray-200">
          <button
            onClick={handleGoToCaseDetails}
            className="flex-1 px-4 py-3 bg-[#9CDFE1] text-white rounded-md hover:bg-[#87D8DB] transition-colors flex items-center justify-center text-sm font-medium"
          >
            <FolderOpen className="w-4 h-4 mr-2" />
            Go to Case Details
          </button>
          <button
            onClick={handleCreateAnother}
            className="flex-1 px-4 py-3 bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors flex items-center justify-center text-sm font-medium"
          >
            <span className="mr-2 text-lg">+</span> Create Another Case
          </button>
        </div>
      </div>

      <div className="bg-gray-50 rounded-lg p-6 mt-6">
        <h4 className="text-center text-base font-semibold text-gray-900 mb-2">
          What's Next?
        </h4>
        <p className="text-center text-sm text-gray-600 mb-6">
          Start managing your case efficiently with our AI-powered tools.
        </p>

        <div className="grid grid-cols-3 gap-6">
          {[
            { icon: Upload, label: "Upload Documents" },
            { icon: Calendar, label: "Schedule Events" },
            { icon: Sparkles, label: "AI Analysis" },
          ].map(({ icon: FeatureIcon, label }) => (
            <div key={label} className="text-center">
              <div className="flex justify-center mb-3">
                <div className="w-12 h-12 bg-white border border-gray-200 rounded-lg flex items-center justify-center shadow-sm">
                  {React.createElement(FeatureIcon, { className: "w-6 h-6 text-[#9CDFE1]" })}
                </div>
              </div>
              <p className="text-sm font-medium text-gray-900">{label}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ReviewStep;
