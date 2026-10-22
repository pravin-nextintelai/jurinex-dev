// import React, { useState, useEffect } from "react";
// import { Scale, Calendar } from "lucide-react";
// import { CONTENT_SERVICE_DIRECT } from '@/config/apiConfig';

// const OverviewStep = ({ caseData, setCaseData }) => {
//   const [caseTypes, setCaseTypes] = useState([]);
//   const [subTypes, setSubTypes] = useState([]);
//   const [courts, setCourts] = useState([]);
//   const [loading, setLoading] = useState(false);
//   const hasConvertedCaseType = React.useRef(false);
//   const hasConvertedCourt = React.useRef(false);

//   const API_BASE_URL = CONTENT_SERVICE_DIRECT;

//   useEffect(() => {
//     fetchCaseTypes();
//     fetchCourts();
//   }, []);

//   useEffect(() => {
//     if (!hasConvertedCaseType.current && caseTypes.length > 0 && caseData.caseType && !isNaN(caseData.caseType)) {
//       console.log('🔄 Converting case type ID to name:', caseData.caseType);
//       const selectedType = caseTypes.find(t => t.id.toString() === caseData.caseType.toString());
//       if (selectedType) {
//         console.log('✅ Found case type:', selectedType.name);
//         hasConvertedCaseType.current = true;
//         setCaseData({
//           ...caseData,
//           caseType: selectedType.name,
//           caseTypeId: selectedType.id.toString()
//         });
//       } else {
//         console.log('❌ Case type not found for ID:', caseData.caseType);
//       }
//     }
//   }, [caseTypes, caseData, setCaseData]);

//   useEffect(() => {
//     if (!hasConvertedCourt.current && courts.length > 0 && caseData.courtName && !isNaN(caseData.courtName)) {
//       console.log('🔄 Converting court ID to name:', caseData.courtName);
//       const selectedCourt = courts.find(c => c.id.toString() === caseData.courtName.toString());
//       if (selectedCourt) {
//         console.log('✅ Found court:', selectedCourt.name);
//         hasConvertedCourt.current = true;
//         setCaseData({
//           ...caseData,
//           courtName: selectedCourt.name,
//           courtId: selectedCourt.id.toString(),
//           courtLevel: selectedCourt.court_level || '',
//           jurisdiction: selectedCourt.jurisdiction || '',
//           state: selectedCourt.state || ''
//         });
//       } else {
//         console.log('❌ Court not found for ID:', caseData.courtName);
//       }
//     }
//   }, [courts, caseData, setCaseData]);

//   useEffect(() => {
//     const typeId = caseData.caseTypeId || caseData.caseType;
//     if (typeId) {
//       fetchSubTypes(typeId);
//     } else {
//       setSubTypes([]);
//       setCaseData({ ...caseData, subType: "", subTypeId: "" });
//     }
//   }, [caseData.caseTypeId, caseData.caseType]);

//   const fetchCaseTypes = async () => {
//     try {
//       setLoading(true);
//       const response = await fetch(`${CONTENT_SERVICE_DIRECT}/case-types`);
//       const data = await response.json();
//       setCaseTypes(data);
//     } catch (error) {
//       console.error("Error fetching case types:", error);
//     } finally {
//       setLoading(false);
//     }
//   };

//   const fetchSubTypes = async (caseTypeId) => {
//     try {
//       setLoading(true);
//       const response = await fetch(
//         `${CONTENT_SERVICE_DIRECT}/case-types/${caseTypeId}/sub-types`
//       );
//       const data = await response.json();
//       setSubTypes(data);
      
//       if (caseData.subType && !isNaN(caseData.subType) && data.length > 0) {
//         const selectedSubType = data.find(st => st.id.toString() === caseData.subType.toString());
//         if (selectedSubType) {
//           setCaseData({
//             ...caseData,
//             subType: selectedSubType.name,
//             subTypeId: selectedSubType.id.toString()
//           });
//         }
//       }
//     } catch (error) {
//       console.error("Error fetching sub-types:", error);
//       setSubTypes([]);
//     } finally {
//       setLoading(false);
//     }
//   };

//   const fetchCourts = async () => {
//     try {
//       const response = await fetch(`${CONTENT_SERVICE_DIRECT}/courts`);
//       const data = await response.json();
//       setCourts(data);
//     } catch (error) {
//       console.error("Error fetching courts:", error);
//     }
//   };

//   const handleDateChange = (e) => {
//     const isoDate = e.target.value;
//     if (isoDate) {
//       const [year, month, day] = isoDate.split("-");
//       const formatted = `${day}/${month}/${year}`;
//       setCaseData({
//         ...caseData,
//         filingDate: isoDate,
//         displayFilingDate: formatted,
//       });
//     }
//   };

//   return (
//     <div>
//       <div className="flex items-start mb-6">
//         <Scale className="w-6 h-6 mr-3 text-gray-700 mt-1" />
//         <div>
//           <h3 className="text-xl font-semibold text-gray-900">Create New Case</h3>
//           <p className="text-sm text-gray-600 mt-1">
//             Let's start with the basic details for your case.
//           </p>
//         </div>
//       </div>

//       <div className="space-y-6">
//         <div>
//           <label className="block text-sm font-medium text-gray-700 mb-2">
//             Case Title / Name<span className="text-red-500">*</span>
//           </label>
//           <input
//             type="text"
//             placeholder="Enter case title or name"
//             value={caseData.caseTitle}
//             onChange={(e) =>
//               setCaseData({ ...caseData, caseTitle: e.target.value })
//             }
//             className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 
//             placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
//           />
//         </div>

//         <div className="grid grid-cols-2 gap-4">
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Case Type<span className="text-red-500">*</span>
//             </label>
//             <select
//               value={caseData.caseTypeId || caseData.caseType}
//               onChange={(e) => {
//                 const selectedType = caseTypes.find(
//                   (t) => t.id.toString() === e.target.value
//                 );
//                 setCaseData({ 
//                   ...caseData, 
//                   caseType: selectedType?.name || "",
//                   caseTypeId: e.target.value,
//                   subType: "",
//                   subTypeId: ""
//                 });
//               }}
//               className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 
//               placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
//               disabled={loading}
//             >
//               <option value="">Select case type...</option>
//               {caseTypes.map((type) => (
//                 <option key={type.id} value={type.id}>
//                   {type.name}
//                 </option>
//               ))}
//             </select>
//           </div>

//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Sub-Type
//             </label>
//             <select
//               value={caseData.subTypeId || caseData.subType}
//               onChange={(e) => {
//                 const selectedSubType = subTypes.find(
//                   (st) => st.id.toString() === e.target.value
//                 );
//                 setCaseData({ 
//                   ...caseData, 
//                   subType: selectedSubType?.name || "",
//                   subTypeId: e.target.value
//                 });
//               }}
//               className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 
//               placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none 
//               disabled:bg-gray-100 disabled:text-gray-400"
//               disabled={(!caseData.caseType && !caseData.caseTypeId) || loading}
//             >
//               <option value="">Select sub-type...</option>
//               {subTypes.map((subType) => (
//                 <option key={subType.id} value={subType.id}>
//                   {subType.name}
//                 </option>
//               ))}
//             </select>
//             {!caseData.caseType && !caseData.caseTypeId && (
//               <p className="text-xs text-gray-500 mt-1">
//                 Available after selecting case type
//               </p>
//             )}
//           </div>
//         </div>

//         <div className="grid grid-cols-2 gap-4">
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Case Number
//             </label>
//             <input
//               type="text"
//               placeholder="Enter case number (if available)"
//               value={caseData.caseNumber}
//               onChange={(e) =>
//                 setCaseData({ ...caseData, caseNumber: e.target.value })
//               }
//               className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 
//               placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
//             />
//             <p className="text-xs text-gray-500 mt-1">Optional for new filings</p>
//           </div>

//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Court Name<span className="text-red-500">*</span>
//             </label>
//             <select
//               value={caseData.courtId || caseData.courtName}
//               onChange={(e) => {
//                 const selectedCourt = courts.find(
//                   (c) => c.id.toString() === e.target.value
//                 );
//                 setCaseData({
//                   ...caseData,
//                   courtName: selectedCourt?.name || "",
//                   courtId: e.target.value,
//                   courtLevel: selectedCourt?.court_level || "",
//                   jurisdiction: selectedCourt?.jurisdiction || "",
//                   state: selectedCourt?.state || "",
//                 });
//               }}
//               className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 
//               placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
//             >
//               <option value="">Select court...</option>
//               {courts.map((court) => (
//                 <option key={court.id} value={court.id}>
//                   {court.name}
//                 </option>
//               ))}
//             </select>
//           </div>
//         </div>

//         <div className="relative">
//           <label className="block text-sm font-medium text-gray-700 mb-2">
//             Filing Date
//           </label>

//           <div className="relative">
//             <input
//               type="text"
//               value={caseData.displayFilingDate || ""}
//               placeholder="dd/mm/yyyy"
//               readOnly
//               className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 
//               placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none pr-10 bg-white pointer-events-none"
//             />
//             <div className="absolute right-2.5 top-2.5 text-gray-400 pointer-events-none">
//               <Calendar className="w-5 h-5" />
//             </div>
//             <input
//               id="filing-date-picker"
//               type="date"
//               value={caseData.filingDate || ""}
//               onChange={handleDateChange}
//               className="absolute top-0 left-0 w-full h-full opacity-0 cursor-pointer"
//               style={{ colorScheme: 'light' }}
//             />
//           </div>
//         </div>
//       </div>

//       <div className="mt-6 pt-4 border-t border-gray-200">
//         <p className="text-sm text-gray-500">
//           All fields marked with * are required
//         </p>
//       </div>
//     </div>
//   );
// };

// export default OverviewStep;


// import React, { useState, useEffect } from "react";
// import { Scale, Calendar } from "lucide-react";

// const OverviewStep = ({ caseData, setCaseData }) => {
//   const [caseTypes, setCaseTypes] = useState([]);
//   const [subTypes, setSubTypes] = useState([]);
//   const [courts, setCourts] = useState([]);
//   const [loading, setLoading] = useState(false);
//   const hasConvertedCaseType = React.useRef(false);
//   const hasConvertedCourt = React.useRef(false);

//   const API_BASE_URL = "http://localhost:5002/api/content";

//   // Jurisdiction options
//   const jurisdictionOptions = [
//     "Supreme Court",
//     "High Court",
//     "District & Subordinate Courts",
//     "Judicial Magistrate First Class (JMFC)",
//     "Specialized Courts",
//     "Tribunals",
//     "Consumer Dispute Redressal Forums",
//     "Government & Quasi-Judicial Authorities",
//     "Regulatory Authorities",
//     "Out-of-court Dispute Resolution",
//   ];

//   // High Court options
//   const highCourts = [
//     "Allahabad",
//     "Andhra Pradesh",
//     "Bombay",
//     "Calcutta",
//     "Chhattisgarh",
//     "Delhi",
//     "Gauhati",
//     "Gujarat",
//     "Himachal Pradesh",
//     "J&K and Ladakh",
//     "Jharkhand",
//     "Karnataka",
//     "Kerala",
//     "Madhya Pradesh",
//     "Madras",
//     "Manipur",
//     "Meghalaya",
//     "Orissa",
//     "Patna",
//     "Punjab & Haryana",
//     "Rajasthan",
//     "Sikkim",
//     "Telangana",
//     "Tripura",
//     "Uttarakhand",
//   ];

//   // Bombay High Court benches
//   const bombayBenches = ["Mumbai", "Panaji", "Aurangabad", "Nagpur", "Kolhapur"];

//   useEffect(() => {
//     fetchCaseTypes();
//     fetchCourts();
//   }, []);

//   // Handle backward compatibility: convert IDs to names if old draft loaded
//   useEffect(() => {
//     if (!hasConvertedCaseType.current && caseTypes.length > 0 && caseData.caseType && !isNaN(caseData.caseType)) {
//       // caseType contains an ID (old draft format), convert to name
//       console.log('🔄 Converting case type ID to name:', caseData.caseType);
//       const selectedType = caseTypes.find(t => t.id.toString() === caseData.caseType.toString());
//       if (selectedType) {
//         console.log('✅ Found case type:', selectedType.name);
//         hasConvertedCaseType.current = true;
//         setCaseData({
//           ...caseData,
//           caseType: selectedType.name,
//           caseTypeId: selectedType.id.toString()
//         });
//       } else {
//         console.log('❌ Case type not found for ID:', caseData.caseType);
//       }
//     }
//   }, [caseTypes, caseData, setCaseData]);

//   useEffect(() => {
//     if (!hasConvertedCourt.current && courts.length > 0 && caseData.courtName && !isNaN(caseData.courtName)) {
//       // courtName contains an ID (old draft format), convert to name
//       console.log('🔄 Converting court ID to name:', caseData.courtName);
//       const selectedCourt = courts.find(c => c.id.toString() === caseData.courtName.toString());
//       if (selectedCourt) {
//         console.log('✅ Found court:', selectedCourt.name);
//         hasConvertedCourt.current = true;
//         setCaseData({
//           ...caseData,
//           courtName: selectedCourt.name,
//           courtId: selectedCourt.id.toString(),
//           courtLevel: selectedCourt.court_level || '',
//           jurisdiction: selectedCourt.jurisdiction || '',
//           state: selectedCourt.state || ''
//         });
//       } else {
//         console.log('❌ Court not found for ID:', caseData.courtName);
//       }
//     }
//   }, [courts, caseData, setCaseData]);

//   useEffect(() => {
//     const typeId = caseData.caseTypeId || caseData.caseType;
//     if (typeId) {
//       fetchSubTypes(typeId);
//     } else {
//       setSubTypes([]);
//       setCaseData({ ...caseData, subType: "", subTypeId: "" });
//     }
//   }, [caseData.caseTypeId, caseData.caseType]);

//   const fetchCaseTypes = async () => {
//     try {
//       setLoading(true);
//       const response = await fetch(`${CONTENT_SERVICE_DIRECT}/case-types`);
//       const data = await response.json();
//       setCaseTypes(data);
//     } catch (error) {
//       console.error("Error fetching case types:", error);
//     } finally {
//       setLoading(false);
//     }
//   };

//   const fetchSubTypes = async (caseTypeId) => {
//     try {
//       setLoading(true);
//       const response = await fetch(
//         `${CONTENT_SERVICE_DIRECT}/case-types/${caseTypeId}/sub-types`
//       );
//       const data = await response.json();
//       setSubTypes(data);
      
//       // Handle backward compatibility for subType
//       if (caseData.subType && !isNaN(caseData.subType) && data.length > 0) {
//         const selectedSubType = data.find(st => st.id.toString() === caseData.subType.toString());
//         if (selectedSubType) {
//           setCaseData({
//             ...caseData,
//             subType: selectedSubType.name,
//             subTypeId: selectedSubType.id.toString()
//           });
//         }
//       }
//     } catch (error) {
//       console.error("Error fetching sub-types:", error);
//       setSubTypes([]);
//     } finally {
//       setLoading(false);
//     }
//   };

//   const fetchCourts = async () => {
//     try {
//       const response = await fetch(`${CONTENT_SERVICE_DIRECT}/courts`);
//       const data = await response.json();
//       setCourts(data);
//     } catch (error) {
//       console.error("Error fetching courts:", error);
//     }
//   };

//   const handleDateChange = (e) => {
//     const isoDate = e.target.value;
//     if (isoDate) {
//       const [year, month, day] = isoDate.split("-");
//       const formatted = `${day}/${month}/${year}`;
//       setCaseData({
//         ...caseData,
//         filingDate: isoDate,
//         displayFilingDate: formatted,
//       });
//     }
//   };

//   const handleNextHearingDateChange = (e) => {
//     const isoDate = e.target.value;
//     if (isoDate) {
//       const [year, month, day] = isoDate.split("-");
//       const formatted = `${day}/${month}/${year}`;
//       setCaseData({
//         ...caseData,
//         nextHearingDate: isoDate,
//         displayNextHearingDate: formatted,
//       });
//     }
//   };

//   // Handle jurisdiction change
//   const handleJurisdictionChange = (e) => {
//     const selectedJurisdiction = e.target.value;
//     setCaseData({
//       ...caseData,
//       jurisdiction: selectedJurisdiction,
//       // Clear dependent fields when jurisdiction changes
//       highCourt: selectedJurisdiction === "High Court" ? caseData.highCourt : "",
//       bench: "",
//     });
//   };

//   // Handle High Court change
//   const handleHighCourtChange = (e) => {
//     const selectedHighCourt = e.target.value;
//     setCaseData({
//       ...caseData,
//       highCourt: selectedHighCourt,
//       // Clear bench when high court changes away from Bombay
//       bench: "",
//     });
//   };

//   return (
//     <div>
//       {/* Header */}
//       <div className="flex items-start mb-6">
//         <Scale className="w-6 h-6 mr-3 text-gray-700 mt-1" />
//         <div>
//           <h3 className="text-xl font-semibold text-gray-900">Create New Case</h3>
//           <p className="text-sm text-gray-600 mt-1">
//             Let's start with the basic details for your case.
//           </p>
//         </div>
//       </div>

//       {/* Form Fields */}
//       <div className="space-y-6">
//         {/* Jurisdiction */}
//         <div>
//           <label className="block text-sm font-medium text-gray-700 mb-2">
//             Adjudicating Authority<span className="text-red-500">*</span>
//           </label>
//           <select
//             value={caseData.jurisdiction || ""}
//             onChange={handleJurisdictionChange}
//             className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 
//             placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
//           >
//             <option value="">Select jurisdiction...</option>
//             {jurisdictionOptions.map((jurisdiction) => (
//               <option key={jurisdiction} value={jurisdiction}>
//                 {jurisdiction}
//               </option>
//             ))}
//           </select>
//         </div>

//         {/* High Court dropdown (conditional) */}
//         {caseData.jurisdiction === "High Court" && (
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               High Court<span className="text-red-500">*</span>
//             </label>
//             <select
//               value={caseData.highCourt || ""}
//               onChange={handleHighCourtChange}
//               className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 
//               placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
//             >
//               <option value="">Select high court...</option>
//               {highCourts.map((highCourt) => (
//                 <option key={highCourt} value={highCourt}>
//                   {highCourt} High Court
//                 </option>
//               ))}
//             </select>
//           </div>
//         )}

//         {/* Bench dropdown (conditional - only for Bombay High Court) */}
//         {caseData.jurisdiction === "High Court" && caseData.highCourt === "Bombay" && (
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Bench<span className="text-red-500">*</span>
//             </label>
//             <select
//               value={caseData.bench || ""}
//               onChange={(e) =>
//                 setCaseData({ ...caseData, bench: e.target.value })
//               }
//               className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 
//               placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
//             >
//               <option value="">Select bench...</option>
//               {bombayBenches.map((bench) => (
//                 <option key={bench} value={bench}>
//                   {bench}
//                 </option>
//               ))}
//             </select>
//           </div>
//         )}

//         {/* Case Prefix */}
//         <div>
//           <label className="block text-sm font-medium text-gray-700 mb-2">
//             Case Prefix
//           </label>
//           <input
//             type="text"
//             placeholder="Enter case prefix..."
//             value={caseData.casePrefix || ""}
//             onChange={(e) =>
//               setCaseData({ ...caseData, casePrefix: e.target.value })
//             }
//             className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 
//             placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
//           />
//         </div>

//         {/* Case Number and Year (formerly Sub-Type) */}
//         <div className="grid grid-cols-2 gap-4">
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Case Number<span className="text-red-500">*</span>
//             </label>
//             <input
//               type="text"
//               placeholder="Enter case number..."
//               value={caseData.caseNumber}
//               onChange={(e) =>
//                 setCaseData({ ...caseData, caseNumber: e.target.value })
//               }
//               required
//               className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 
//               placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
//             />
//           </div>
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Year<span className="text-red-500">*</span>
//             </label>
//             <input
//               type="text"
//               placeholder="YYYY"
//               maxLength="4"
//               value={caseData.caseYear || ""}
//               onChange={(e) => {
//                 const value = e.target.value.replace(/\D/g, '').slice(0, 4);
//                 setCaseData({ ...caseData, caseYear: value });
//               }}
//               required
//               pattern="\d{4}"
//               className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 
//               placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
//             />
//           </div>
//         </div>

//         {/* Case Type */}
//         <div>
//           <label className="block text-sm font-medium text-gray-700 mb-2">
//             Case Type
//           </label>
//           <select
//             value={caseData.caseType || ""}
//             onChange={(e) => {
//               const selectedType = e.target.value;
//               setCaseData({ 
//                 ...caseData, 
//                 caseType: selectedType,
//                 // Clear subtype and caseNature when case type changes
//                 subType: "",
//                 caseNature: ""
//                 // Note: casePrefix is NOT affected by caseType changes
//               });
//             }}
//             className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 
//             placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
//           >
//             <option value="">Select case type...</option>
//             <option value="I. Civil Jurisdiction">I. Civil Jurisdiction</option>
//             <option value="II. Criminal Jurisdiction (Magistrate / Sessions / High Court)">II. Criminal Jurisdiction (Magistrate / Sessions / High Court)</option>
//             <option value="III. Constitutional / Writ Jurisdiction (High Court / Supreme Court)">III. Constitutional / Writ Jurisdiction (High Court / Supreme Court)</option>
//             <option value="IV. Supreme Court–Specific Matters">IV. Supreme Court–Specific Matters</option>
//             <option value="V. Arbitration & ADR (Courts / Commercial Courts)">V. Arbitration & ADR (Courts / Commercial Courts)</option>
//             <option value="VI. Family Court & Personal Law">VI. Family Court & Personal Law</option>
//             <option value="VII. Commercial, Company & Insolvency">VII. Commercial, Company & Insolvency</option>
//             <option value="VIII. Co-operative Courts & Similar Fora">VIII. Co-operative Courts & Similar Fora</option>
//             <option value="IX. Tribunals – Financial & Banking">IX. Tribunals – Financial & Banking</option>
//             <option value="X. Taxation & Revenue">X. Taxation & Revenue</option>
//             <option value="XI. Consumer & Service Law">XI. Consumer & Service Law</option>
//             <option value="XII. Labour & Employment">XII. Labour & Employment</option>
//             <option value="XIII. Special Statutes & Special Courts">XIII. Special Statutes & Special Courts</option>
//             <option value="XIV. Election & Public Law">XIV. Election & Public Law</option>
//             <option value="XV. Trusts, Charity & Administration">XV. Trusts, Charity & Administration</option>
//             <option value="XVI. Contempt & Miscellaneous">XVI. Contempt & Miscellaneous</option>
//           </select>
//         </div>

//         {/* Subtype and Case Nature (conditional - only for Civil Jurisdiction) */}
//         {caseData.caseType === "I. Civil Jurisdiction" && (
//           <div className="grid grid-cols-2 gap-4">
//             <div>
//               <label className="block text-sm font-medium text-gray-700 mb-2">
//                 Subtype
//               </label>
//               <select
//                 value={caseData.subType || ""}
//                 onChange={(e) =>
//                   setCaseData({ ...caseData, subType: e.target.value })
//                 }
//                 className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 
//                 placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
//               >
//                 <option value="">Select subtype...</option>
//                 <option value="Civil Suit">Civil Suit</option>
//                 <option value="Summary Suit">Summary Suit</option>
//                 <option value="Commercial Suit">Commercial Suit</option>
//                 <option value="Money Suit">Money Suit</option>
//                 <option value="Declaratory Suit">Declaratory Suit</option>
//                 <option value="Partition Suit">Partition Suit</option>
//                 <option value="Suit for Specific Performance">Suit for Specific Performance</option>
//                 <option value="Suit for Injunction">Suit for Injunction</option>
//                 <option value="Suit for Possession">Suit for Possession</option>
//                 <option value="Eviction Suit">Eviction Suit</option>
//                 <option value="Title Suit">Title Suit</option>
//                 <option value="Post-Decree">Post-Decree</option>
//               </select>
//             </div>
//             <div>
//               <label 
//                 htmlFor="caseNature"
//                 className="block text-sm font-medium text-gray-700 mb-2"
//               >
//                 Case Nature
//               </label>
//               <select
//                 id="caseNature"
//                 value={caseData.caseNature || ""}
//                 onChange={(e) =>
//                   setCaseData({ ...caseData, caseNature: e.target.value })
//                 }
//                 className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 
//                 placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
//                 aria-label="Case Nature"
//               >
//                 <option value="">Select case nature...</option>
                
//                 <optgroup label="Basic Categories">
//                   <option value="Civil">Civil</option>
//                   <option value="Criminal">Criminal</option>
//                   <option value="Constitutional / Writ">Constitutional / Writ</option>
//                   <option value="Arbitration">Arbitration</option>
//                   <option value="Commercial">Commercial</option>
//                   <option value="Family / Matrimonial">Family / Matrimonial</option>
//                   <option value="Service / Employment">Service / Employment</option>
//                   <option value="Cooperative">Cooperative</option>
//                   <option value="Appellate">Appellate</option>
//                   <option value="Revisional">Revisional</option>
//                   <option value="Review">Review</option>
//                 </optgroup>

//                 <optgroup label="Corporate & Financial">
//                   <option value="Corporate">Corporate</option>
//                   <option value="Insolvency / Bankruptcy">Insolvency / Bankruptcy</option>
//                   <option value="Banking & Finance">Banking & Finance</option>
//                   <option value="Securities / Capital Markets">Securities / Capital Markets</option>
//                   <option value="Insurance">Insurance</option>
//                 </optgroup>

//                 <optgroup label="Property & Tax">
//                   <option value="Property / Real Estate">Property / Real Estate</option>
//                   <option value="Land Acquisition">Land Acquisition</option>
//                   <option value="Revenue">Revenue</option>
//                   <option value="Tenancy">Tenancy</option>
//                   <option value="Housing / Society">Housing / Society</option>
//                   <option value="Taxation">Taxation</option>
//                   <option value="Customs & Excise">Customs & Excise</option>
//                   <option value="GST / Indirect Tax">GST / Indirect Tax</option>
//                 </optgroup>

//                 <optgroup label="Regulatory & Social">
//                   <option value="Electricity / Energy">Electricity / Energy</option>
//                   <option value="Telecom">Telecom</option>
//                   <option value="Competition / Antitrust">Competition / Antitrust</option>
//                   <option value="Consumer Protection">Consumer Protection</option>
//                   <option value="Labour / Industrial">Labour / Industrial</option>
//                   <option value="Social Welfare">Social Welfare</option>
//                   <option value="Education">Education</option>
//                   <option value="Pension / Retirement">Pension / Retirement</option>
//                 </optgroup>

//                 <optgroup label="Economic Offences">
//                   <option value="Economic Offences">Economic Offences</option>
//                   <option value="NDPS">NDPS</option>
//                   <option value="PMLA">PMLA</option>
//                   <option value="FEMA">FEMA</option>
//                   <option value="White-Collar Crime">White-Collar Crime</option>
//                 </optgroup>

//                 <optgroup label="Public Law">
//                   <option value="Public Law">Public Law</option>
//                   <option value="Administrative Law">Administrative Law</option>
//                   <option value="Election Law">Election Law</option>
//                   <option value="Municipal / Local Authority">Municipal / Local Authority</option>
//                   <option value="Public Trust / Charity">Public Trust / Charity</option>
//                 </optgroup>

//                 <optgroup label="ADR & Other">
//                   <option value="Alternative Dispute Resolution (ADR)">Alternative Dispute Resolution (ADR)</option>
//                   <option value="Mediation">Mediation</option>
//                   <option value="Conciliation">Conciliation</option>
//                   <option value="Succession / Inheritance">Succession / Inheritance</option>
//                   <option value="Probate / Letters of Administration">Probate / Letters of Administration</option>
//                   <option value="Guardianship / Adoption">Guardianship / Adoption</option>
//                   <option value="Contempt">Contempt</option>
//                   <option value="Quasi-Judicial">Quasi-Judicial</option>
//                   <option value="Statutory Reference">Statutory Reference</option>
//                   <option value="Transferred / Remanded Matter">Transferred / Remanded Matter</option>
//                   <option value="Other / Miscellaneous">Other / Miscellaneous</option>
//                 </optgroup>
//               </select>
//             </div>
//           </div>
//         )}

//         {/* Filing Date (formerly Court Name) */}
//         <div className="relative">
//           <label className="block text-sm font-medium text-gray-700 mb-2">
//             Filing Date
//           </label>
//           <div className="relative">
//             <input
//               type="text"
//               value={caseData.displayFilingDate || ""}
//               placeholder="dd/mm/yyyy"
//               readOnly
//               className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 
//               placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none pr-10 bg-white pointer-events-none"
//             />
//             {/* Calendar Icon */}
//             <div className="absolute right-2.5 top-2.5 text-gray-400 pointer-events-none">
//               <Calendar className="w-5 h-5" />
//             </div>
//             {/* Actual Date Input - Positioned on top */}
//             <input
//               id="filing-date-picker"
//               type="date"
//               value={caseData.filingDate || ""}
//               onChange={handleDateChange}
//               className="absolute top-0 left-0 w-full h-full opacity-0 cursor-pointer"
//               style={{ colorScheme: 'light' }}
//             />
//           </div>
//         </div>

//         {/* Next Hearing (formerly Filing Date) */}
//         <div className="relative">
//           <label className="block text-sm font-medium text-gray-700 mb-2">
//             Next Hearing
//           </label>
//           <div className="relative">
//             <input
//               type="text"
//               value={caseData.displayNextHearingDate || ""}
//               placeholder="dd/mm/yyyy"
//               readOnly
//               className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 
//               placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none pr-10 bg-white pointer-events-none"
//             />
//             {/* Calendar Icon */}
//             <div className="absolute right-2.5 top-2.5 text-gray-400 pointer-events-none">
//               <Calendar className="w-5 h-5" />
//             </div>
//             {/* Actual Date Input - Positioned on top */}
//             <input
//               id="next-hearing-date-picker"
//               type="date"
//               value={caseData.nextHearingDate || ""}
//               onChange={handleNextHearingDateChange}
//               className="absolute top-0 left-0 w-full h-full opacity-0 cursor-pointer"
//               style={{ colorScheme: 'light' }}
//             />
//           </div>
//         </div>
//       </div>

//       {/* Footer note */}
//       <div className="mt-6 pt-4 border-t border-gray-200">
//         <p className="text-sm text-gray-500">
//           All fields marked with * are required
//         </p>
//       </div>
//     </div>
//   );
// };

// export default OverviewStep;



import React, { useState, useEffect } from "react";
import { Scale, Calendar } from "lucide-react";
import SearchableSelect from "@/shared/components/SearchableSelect";
import { CONTENT_SERVICE_DIRECT } from "@/config/apiConfig";

const OverviewStep = ({ caseData, setCaseData }) => {
  const [caseTypes, setCaseTypes] = useState([]);
  const [subTypes, setSubTypes] = useState([]);
  const [courts, setCourts] = useState([]);
  const [jurisdictions, setJurisdictions] = useState([]);
  const [filteredCourts, setFilteredCourts] = useState([]);
  const [benches, setBenches] = useState([]);
  const [loading, setLoading] = useState(false);
  const hasConvertedCaseType = React.useRef(false);
  const hasConvertedCourt = React.useRef(false);

  useEffect(() => {
    fetchCaseTypes();
    fetchJurisdictions();
  }, []);

  // Handle backward compatibility: convert IDs to names if old draft loaded
  useEffect(() => {
    if (!hasConvertedCaseType.current && caseTypes.length > 0 && caseData.caseType && !isNaN(caseData.caseType)) {
      console.log('🔄 Converting case type ID to name:', caseData.caseType);
      const selectedType = caseTypes.find(t => t.id.toString() === caseData.caseType.toString());
      if (selectedType) {
        console.log('✅ Found case type:', selectedType.name);
        hasConvertedCaseType.current = true;
        setCaseData({
          ...caseData,
          caseType: selectedType.name,
          caseTypeId: selectedType.id.toString()
        });
      } else {
        console.log('❌ Case type not found for ID:', caseData.caseType);
      }
    }
  }, [caseTypes, caseData, setCaseData]);

  useEffect(() => {
    if (!hasConvertedCourt.current && courts.length > 0 && caseData.courtName && !isNaN(caseData.courtName)) {
      console.log('🔄 Converting court ID to name:', caseData.courtName);
      const selectedCourt = courts.find(c => c.id.toString() === caseData.courtName.toString());
      if (selectedCourt) {
        console.log('✅ Found court:', selectedCourt.name);
        hasConvertedCourt.current = true;
        setCaseData({
          ...caseData,
          courtName: selectedCourt.name,
          courtId: selectedCourt.id.toString(),
          courtLevel: selectedCourt.court_level || '',
          jurisdiction: selectedCourt.jurisdiction || '',
          state: selectedCourt.state || ''
        });
      } else {
        console.log('❌ Court not found for ID:', caseData.courtName);
      }
    }
  }, [courts, caseData, setCaseData]);

  useEffect(() => {
    const typeId = caseData.caseTypeId;
    if (typeId) {
      fetchSubTypes(typeId);
    } else {
      setSubTypes([]);
      setCaseData({ ...caseData, subType: "", subTypeId: "" });
    }
  }, [caseData.caseTypeId]);

  // Populate jurisdictionName from jurisdictionId when jurisdictions are loaded
  useEffect(() => {
    if (caseData.jurisdictionId && jurisdictions.length > 0 && !caseData.jurisdictionName) {
      const jurisdiction = jurisdictions.find(j => j.id.toString() === caseData.jurisdictionId.toString());
      if (jurisdiction) {
        const jurisdictionName = jurisdiction.jurisdiction_name || jurisdiction.name || "";
        setCaseData(prevData => ({
          ...prevData,
          jurisdictionName: jurisdictionName,
          jurisdiction: jurisdictionName, // Also set for backward compatibility
        }));
      }
    }
  }, [jurisdictions, caseData.jurisdictionId, caseData.jurisdictionName]);

  // Fetch courts when jurisdiction changes
  useEffect(() => {
    if (caseData.jurisdictionId) {
      fetchCourtsByJurisdiction(caseData.jurisdictionId);
    } else {
      setFilteredCourts([]);
      setBenches([]);
    }
  }, [caseData.jurisdictionId]);

  // Fetch benches when court changes
  useEffect(() => {
    if (caseData.courtId) {
      fetchBenchesByCourt(caseData.courtId);
    } else {
      setBenches([]);
    }
  }, [caseData.courtId]);

  // Handle caseTypeId when set from auto-fill (to fetch subTypes)
  useEffect(() => {
    if (caseData.caseTypeId && caseTypes.length > 0) {
      const foundType = caseTypes.find(t => t.id.toString() === caseData.caseTypeId.toString());
      if (foundType && !caseData.caseType) {
        // Update caseType name if only ID was set
        setCaseData(prev => ({
          ...prev,
          caseType: foundType.name
        }));
      }
      // Fetch subTypes if not already fetched
      if (subTypes.length === 0) {
        fetchSubTypes(caseData.caseTypeId);
      }
    }
  }, [caseData.caseTypeId, caseTypes]);

  // Handle jurisdictionId when set from auto-fill (to fetch courts)
  useEffect(() => {
    if (caseData.jurisdictionId && jurisdictions.length > 0) {
      const foundJurisdiction = jurisdictions.find(j => j.id.toString() === caseData.jurisdictionId.toString());
      if (foundJurisdiction && !caseData.jurisdictionName) {
        // Update jurisdiction name if only ID was set
        setCaseData(prev => ({
          ...prev,
          jurisdictionName: foundJurisdiction.jurisdiction_name || foundJurisdiction.name || '',
          jurisdiction: foundJurisdiction.jurisdiction_name || foundJurisdiction.name || ''
        }));
      }
      // Fetch courts if not already fetched
      if (filteredCourts.length === 0) {
        fetchCourtsByJurisdiction(caseData.jurisdictionId);
      }
    }
  }, [caseData.jurisdictionId, jurisdictions]);

  // Handle courtId when set from auto-fill (to fetch benches)
  useEffect(() => {
    if (caseData.courtId && filteredCourts.length > 0) {
      const foundCourt = filteredCourts.find(c => c.id.toString() === caseData.courtId.toString());
      if (foundCourt && !caseData.courtName) {
        // Update court name if only ID was set
        setCaseData(prev => ({
          ...prev,
          courtName: foundCourt.court_name || foundCourt.name || '',
          courtLevel: foundCourt.court_level || prev.courtLevel || ''
        }));
      }
      // Fetch benches if not already fetched
      if (benches.length === 0) {
        fetchBenchesByCourt(caseData.courtId);
      }
    }
  }, [caseData.courtId, filteredCourts]);

  // Handle subTypeId when set from auto-fill
  useEffect(() => {
    if (caseData.subTypeId && subTypes.length > 0) {
      const foundSubType = subTypes.find(st => st.id.toString() === caseData.subTypeId.toString());
      if (foundSubType && !caseData.subType) {
        // Update subType name if only ID was set
        setCaseData(prev => ({
          ...prev,
          subType: foundSubType.name
        }));
      }
    }
  }, [caseData.subTypeId, subTypes]);

  // Format dates when set from auto-fill
  useEffect(() => {
    if (caseData.filingDate && !caseData.displayFilingDate) {
      const [year, month, day] = caseData.filingDate.split('-');
      if (year && month && day) {
        const formatted = `${day}/${month}/${year}`;
        setCaseData(prev => ({
          ...prev,
          displayFilingDate: formatted
        }));
      }
    }
  }, [caseData.filingDate, caseData.displayFilingDate]);

  useEffect(() => {
    if (caseData.nextHearingDate && !caseData.displayNextHearingDate) {
      const [year, month, day] = caseData.nextHearingDate.split('-');
      if (year && month && day) {
        const formatted = `${day}/${month}/${year}`;
        setCaseData(prev => ({
          ...prev,
          displayNextHearingDate: formatted
        }));
      }
    }
  }, [caseData.nextHearingDate, caseData.displayNextHearingDate]);

  const fetchJurisdictions = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${CONTENT_SERVICE_DIRECT}/jurisdictions`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      setJurisdictions(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Error fetching jurisdictions:", error);
      setJurisdictions([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchCourtsByJurisdiction = async (jurisdictionId) => {
    try {
      setLoading(true);
      const response = await fetch(`${CONTENT_SERVICE_DIRECT}/jurisdictions/${jurisdictionId}/courts`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      setFilteredCourts(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Error fetching courts by jurisdiction:", error);
      setFilteredCourts([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchBenchesByCourt = async (courtId) => {
    try {
      setLoading(true);
      const response = await fetch(`${CONTENT_SERVICE_DIRECT}/courts/${courtId}/benches`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      setBenches(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Error fetching benches by court:", error);
      setBenches([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchCaseTypes = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${CONTENT_SERVICE_DIRECT}/case-types`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      setCaseTypes(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Error fetching case types:", error);
      setCaseTypes([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchSubTypes = async (caseTypeId) => {
    try {
      setLoading(true);
      const response = await fetch(
        `${CONTENT_SERVICE_DIRECT}/case-types/${caseTypeId}/sub-types`
      );
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      const subTypesArray = Array.isArray(data) ? data : [];
      setSubTypes(subTypesArray);
      
      // Handle backward compatibility for subType
      if (caseData.subType && !isNaN(caseData.subType) && subTypesArray.length > 0) {
        const selectedSubType = subTypesArray.find(st => st.id.toString() === caseData.subType.toString());
        if (selectedSubType) {
          setCaseData({
            ...caseData,
            subType: selectedSubType.name,
            subTypeId: selectedSubType.id.toString()
          });
        }
      }
    } catch (error) {
      console.error("Error fetching sub-types:", error);
      setSubTypes([]);
    } finally {
      setLoading(false);
    }
  };

  // Removed fetchCourts - courts are now fetched by jurisdiction via fetchCourtsByJurisdiction
  // const fetchCourts = async () => {
  //   try {
  //     const response = await fetch(`${CONTENT_SERVICE_DIRECT}/courts`);
  //     const data = await response.json();
  //     setCourts(data);
  //   } catch (error) {
  //     console.error("Error fetching courts:", error);
  //   }
  // };

  const handleDateChange = (e) => {
    const isoDate = e.target.value;
    if (isoDate) {
      const [year, month, day] = isoDate.split("-");
      const formatted = `${day}/${month}/${year}`;
      setCaseData({
        ...caseData,
        filingDate: isoDate,
        displayFilingDate: formatted,
      });
    }
  };

  const handleNextHearingDateChange = (e) => {
    const isoDate = e.target.value;
    if (isoDate) {
      const [year, month, day] = isoDate.split("-");
      const formatted = `${day}/${month}/${year}`;
      setCaseData({
        ...caseData,
        nextHearingDate: isoDate,
        displayNextHearingDate: formatted,
      });
    }
  };

  // Handle jurisdiction change (Adjudicating Authority) - Step 1 in dependency chain
  const handleJurisdictionChange = (e) => {
    const selectedJurisdictionId = e.target.value;
    const selectedJurisdiction = jurisdictions.find(j => j.id.toString() === selectedJurisdictionId);
    
    const jurisdictionName = selectedJurisdiction 
      ? (selectedJurisdiction.jurisdiction_name || selectedJurisdiction.name || "")
      : "";
    
    console.log("Selected Adjudicating Authority (Jurisdiction):", {
      id: selectedJurisdictionId,
      jurisdiction: selectedJurisdiction,
      jurisdictionName: jurisdictionName
    });
    
    setCaseData({
      ...caseData,
      jurisdictionId: selectedJurisdictionId,
      jurisdictionName: jurisdictionName,
      jurisdiction: jurisdictionName, // Also set jurisdiction for backward compatibility
      // Clear ALL dependent fields when jurisdiction changes (strict dependency chain)
      courtId: "",
      courtName: "",
      courtLevel: "",
      benchId: "",
      benchName: "",
      benchDivision: "",
      // Note: casePrefix is INDEPENDENT - don't clear it when jurisdiction changes
      // caseNumber and caseYear may depend on bench, but we'll keep them for now
    });
  };

  // Handle Court change - Step 2 in dependency chain (depends on Adjudicating Authority)
  const handleCourtChange = (e) => {
    const selectedCourtId = e.target.value;
    const selectedCourt = filteredCourts.find(c => c.id.toString() === selectedCourtId);
    
    setCaseData({
      ...caseData,
      courtId: selectedCourtId,
      courtName: selectedCourt ? selectedCourt.court_name : "",
      courtLevel: selectedCourt ? selectedCourt.court_level : null,
      // Clear dependent fields when court changes (strict dependency chain)
      benchId: "",
      benchName: "",
      benchDivision: "",
      // Note: casePrefix is INDEPENDENT - don't clear it when court changes
      // caseNumber and caseYear may depend on bench, but we'll keep them for now
    });
  };

  // Handle Bench change - Step 3 in dependency chain (depends on Court)
  const handleBenchChange = (e) => {
    const selectedBenchId = e.target.value;
    const selectedBench = benches.find(b => b.id.toString() === selectedBenchId);
    
    setCaseData({
      ...caseData,
      benchId: selectedBenchId,
      benchName: selectedBench ? selectedBench.bench_name : "",
      benchDivision: selectedBench ? selectedBench.bench_name : "", // Use bench name as division
    });
    // After bench selection, Case Prefix, Case Number, and Case Year fields become available
  };

  return (
    <div>
      <style>{`
        .jurisdiction-select,
        .jurisdiction-select option {
          color: #000000 !important;
          background-color: #ffffff !important;
        }
        .jurisdiction-select option {
          color: #000000 !important;
          background-color: #ffffff !important;
        }
        .jurisdiction-select option[value=""] {
          color: #6B7280 !important;
        }
      `}</style>
      {/* Header */}
      <div className="flex items-start mb-6">
        <Scale className="w-6 h-6 mr-3 text-gray-700 mt-1" />
        <div>
          <h3 className="text-xl font-semibold text-gray-900">Create New Case</h3>
          <p className="text-sm text-gray-600 mt-1">
            Let's start with the basic details for your case.
          </p>
        </div>
      </div>

      {/* Form Fields - Strict Dependency-Based Flow */}
      <div className="space-y-6">
        {/* Step 1: Adjudicating Authority (Jurisdiction) - First field in dependency chain */}
        <div>
          <SearchableSelect
            label="Adjudicating Authority"
            required
            options={jurisdictions}
            value={caseData.jurisdictionId || ""}
            onChange={(value) => {
              const selectedJurisdiction = jurisdictions.find(j => j.id.toString() === value.toString());
              handleJurisdictionChange({ target: { value: value.toString() } });
            }}
            placeholder="Select adjudicating authority..."
            disabled={loading}
            loading={loading}
            getOptionLabel={(option) => option.jurisdiction_name || option.name || `Jurisdiction ${option.id}`}
            getOptionValue={(option) => option.id}
            isAutoFilled={caseData.autoFilledFields?.includes('jurisdictionId')}
          />
          {!loading && jurisdictions.length === 0 && (
            <p className="text-xs text-amber-600 mt-1">No jurisdictions available. Please check backend connection.</p>
          )}
        </div>

        {/* Step 2: Court - Shows only when Adjudicating Authority is selected */}
        {caseData.jurisdictionId && (
          <SearchableSelect
            label="Court"
            required
            options={filteredCourts}
            value={caseData.courtId || ""}
            onChange={(value) => {
              handleCourtChange({ target: { value: value.toString() } });
            }}
            placeholder={loading ? "Loading courts..." : filteredCourts.length === 0 ? "No courts available" : "Select court..."}
            disabled={loading || filteredCourts.length === 0}
            loading={loading}
            getOptionLabel={(option) => option.court_name}
            getOptionValue={(option) => option.id}
            isAutoFilled={caseData.autoFilledFields?.includes('courtId')}
          />
        )}

        {/* Step 3: Bench - Shows only when Court is selected */}
        {caseData.courtId && benches.length > 0 && (
          <SearchableSelect
            label="Bench"
            required
            options={benches}
            value={caseData.benchId || ""}
            onChange={(value) => {
              handleBenchChange({ target: { value: value.toString() } });
            }}
            placeholder={loading ? "Loading benches..." : "Select bench..."}
            disabled={loading}
            loading={loading}
            getOptionLabel={(option) => `${option.bench_name}${option.is_principal ? " (Principal Bench)" : ""}`}
            getOptionValue={(option) => option.id}
            isAutoFilled={caseData.autoFilledFields?.includes('benchId')}
          />
        )}

        {/* Case Prefix - INDEPENDENT field (not dependent on bench) */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Case Prefix
          </label>
          <input
            type="text"
            placeholder="Enter case prefix..."
            value={caseData.casePrefix || ""}
            onChange={(e) =>
              setCaseData({ ...caseData, casePrefix: e.target.value })
            }
            className={`w-full px-3 py-2 border rounded-md text-sm text-gray-700 
            placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none
            ${caseData.autoFilledFields?.includes('casePrefix') ? 'border-[#21C1B6] bg-[#E0F7F6] ring-2 ring-[#21C1B6] ring-opacity-30' : 'border-gray-300'}`}
          />
        </div>

        {/* Step 4: Case Details - Show only when Bench is selected */}
        {caseData.benchId && (
          <>
            {/* Case Number and Year */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Case Number<span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="Enter case number..."
                  value={caseData.caseNumber}
                  onChange={(e) =>
                    setCaseData({ ...caseData, caseNumber: e.target.value })
                  }
                  required
                  className={`w-full px-3 py-2 border rounded-md text-sm text-gray-700 
                  placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none
                  ${caseData.autoFilledFields?.includes('caseNumber') ? 'border-[#21C1B6] bg-[#E0F7F6] ring-2 ring-[#21C1B6] ring-opacity-30' : 'border-gray-300'}`}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Year<span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="YYYY"
                  maxLength="4"
                  value={caseData.caseYear || ""}
                  onChange={(e) => {
                    const value = e.target.value.replace(/\D/g, '').slice(0, 4);
                    setCaseData({ ...caseData, caseYear: value });
                  }}
                  required
                  pattern="\d{4}"
                  className={`w-full px-3 py-2 border rounded-md text-sm text-gray-700 
                  placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none
                  ${caseData.autoFilledFields?.includes('caseYear') ? 'border-[#21C1B6] bg-[#E0F7F6] ring-2 ring-[#21C1B6] ring-opacity-30' : 'border-gray-300'}`}
                />
              </div>
            </div>
          </>
        )}

        {/* Step 5: Case Type - Independent field (starts new dependency chain) */}
        <SearchableSelect
          label="Case Type"
          required
          options={caseTypes}
          value={caseData.caseTypeId || caseData.caseType || ""}
          onChange={(value) => {
            const selectedTypeId = value;
            const selectedType = caseTypes.find(t => t.id.toString() === selectedTypeId.toString());
            setCaseData({ 
              ...caseData, 
              caseType: selectedType ? selectedType.name : "",
              caseTypeId: selectedTypeId,
              // Clear dependent fields when case type changes (strict dependency chain)
              subType: "",
              subTypeId: "",
              caseNature: ""
            });
          }}
          placeholder={loading ? "Loading case types..." : "Select case type..."}
          disabled={loading}
          loading={loading}
          getOptionLabel={(option) => option.name}
          getOptionValue={(option) => option.id}
          isAutoFilled={caseData.autoFilledFields?.includes('caseType')}
        />

        {/* Step 6: Case Sub-Type and Case Nature - Show only when Case Type is selected */}
        {caseData.caseTypeId && subTypes.length > 0 && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <SearchableSelect
                label="Subtype"
                options={subTypes}
                value={caseData.subTypeId || caseData.subType || ""}
                onChange={(value) => {
                  const selectedSubTypeId = value;
                  const selectedSubType = subTypes.find(st => st.id.toString() === selectedSubTypeId.toString());
                  setCaseData({ 
                    ...caseData, 
                    subType: selectedSubType ? selectedSubType.name : "",
                    subTypeId: selectedSubTypeId
                  });
                }}
                placeholder={loading ? "Loading subtypes..." : "Select subtype..."}
                disabled={loading}
                loading={loading}
                getOptionLabel={(option) => option.name}
                getOptionValue={(option) => option.id}
                isAutoFilled={caseData.autoFilledFields?.includes('subType')}
              />
            </div>
            <div>
              <SearchableSelect
                label="Case Nature"
                isAutoFilled={caseData.autoFilledFields?.includes('caseNature')}
                options={[
                  // Basic Categories
                  { value: "Civil", label: "Civil", group: "Basic Categories" },
                  { value: "Criminal", label: "Criminal", group: "Basic Categories" },
                  { value: "Constitutional / Writ", label: "Constitutional / Writ", group: "Basic Categories" },
                  { value: "Arbitration", label: "Arbitration", group: "Basic Categories" },
                  { value: "Commercial", label: "Commercial", group: "Basic Categories" },
                  { value: "Family / Matrimonial", label: "Family / Matrimonial", group: "Basic Categories" },
                  { value: "Service / Employment", label: "Service / Employment", group: "Basic Categories" },
                  { value: "Cooperative", label: "Cooperative", group: "Basic Categories" },
                  { value: "Appellate", label: "Appellate", group: "Basic Categories" },
                  { value: "Revisional", label: "Revisional", group: "Basic Categories" },
                  { value: "Review", label: "Review", group: "Basic Categories" },
                  // Corporate & Financial
                  { value: "Corporate", label: "Corporate", group: "Corporate & Financial" },
                  { value: "Insolvency / Bankruptcy", label: "Insolvency / Bankruptcy", group: "Corporate & Financial" },
                  { value: "Banking & Finance", label: "Banking & Finance", group: "Corporate & Financial" },
                  { value: "Securities / Capital Markets", label: "Securities / Capital Markets", group: "Corporate & Financial" },
                  { value: "Insurance", label: "Insurance", group: "Corporate & Financial" },
                  // Property & Tax
                  { value: "Property / Real Estate", label: "Property / Real Estate", group: "Property & Tax" },
                  { value: "Land Acquisition", label: "Land Acquisition", group: "Property & Tax" },
                  { value: "Revenue", label: "Revenue", group: "Property & Tax" },
                  { value: "Tenancy", label: "Tenancy", group: "Property & Tax" },
                  { value: "Housing / Society", label: "Housing / Society", group: "Property & Tax" },
                  { value: "Taxation", label: "Taxation", group: "Property & Tax" },
                  { value: "Customs & Excise", label: "Customs & Excise", group: "Property & Tax" },
                  { value: "GST / Indirect Tax", label: "GST / Indirect Tax", group: "Property & Tax" },
                  // Regulatory & Social
                  { value: "Electricity / Energy", label: "Electricity / Energy", group: "Regulatory & Social" },
                  { value: "Telecom", label: "Telecom", group: "Regulatory & Social" },
                  { value: "Competition / Antitrust", label: "Competition / Antitrust", group: "Regulatory & Social" },
                  { value: "Consumer Protection", label: "Consumer Protection", group: "Regulatory & Social" },
                  { value: "Labour / Industrial", label: "Labour / Industrial", group: "Regulatory & Social" },
                  { value: "Social Welfare", label: "Social Welfare", group: "Regulatory & Social" },
                  { value: "Education", label: "Education", group: "Regulatory & Social" },
                  { value: "Pension / Retirement", label: "Pension / Retirement", group: "Regulatory & Social" },
                  // Economic Offences
                  { value: "Economic Offences", label: "Economic Offences", group: "Economic Offences" },
                  { value: "NDPS", label: "NDPS", group: "Economic Offences" },
                  { value: "PMLA", label: "PMLA", group: "Economic Offences" },
                  { value: "FEMA", label: "FEMA", group: "Economic Offences" },
                  { value: "White-Collar Crime", label: "White-Collar Crime", group: "Economic Offences" },
                  // Public Law
                  { value: "Public Law", label: "Public Law", group: "Public Law" },
                  { value: "Administrative Law", label: "Administrative Law", group: "Public Law" },
                  { value: "Election Law", label: "Election Law", group: "Public Law" },
                  { value: "Municipal / Local Authority", label: "Municipal / Local Authority", group: "Public Law" },
                  { value: "Public Trust / Charity", label: "Public Trust / Charity", group: "Public Law" },
                  // ADR & Other
                  { value: "Alternative Dispute Resolution (ADR)", label: "Alternative Dispute Resolution (ADR)", group: "ADR & Other" },
                  { value: "Mediation", label: "Mediation", group: "ADR & Other" },
                  { value: "Conciliation", label: "Conciliation", group: "ADR & Other" },
                  { value: "Succession / Inheritance", label: "Succession / Inheritance", group: "ADR & Other" },
                  { value: "Probate / Letters of Administration", label: "Probate / Letters of Administration", group: "ADR & Other" },
                  { value: "Guardianship / Adoption", label: "Guardianship / Adoption", group: "ADR & Other" },
                  { value: "Contempt", label: "Contempt", group: "ADR & Other" },
                  { value: "Quasi-Judicial", label: "Quasi-Judicial", group: "ADR & Other" },
                  { value: "Statutory Reference", label: "Statutory Reference", group: "ADR & Other" },
                  { value: "Transferred / Remanded Matter", label: "Transferred / Remanded Matter", group: "ADR & Other" },
                  { value: "Other / Miscellaneous", label: "Other / Miscellaneous", group: "ADR & Other" }
                ]}
                value={caseData.caseNature || ""}
                onChange={(value) =>
                  setCaseData({ ...caseData, caseNature: value })
                }
                placeholder="Select case nature..."
                getOptionLabel={(option) => option.label}
                getOptionValue={(option) => option.value}
              />
            </div>
          </div>
        )}

        {/* Filing Date */}
        <div className="relative">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Filing Date
          </label>
          <div className="relative">
            <input
              type="text"
              value={caseData.displayFilingDate || ""}
              placeholder="dd/mm/yyyy"
              readOnly
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 
              placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none pr-10 bg-white pointer-events-none"
            />
            <div className="absolute right-2.5 top-2.5 text-gray-400 pointer-events-none">
              <Calendar className="w-5 h-5" />
            </div>
            <input
              id="filing-date-picker"
              type="date"
              value={caseData.filingDate || ""}
              onChange={handleDateChange}
              className="absolute top-0 left-0 w-full h-full opacity-0 cursor-pointer"
              style={{ colorScheme: 'light' }}
            />
          </div>
        </div>

        {/* Next Hearing Date */}
        <div className="relative">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Next Hearing Date
          </label>
          <div className="relative">
            <input
              type="text"
              value={caseData.displayNextHearingDate || ""}
              placeholder="dd/mm/yyyy"
              readOnly
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 
              placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none pr-10 bg-white pointer-events-none"
            />
            <div className="absolute right-2.5 top-2.5 text-gray-400 pointer-events-none">
              <Calendar className="w-5 h-5" />
            </div>
            <input
              id="next-hearing-date-picker"
              type="date"
              value={caseData.nextHearingDate || ""}
              onChange={handleNextHearingDateChange}
              className="absolute top-0 left-0 w-full h-full opacity-0 cursor-pointer"
              style={{ colorScheme: 'light' }}
            />
          </div>
        </div>
      </div>

      {/* Footer note */}
      <div className="mt-6 pt-4 border-t border-gray-200">
        <p className="text-sm text-gray-500">
          All fields marked with * are required
        </p>
      </div>
    </div>
  );
};

export default OverviewStep;