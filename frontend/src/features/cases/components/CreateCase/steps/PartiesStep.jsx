// import React, { useState } from 'react';
// import { Users, X } from 'lucide-react';

// const PartiesStep = ({ caseData, setCaseData }) => {
//   const [activeTab, setActiveTab] = useState('petitioner');

//   const addPetitioner = () => {
//     setCaseData({
//       ...caseData,
//       petitioners: [
//         ...caseData.petitioners,
//         { fullName: '', role: '', advocateName: '', barRegistration: '', contact: '' }
//       ]
//     });
//   };

//   const removePetitioner = (index) => {
//     const newPetitioners = caseData.petitioners.filter((_, i) => i !== index);
//     setCaseData({ ...caseData, petitioners: newPetitioners });
//   };

//   const updatePetitioner = (index, field, value) => {
//     const newPetitioners = [...caseData.petitioners];
//     newPetitioners[index][field] = value;
//     setCaseData({ ...caseData, petitioners: newPetitioners });
//   };

//   const addRespondent = () => {
//     setCaseData({
//       ...caseData,
//       respondents: [
//         ...caseData.respondents,
//         { fullName: '', role: '', advocateName: '', barRegistration: '', contact: '' }
//       ]
//     });
//   };

//   const removeRespondent = (index) => {
//     const newRespondents = caseData.respondents.filter((_, i) => i !== index);
//     setCaseData({ ...caseData, respondents: newRespondents });
//   };

//   const updateRespondent = (index, field, value) => {
//     const newRespondents = [...caseData.respondents];
//     newRespondents[index][field] = value;
//     setCaseData({ ...caseData, respondents: newRespondents });
//   };

//   return (
//     <div>
//       <div className="flex items-center mb-4">
//         <Users className="w-8 h-8 mr-3 text-gray-700" />
//         <div>
//           <h3 className="text-xl font-semibold text-gray-900">Parties Involved</h3>
//           <p className="text-sm text-gray-600">Add details of petitioners and respondents.</p>
//         </div>
//       </div>

//       <div className="flex border-b mb-6">
//         <button
//           onClick={() => setActiveTab('petitioner')}
//           className={`px-6 py-3 font-medium transition-colors ${
//             activeTab === 'petitioner'
//               ? 'border-b-2 border-[#9CDFE1] text-[#0E8F87]'
//               : 'text-gray-500 hover:text-gray-700'
//           }`}
//         >
//           ⚖️ Petitioner / Plaintiff
//         </button>
//         <button
//           onClick={() => setActiveTab('respondent')}
//           className={`px-6 py-3 font-medium transition-colors ${
//             activeTab === 'respondent'
//               ? 'border-b-2 border-[#9CDFE1] text-[#0E8F87]'
//               : 'text-gray-500 hover:text-gray-700'
//           }`}
//         >
//           ⚖️ Respondent / Defendant
//         </button>
//       </div>

//       {activeTab === 'petitioner' && (
//         <div className="space-y-6">
//           {caseData.petitioners.map((petitioner, index) => (
//             <div key={index} className="bg-gray-50 p-6 rounded-lg shadow-sm">
//               <div className="flex justify-between items-center mb-4">
//                 <h4 className="font-semibold text-gray-800">Petitioner {index + 1}</h4>
//                 {index > 0 && (
//                   <button
//                     onClick={() => removePetitioner(index)}
//                     className="text-red-500 hover:text-red-700"
//                   >
//                     <X className="w-5 h-5" />
//                   </button>
//                 )}
//               </div>

//               <div className="space-y-4">
//                 <div>
//                   <label className="block text-sm font-medium text-gray-700 mb-1">
//                     Full Name / Entity<span className="text-red-500">*</span>
//                   </label>
//                   <input
//                     type="text"
//                     placeholder="Enter full name or entity name"
//                     value={petitioner.fullName}
//                     onChange={(e) => updatePetitioner(index, 'fullName', e.target.value)}
//                     className="w-full px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-700 placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
//                   />
//                 </div>

//                 <div className="grid grid-cols-2 gap-4">
//                   <div>
//                     <label className="block text-sm font-medium text-gray-700 mb-1">
//                       Role<span className="text-red-500">*</span>
//                     </label>
//                     <select
//                       value={petitioner.role}
//                       onChange={(e) => updatePetitioner(index, 'role', e.target.value)}
//                       className="w-full px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-700 placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
//                     >
//                       <option value="">Select role...</option>
//                       <option value="Individual">Individual</option>
//                       <option value="Company">Company</option>
//                       <option value="Government">Government</option>
//                       <option value="NGO">NGO</option>
//                     </select>
//                   </div>

//                   <div>
//                     <label className="block text-sm font-medium text-gray-700 mb-1">
//                       Advocate Name
//                     </label>
//                     <input
//                       type="text"
//                       placeholder="Enter advocate name"
//                       value={petitioner.advocateName}
//                       onChange={(e) => updatePetitioner(index, 'advocateName', e.target.value)}
//                       className="w-full px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-700 placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
//                     />
//                   </div>
//                 </div>

//                 <div className="grid grid-cols-2 gap-4">
//                   <div>
//                     <label className="block text-sm font-medium text-gray-700 mb-1">
//                       Bar Registration No.
//                     </label>
//                     <input
//                       type="text"
//                       placeholder="Enter bar registration number"
//                       value={petitioner.barRegistration}
//                       onChange={(e) =>
//                         updatePetitioner(index, 'barRegistration', e.target.value)
//                       }
//                       className="w-full px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-700 placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
//                     />
//                   </div>

//                   <div>
//                     <label className="block text-sm font-medium text-gray-700 mb-1">
//                       Contact Info (Optional)
//                     </label>
//                     <input
//                       type="text"
//                       placeholder="Enter phone or email"
//                       value={petitioner.contact}
//                       onChange={(e) => updatePetitioner(index, 'contact', e.target.value)}
//                       className="w-full px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-700 placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
//                     />
//                   </div>
//                 </div>
//               </div>
//             </div>
//           ))}

//           <button
//             onClick={addPetitioner}
//             className="w-full py-3 border-2 border-dashed border-gray-300 rounded-lg text-gray-600 hover:border-[#9CDFE1] hover:text-[#0E8F87] transition"
//           >
//             + Add Another Petitioner
//           </button>
//         </div>
//       )}

//       {activeTab === 'respondent' && (
//         <div className="space-y-6">
//           {caseData.respondents.map((respondent, index) => (
//             <div key={index} className="bg-gray-50 p-6 rounded-lg shadow-sm">
//               <div className="flex justify-between items-center mb-4">
//                 <h4 className="font-semibold text-gray-800">Respondent {index + 1}</h4>
//                 {index > 0 && (
//                   <button
//                     onClick={() => removeRespondent(index)}
//                     className="text-red-500 hover:text-red-700"
//                   >
//                     <X className="w-5 h-5" />
//                   </button>
//                 )}
//               </div>

//               <div className="space-y-4">
//                 <div>
//                   <label className="block text-sm font-medium text-gray-700 mb-1">
//                     Full Name / Entity<span className="text-red-500">*</span>
//                   </label>
//                   <input
//                     type="text"
//                     placeholder="Enter full name or entity name"
//                     value={respondent.fullName}
//                     onChange={(e) => updateRespondent(index, 'fullName', e.target.value)}
//                     className="w-full px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-700 placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
//                   />
//                 </div>

//                 <div className="grid grid-cols-2 gap-4">
//                   <div>
//                     <label className="block text-sm font-medium text-gray-700 mb-1">
//                       Role<span className="text-red-500">*</span>
//                     </label>
//                     <select
//                       value={respondent.role}
//                       onChange={(e) => updateRespondent(index, 'role', e.target.value)}
//                       className="w-full px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-700 placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
//                     >
//                       <option value="">Select role...</option>
//                       <option value="Individual">Individual</option>
//                       <option value="Company">Company</option>
//                       <option value="Government">Government</option>
//                       <option value="NGO">NGO</option>
//                     </select>
//                   </div>

//                   <div>
//                     <label className="block text-sm font-medium text-gray-700 mb-1">
//                       Advocate Name
//                     </label>
//                     <input
//                       type="text"
//                       placeholder="Enter advocate name"
//                       value={respondent.advocateName}
//                       onChange={(e) =>
//                         updateRespondent(index, 'advocateName', e.target.value)
//                       }
//                       className="w-full px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-700 placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
//                     />
//                   </div>
//                 </div>

//                 <div className="grid grid-cols-2 gap-4">
//                   <div>
//                     <label className="block text-sm font-medium text-gray-700 mb-1">
//                       Bar Registration No.
//                     </label>
//                     <input
//                       type="text"
//                       placeholder="Enter bar registration number"
//                       value={respondent.barRegistration}
//                       onChange={(e) =>
//                         updateRespondent(index, 'barRegistration', e.target.value)
//                       }
//                       className="w-full px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-700 placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
//                     />
//                   </div>

//                   <div>
//                     <label className="block text-sm font-medium text-gray-700 mb-1">
//                       Contact Info (Optional)
//                     </label>
//                     <input
//                       type="text"
//                       placeholder="Enter phone or email"
//                       value={respondent.contact}
//                       onChange={(e) =>
//                         updateRespondent(index, 'contact', e.target.value)
//                       }
//                       className="w-full px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-700 placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
//                     />
//                   </div>
//                 </div>
//               </div>
//             </div>
//           ))}

//           <button
//             onClick={addRespondent}
//             className="w-full py-3 border-2 border-dashed border-gray-300 rounded-lg text-gray-600 hover:border-[#9CDFE1] hover:text-[#0E8F87] transition"
//           >
//             + Add Another Respondent
//           </button>
//         </div>
//       )}
//     </div>
//   );
// };

// export default PartiesStep;



import React, { useState } from 'react';
import { Users, X } from 'lucide-react';

const PartiesStep = ({ caseData, setCaseData }) => {
  const [activeTab, setActiveTab] = useState('petitioner');

  const addPetitioner = () => {
    setCaseData({
      ...caseData,
      petitioners: [
        ...caseData.petitioners,
        { fullName: '', role: '', advocateName: '', barRegistration: '', contact: '' }
      ]
    });
  };

  const removePetitioner = (index) => {
    const newPetitioners = caseData.petitioners.filter((_, i) => i !== index);
    setCaseData({ ...caseData, petitioners: newPetitioners });
  };

  const updatePetitioner = (index, field, value) => {
    const newPetitioners = [...caseData.petitioners];
    newPetitioners[index][field] = value;
    setCaseData({ ...caseData, petitioners: newPetitioners });
  };

  const addRespondent = () => {
    setCaseData({
      ...caseData,
      respondents: [
        ...caseData.respondents,
        { fullName: '', role: '', advocateName: '', barRegistration: '', contact: '' }
      ]
    });
  };

  const removeRespondent = (index) => {
    const newRespondents = caseData.respondents.filter((_, i) => i !== index);
    setCaseData({ ...caseData, respondents: newRespondents });
  };

  const updateRespondent = (index, field, value) => {
    const newRespondents = [...caseData.respondents];
    newRespondents[index][field] = value;
    setCaseData({ ...caseData, respondents: newRespondents });
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center mb-4">
        <Users className="w-8 h-8 mr-3 text-gray-700" />
        <div>
          <h3 className="text-xl font-semibold text-gray-900">Parties Involved</h3>
          <p className="text-sm text-gray-600">Add details of petitioners and respondents.</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b mb-6">
        <button
          onClick={() => setActiveTab('petitioner')}
          className={`px-6 py-3 font-medium transition-colors ${
            activeTab === 'petitioner'
              ? 'border-b-2 border-[#9CDFE1] text-[#0E8F87]'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          ⚖️ Petitioner / Plaintiff
        </button>
        <button
          onClick={() => setActiveTab('respondent')}
          className={`px-6 py-3 font-medium transition-colors ${
            activeTab === 'respondent'
              ? 'border-b-2 border-[#9CDFE1] text-[#0E8F87]'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          ⚖️ Respondent / Defendant
        </button>
      </div>

      {/* Petitioner Section */}
      {activeTab === 'petitioner' && (
        <div className="space-y-6">
          {caseData.petitioners.map((petitioner, index) => (
            <div key={index} className="bg-gray-50 p-6 rounded-lg shadow-sm">
              <div className="flex justify-between items-center mb-4">
                <h4 className="font-semibold text-gray-800">Petitioner {index + 1}</h4>
                {index > 0 && (
                  <button
                    onClick={() => removePetitioner(index)}
                    className="text-red-500 hover:text-red-700"
                  >
                    <X className="w-5 h-5" />
                  </button>
                )}
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Plaintiff Full Name<span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="Enter full name or entity name"
                    value={petitioner.fullName}
                    onChange={(e) => updatePetitioner(index, 'fullName', e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-700 placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Plaintiff Type<span className="text-red-500">*</span>
                    </label>
                    <select
                      value={petitioner.role}
                      onChange={(e) => updatePetitioner(index, 'role', e.target.value)}
                      className="w-full px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-700 placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
                    >
                      <option value="">Select type...</option>
                      <option value="Individual">Individual</option>
                      <option value="Company">Company</option>
                      <option value="Partnership Firm">Partnership Firm</option>
                      <option value="LLP">LLP</option>
                      <option value="Trust/Society">Trust/Society</option>
                      <option value="Government Authority">Government Authority</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Advocate Name<span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      placeholder="Enter advocate name"
                      value={petitioner.advocateName}
                      onChange={(e) => updatePetitioner(index, 'advocateName', e.target.value)}
                      className="w-full px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-700 placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Contact Info (Optional)
                    </label>
                    <input
                      type="text"
                      placeholder="Enter phone or email"
                      value={petitioner.contact}
                      onChange={(e) => updatePetitioner(index, 'contact', e.target.value)}
                      className="w-full px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-700 placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Bar Registration No.
                    </label>
                    <input
                      type="text"
                      placeholder="Enter bar registration number"
                      value={petitioner.barRegistration}
                      onChange={(e) =>
                        updatePetitioner(index, 'barRegistration', e.target.value)
                      }
                      className="w-full px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-700 placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
                    />
                  </div>
                </div>
              </div>
            </div>
          ))}

          <button
            onClick={addPetitioner}
            className="w-full py-3 border-2 border-dashed border-gray-300 rounded-lg text-gray-600 hover:border-[#9CDFE1] hover:text-[#0E8F87] transition"
          >
            + Add Another Petitioner
          </button>
        </div>
      )}

      {/* Respondent Section */}
      {activeTab === 'respondent' && (
        <div className="space-y-6">
          {caseData.respondents.map((respondent, index) => (
            <div key={index} className="bg-gray-50 p-6 rounded-lg shadow-sm">
              <div className="flex justify-between items-center mb-4">
                <h4 className="font-semibold text-gray-800">Respondent {index + 1}</h4>
                {index > 0 && (
                  <button
                    onClick={() => removeRespondent(index)}
                    className="text-red-500 hover:text-red-700"
                  >
                    <X className="w-5 h-5" />
                  </button>
                )}
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Defendant Full Name<span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="Enter full name or entity name"
                    value={respondent.fullName}
                    onChange={(e) => updateRespondent(index, 'fullName', e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-700 placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Defendant Type<span className="text-red-500">*</span>
                    </label>
                    <select
                      value={respondent.role}
                      onChange={(e) => updateRespondent(index, 'role', e.target.value)}
                      className="w-full px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-700 placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
                    >
                      <option value="">Select type...</option>
                      <option value="Individual">Individual</option>
                      <option value="Company">Company</option>
                      <option value="Partnership Firm">Partnership Firm</option>
                      <option value="LLP">LLP</option>
                      <option value="Trust/Society">Trust/Society</option>
                      <option value="Government Authority">Government Authority</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Advocate Name<span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      placeholder="Enter advocate name"
                      value={respondent.advocateName}
                      onChange={(e) =>
                        updateRespondent(index, 'advocateName', e.target.value)
                      }
                      className="w-full px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-700 placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Contact Info (Optional)
                    </label>
                    <input
                      type="text"
                      placeholder="Enter phone or email"
                      value={respondent.contact}
                      onChange={(e) =>
                        updateRespondent(index, 'contact', e.target.value)
                      }
                      className="w-full px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-700 placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Bar Registration No.
                    </label>
                    <input
                      type="text"
                      placeholder="Enter bar registration number"
                      value={respondent.barRegistration}
                      onChange={(e) =>
                        updateRespondent(index, 'barRegistration', e.target.value)
                      }
                      className="w-full px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-700 placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
                    />
                  </div>
                </div>
              </div>
            </div>
          ))}

          <button
            onClick={addRespondent}
            className="w-full py-3 border-2 border-dashed border-gray-300 rounded-lg text-gray-600 hover:border-[#9CDFE1] hover:text-[#0E8F87] transition"
          >
            + Add Another Respondent
          </button>
        </div>
      )}
    </div>
  );
};

export default PartiesStep;
