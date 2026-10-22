// import React, { useState } from 'react';
// import { FolderPlus, Calendar } from 'lucide-react';

// const DatesStep = ({ caseData, setCaseData }) => {
//   const [autoRemind, setAutoRemind] = useState(false);

//   const formatDateToIndian = (isoDate) => {
//     if (!isoDate) return '';
//     const [year, month, day] = isoDate.split('-');
//     return `${day}/${month}/${year}`;
//   };

//   const handleDateChange = (key, value) => {
//     const formatted = formatDateToIndian(value);
//     setCaseData({
//       ...caseData,
//       [key]: value,
//       [`${key}Display`]: formatted,
//     });
//   };

//   return (
//     <div>
//       <div className="flex items-start mb-6">
//         <FolderPlus className="w-6 h-6 mr-3 text-gray-700 mt-1" />
//         <div>
//           <h3 className="text-xl font-semibold text-gray-900">
//             Important Dates & Status
//           </h3>
//           <p className="text-sm text-gray-600 mt-1">
//             Track case milestones and deadlines.
//           </p>
//         </div>
//       </div>

//       <div className="space-y-6">
//         <div className="grid grid-cols-2 gap-4">
//           {[
//             { label: 'Registration Date', key: 'registrationDate', required: true },
//             { label: 'First Hearing Date', key: 'firstHearingDate', required: true },
//           ].map(({ label, key, required }) => (
//             <div key={key} className="relative">
//               <label className="block text-sm font-medium text-gray-700 mb-2">
//                 {label} {required && <span className="text-red-500">*</span>}
//               </label>

//               <div className="relative">
//                 <input
//                   type="text"
//                   value={caseData[`${key}Display`] || ''}
//                   placeholder="dd/mm/yyyy"
//                   readOnly
//                   className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 
//                              placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] 
//                              focus:border-[#9CDFE1] outline-none pr-10 bg-white pointer-events-none"
//                 />
//                 <div className="absolute right-2.5 top-2.5 text-gray-400 pointer-events-none">
//                   <Calendar className="w-5 h-5" />
//                 </div>

//                 <input
//                   id={`${key}-picker`}
//                   type="date"
//                   value={caseData[key] || ''}
//                   onChange={(e) => handleDateChange(key, e.target.value)}
//                   className="absolute top-0 left-0 w-full h-full opacity-0 cursor-pointer"
//                   style={{ colorScheme: 'light' }}
//                 />
//               </div>
//             </div>
//           ))}
//         </div>

//         <div className="grid grid-cols-2 gap-4">
//           <div className="relative">
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Expected Disposal Date
//             </label>
//             <div className="relative">
//               <input
//                 type="text"
//                 value={caseData.expectedDisposalDateDisplay || ''}
//                 placeholder="dd/mm/yyyy"
//                 readOnly
//                 className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 
//                            placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] 
//                            focus:border-[#9CDFE1] outline-none pr-10 bg-white pointer-events-none"
//               />
//               <div className="absolute right-2.5 top-2.5 text-gray-400 pointer-events-none">
//                 <Calendar className="w-5 h-5" />
//               </div>
//               <input
//                 id="expectedDisposalDate-picker"
//                 type="date"
//                 value={caseData.expectedDisposalDate || ''}
//                 onChange={(e) => handleDateChange('expectedDisposalDate', e.target.value)}
//                 className="absolute top-0 left-0 w-full h-full opacity-0 cursor-pointer"
//                 style={{ colorScheme: 'light' }}
//               />
//             </div>
//             <p className="text-xs text-gray-500 mt-1">
//               Optional - Estimated timeline
//             </p>
//           </div>

//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Current Case Status <span className="text-red-500">*</span>
//             </label>
//             <select
//               value={caseData.currentStatus || ''}
//               onChange={(e) =>
//                 setCaseData({ ...caseData, currentStatus: e.target.value })
//               }
//               className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 
//                          focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
//             >
//               <option value="">Select current status...</option>
//               <option value="Filed">Filed</option>
//               <option value="Pending">Pending</option>
//               <option value="Under Hearing">Under Hearing</option>
//               <option value="Awaiting Judgment">Awaiting Judgment</option>
//               <option value="Disposed">Disposed</option>
//               <option value="Closed">Closed</option>
//             </select>
//           </div>
//         </div>

//         <div className="flex items-start">
//           <input
//             type="checkbox"
//             id="autoRemind"
//             checked={autoRemind}
//             onChange={(e) => setAutoRemind(e.target.checked)}
//             className="mt-1 w-4 h-4 text-[#9CDFE1] border-gray-300 rounded focus:ring-[#9CDFE1]"
//           />
//           <label htmlFor="autoRemind" className="ml-3">
//             <div className="text-sm font-medium text-gray-700">
//               Auto-remind me about hearings
//             </div>
//             <p className="text-xs text-gray-500">
//               Get notifications 24 hours before scheduled hearings
//             </p>
//           </label>
//         </div>
//       </div>
//     </div>
//   );
// };

// export default DatesStep;


import React, { useState, useEffect } from 'react';
import { FolderPlus, Calendar } from 'lucide-react';

const DatesStep = ({ caseData, setCaseData }) => {
  // Sync local state with caseData updates (especially from auto-fill)
  const [documentType, setDocumentType] = useState(caseData.documentType || '');
  const [filedByPlaintiff, setFiledByPlaintiff] = useState(caseData.filedByPlaintiff || false);
  const [filedByDefendant, setFiledByDefendant] = useState(caseData.filedByDefendant || false);
  const [documentDate, setDocumentDate] = useState(caseData.documentDate || '');
  const [displayDocumentDate, setDisplayDocumentDate] = useState(caseData.displayDocumentDate || '');
  const [autoRemind, setAutoRemind] = useState(caseData.autoRemind || false);

  // Sync local state when caseData updates (e.g., from auto-fill)
  React.useEffect(() => {
    if (caseData.documentType) setDocumentType(caseData.documentType);
    if (caseData.filedByPlaintiff !== undefined) setFiledByPlaintiff(caseData.filedByPlaintiff);
    if (caseData.filedByDefendant !== undefined) setFiledByDefendant(caseData.filedByDefendant);
    if (caseData.documentDate) {
      setDocumentDate(caseData.documentDate);
      setDisplayDocumentDate(caseData.displayDocumentDate || formatDateToIndian(caseData.documentDate));
    }
    if (caseData.nextHearingDate && !caseData.displayNextHearingDate) {
      const formatted = formatDateToIndian(caseData.nextHearingDate);
      setCaseData(prev => ({
        ...prev,
        displayNextHearingDate: formatted
      }));
    }
  }, [caseData.documentType, caseData.filedByPlaintiff, caseData.filedByDefendant, caseData.documentDate, caseData.nextHearingDate]);

  // Format date to Indian dd/mm/yyyy
  const formatDateToIndian = (isoDate) => {
    if (!isoDate) return '';
    const [year, month, day] = isoDate.split('-');
    return `${day}/${month}/${year}`;
  };

  // Handle document type change
  const handleDocumentTypeChange = (e) => {
    const value = e.target.value;
    setDocumentType(value);
    setCaseData({ ...caseData, documentType: value });
  };

  // Handle filed by checkboxes
  const handleFiledByChange = (type, checked) => {
    if (type === 'plaintiff') {
      setFiledByPlaintiff(checked);
      setCaseData({ ...caseData, filedByPlaintiff: checked });
    } else if (type === 'defendant') {
      setFiledByDefendant(checked);
      setCaseData({ ...caseData, filedByDefendant: checked });
    }
  };

  // Handle document date change
  const handleDocumentDateChange = (e) => {
    const isoDate = e.target.value;
    const formatted = formatDateToIndian(isoDate);
    setDocumentDate(isoDate);
    setDisplayDocumentDate(formatted);
    setCaseData({
      ...caseData,
      documentDate: isoDate,
      displayDocumentDate: formatted,
    });
  };

  // Handle auto-remind checkbox
  const handleAutoRemindChange = (e) => {
    const checked = e.target.checked;
    setAutoRemind(checked);
    setCaseData({ ...caseData, autoRemind: checked });
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-start mb-6">
        <FolderPlus className="w-6 h-6 mr-3 text-gray-700 mt-1" />
        <div>
          <h3 className="text-xl font-semibold text-gray-900">
            Upload & Manage Document           </h3>
          <p className="text-sm text-gray-600 mt-1">
          Turn case documents into actionable timelines.
          </p>
        </div>
      </div>

      {/* Form Fields */}
      <div className="space-y-6">
        {/* Document Type - TEXT INPUT FIELD */}
        <div>
          <label
            htmlFor="documentType"
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            Document Type <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            id="documentType"
            value={documentType}
            onChange={handleDocumentTypeChange}
            placeholder="e.g., Affidavit, Evidence, Agreement, Notice"
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 
                       placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] 
                       focus:border-[#9CDFE1] outline-none"
            required
            aria-required="true"
            aria-label="Document Type"
          />
        </div>

        {/* Filed by whom - Checkboxes */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Filed by whom
          </label>
          <div className="space-y-2">
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={filedByPlaintiff}
                onChange={(e) => handleFiledByChange('plaintiff', e.target.checked)}
                className="w-4 h-4 text-[#9CDFE1] border-gray-300 rounded focus:ring-[#9CDFE1]"
                aria-label="Filed by Plaintiff"
              />
              <span className="ml-2 text-sm text-gray-700">Plaintiff</span>
            </label>
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={filedByDefendant}
                onChange={(e) => handleFiledByChange('defendant', e.target.checked)}
                className="w-4 h-4 text-[#9CDFE1] border-gray-300 rounded focus:ring-[#9CDFE1]"
                aria-label="Filed by Defendant"
              />
              <span className="ml-2 text-sm text-gray-700">Defendant</span>
            </label>
          </div>
        </div>

        {/* Document Date - Date input field */}
        <div className="relative">
          <label
            htmlFor="documentDate"
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            Document Date
          </label>
          <div className="relative">
            <input
              type="text"
              value={displayDocumentDate}
              placeholder="dd/mm/yyyy"
              readOnly
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 
                         placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] 
                         focus:border-[#9CDFE1] outline-none pr-10 bg-white pointer-events-none"
              aria-label="Document Date"
            />
            {/* Calendar Icon */}
            <div className="absolute right-2.5 top-2.5 text-gray-400 pointer-events-none">
              <Calendar className="w-5 h-5" />
            </div>
            {/* Actual Date Input - Positioned on top */}
            <input
              id="documentDate"
              type="date"
              value={documentDate}
              onChange={handleDocumentDateChange}
              className="absolute top-0 left-0 w-full h-full opacity-0 cursor-pointer"
              style={{ colorScheme: 'light' }}
              aria-label="Document Date Picker"
            />
          </div>
        </div>

        {/* Auto-remind me about hearings - Checkbox with helper text */}
        <div className="flex items-start">
          <input
            type="checkbox"
            id="autoRemind"
            checked={autoRemind}
            onChange={handleAutoRemindChange}
            className="mt-1 w-4 h-4 text-[#9CDFE1] border-gray-300 rounded focus:ring-[#9CDFE1]"
            aria-label="Auto-remind me about hearings"
          />
          <label htmlFor="autoRemind" className="ml-3">
            <div className="text-sm font-medium text-gray-700">
              Auto-remind me about hearings
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Get notifications 24 hours before scheduled hearings
            </p>
          </label>
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

export default DatesStep;

