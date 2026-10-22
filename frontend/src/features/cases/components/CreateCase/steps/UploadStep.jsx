import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Upload, Loader2, CheckCircle, AlertCircle, HardDrive, Cloud, FileText, X, Zap, FolderOpen } from 'lucide-react';
import documentApi from '@/shared/api/documentApi';
import googleDriveApi from '@/shared/api/googleDriveApi';
import { toast } from 'react-toastify';
import GoogleDrivePicker from '@/features/case-storage/components/GoogleDrivePicker';
import {
  matchCaseType,
  matchCourtName,
  matchJurisdiction,
  matchSubType,
  matchPriorityLevel,
  matchCourtLevel
} from '../../../utils/fieldMatcher.js';
import { CONTENT_SERVICE_DIRECT } from '@/config/apiConfig';

const PROCESSING_STAGES = [
  { id: 'uploading', label: 'Upload', description: 'Securely uploading files' },
  { id: 'processing', label: 'Process', description: 'AI analyzing content' },
  { id: 'extracting', label: 'Extract', description: 'Pulling case details' },
  { id: 'success', label: 'Complete', description: 'Ready to review' },
];

const getFileTypeInfo = (file) => {
  if (!file?.name) return { label: 'FILE', color: 'text-gray-600', bg: 'bg-gray-100', border: 'border-gray-200' };
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) return { label: 'PDF', color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200' };
  if (name.endsWith('.doc') || name.endsWith('.docx')) return { label: 'DOC', color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200' };
  if (name.match(/\.(png|jpg|jpeg|tiff|gif)$/)) return { label: 'IMG', color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200' };
  if (name.endsWith('.txt')) return { label: 'TXT', color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200' };
  return { label: 'FILE', color: 'text-gray-600', bg: 'bg-gray-100', border: 'border-gray-200' };
};

const formatFileSize = (bytes) => {
  if (!bytes) return '—';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
};

const UploadStep = ({ caseData, setCaseData, onComplete, onUploadStatusChange }) => {
  const [selectedFiles, setSelectedFiles] = useState(caseData.uploadedFiles || []);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState(null);
  const [uploadMessage, setUploadMessage] = useState('');
  const [processingProgress, setProcessingProgress] = useState(0);
  const [pendingGoogleDriveFiles, setPendingGoogleDriveFiles] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  const [caseTypes, setCaseTypes] = useState([]);
  const [courts, setCourts] = useState([]);
  const [jurisdictions, setJurisdictions] = useState([]);
  const [subTypes, setSubTypes] = useState([]);

  useEffect(() => { fetchDropdownOptions(); }, []);

  useEffect(() => {
    if (onUploadStatusChange && uploadStatus) onUploadStatusChange(uploadStatus);
  }, [uploadStatus, onUploadStatusChange]);

  const fetchDropdownOptions = async () => {
    try {
      const [caseTypesRes, jurisdictionsRes] = await Promise.all([
        fetch(`${CONTENT_SERVICE_DIRECT}/case-types`),
        fetch(`${CONTENT_SERVICE_DIRECT}/jurisdictions`),
      ]);
      if (caseTypesRes.ok) {
        const d = await caseTypesRes.json();
        setCaseTypes(Array.isArray(d) ? d : []);
      }
      if (jurisdictionsRes.ok) {
        const d = await jurisdictionsRes.json();
        setJurisdictions(Array.isArray(d) ? d : []);
      }
    } catch (error) {
      console.error('Error fetching dropdown options:', error);
    }
  };

  const fetchCourtsByJurisdiction = async (jurisdictionId) => {
    try {
      const response = await fetch(`${CONTENT_SERVICE_DIRECT}/jurisdictions/${jurisdictionId}/courts`);
      if (response.ok) { const d = await response.json(); setCourts(Array.isArray(d) ? d : []); }
    } catch (error) { console.error('Error fetching courts:', error); }
  };

  const fetchSubTypes = async (caseTypeId) => {
    try {
      const response = await fetch(`${CONTENT_SERVICE_DIRECT}/case-types/${caseTypeId}/sub-types`);
      if (response.ok) { const d = await response.json(); setSubTypes(Array.isArray(d) ? d : []); }
    } catch (error) { console.error('Error fetching subTypes:', error); }
  };

  const addFiles = useCallback((files) => {
    const newFiles = [...selectedFiles, ...files];
    setSelectedFiles(newFiles);
    setCaseData({ ...caseData, uploadedFiles: newFiles });
  }, [selectedFiles, caseData, setCaseData]);

  const handleFileChange = (e) => {
    addFiles(Array.from(e.target.files));
  };

  const handleDragOver = (e) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e) => { e.preventDefault(); setIsDragging(false); };
  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (isUploading) return;
    const files = Array.from(e.dataTransfer.files).filter(f =>
      f.name.match(/\.(pdf|doc|docx|txt|png|jpg|jpeg|tiff)$/i)
    );
    if (files.length) addFiles(files);
    else toast.warning('Only PDF, DOC, DOCX, TXT, PNG, JPG, TIFF files are supported');
  };

  const handleUploadAndExtract = async () => {
    if (selectedFiles.length === 0) { toast.error('Please select at least one file to upload'); return; }

    const localFiles = selectedFiles.filter(f => !f.fromGoogleDrive);
    const googleDriveFileIds = pendingGoogleDriveFiles.map(f => ({ id: f.id, name: f.name, mimeType: f.mimeType }));

    if (localFiles.length === 0 && googleDriveFileIds.length === 0) {
      toast.error('Please select at least one file to upload'); return;
    }

    setIsUploading(true);
    setProcessingProgress(0);
    setUploadStatus('uploading');
    setUploadMessage(`Uploading ${localFiles.length} local file(s)...`);

    try {
      let folderName = null;
      let uploadedFiles = [];

      if (localFiles.length > 0) {
        setUploadStatus('uploading');
        setUploadMessage(`Uploading ${localFiles.length} local file(s)...`);
        setProcessingProgress(5);
        const uploadResult = await documentApi.uploadDocumentsForProcessing(localFiles);
        if (!uploadResult.success || !uploadResult.folderName)
          throw new Error(uploadResult.message || 'Failed to upload local documents');
        folderName = uploadResult.folderName;
        uploadedFiles = uploadResult.uploadedFiles || [];
      }

      if (googleDriveFileIds.length > 0) {
        setUploadStatus('uploading');
        setUploadMessage(`Downloading ${googleDriveFileIds.length} file(s) from Google Drive...`);
        setProcessingProgress(10);
        try {
          const tokenData = await googleDriveApi.getAccessToken();
          if (!tokenData?.accessToken) throw new Error('Failed to get Google Drive access token. Please reconnect.');
          const gdResult = await googleDriveApi.downloadMultipleFiles(googleDriveFileIds, tokenData.accessToken, folderName);
          if (gdResult.success) {
            if (!folderName && gdResult.documents?.length > 0)
              folderName = gdResult.documents[0].folderName || gdResult.folderName;
            const successfulGdFiles = gdResult.documents.filter(d => d.status !== 'failed');
            uploadedFiles = [...uploadedFiles, ...successfulGdFiles];
            if (gdResult.summary?.failed > 0) toast.warning(`${gdResult.summary.failed} Google Drive file(s) failed to download`);
          } else throw new Error(gdResult.message || 'Failed to download Google Drive files');
        } catch (gdError) {
          console.error('[UploadStep] Google Drive download error:', gdError);
          if (localFiles.length === 0) throw new Error(`Google Drive error: ${gdError.message}`);
          else toast.warning(`Google Drive files couldn't be downloaded: ${gdError.message}`);
        }
      }

      if (!folderName) throw new Error('No folder created. Please try again.');

      setProcessingProgress(20);
      setUploadStatus('processing');
      setUploadMessage('Processing documents with AI...');

      let allProcessed = false;
      let attempts = 0;
      let consecutiveErrors = 0;
      let maxAttempts = 300;
      const pollInterval = 1000; // 1s for real-time feel
      const maxConsecutiveErrors = 10;
      const extendedTimeoutAttempts = 120;

      while (!allProcessed && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        attempts++;
        try {
          const statusResult = await documentApi.getFolderProcessingStatus(folderName);
          consecutiveErrors = 0;
          const filesInFolder = statusResult.documents || [];
          const totalFiles = uploadedFiles.length;

          if (filesInFolder.length === 0 && attempts < 20) continue;

          const processedCount = filesInFolder.filter(f => f.status === 'processed').length;
          const failedCount = filesInFolder.filter(f => f.status === 'error').length;
          const processingCount = filesInFolder.filter(f =>
            f.status === 'processing' || f.status === 'queued' || f.status === 'embedding_pending'
          ).length;

          const avgBackendProgress = filesInFolder.length > 0
            ? filesInFolder.reduce((sum, f) => sum + (Number(f.processing_progress) || 0), 0) / filesInFolder.length
            : Number(statusResult.progress) || 0;
          const newProgress = Math.max(20, Math.min(90, Math.round(20 + (avgBackendProgress * 0.7))));
          setProcessingProgress(newProgress);

          if (processingCount > 0)
            setUploadMessage(`Processing documents... ${processedCount}/${totalFiles} completed, ${processingCount} in progress`);
          else
            setUploadMessage(`Processing documents... ${processedCount}/${totalFiles} completed`);

          allProcessed = processedCount === totalFiles && processedCount > 0 && totalFiles > 0;

          if (processedCount + failedCount === totalFiles && totalFiles > 0) {
            if (processedCount > 0) break;
          }

          if (attempts >= maxAttempts) {
            if (processedCount > 0) break;
            else if (processingCount > 0 && attempts < maxAttempts + extendedTimeoutAttempts) {
              if (attempts === maxAttempts) maxAttempts += extendedTimeoutAttempts;
            } else {
              throw new Error(`File processing timed out. Please try again.`);
            }
          }
        } catch (statusError) {
          consecutiveErrors++;
          if (consecutiveErrors >= maxConsecutiveErrors)
            throw new Error(`Failed to get processing status: ${statusError.message}`);
          const backoffDelay = Math.min(5000, 1000 * Math.pow(2, consecutiveErrors - 1));
          await new Promise(resolve => setTimeout(resolve, backoffDelay));
        }
      }

      if (!allProcessed && attempts >= maxAttempts && uploadedFiles.length > 0) {
        const finalStatus = await documentApi.getFolderProcessingStatus(folderName);
        const finalProcessed = (finalStatus.documents || []).filter(f => f.status === 'processed').length;
        if (finalProcessed === 0) throw new Error('No files were processed successfully. Please try again.');
      }

      setProcessingProgress(90);
      setUploadStatus('extracting');
      setUploadMessage('Extracting case information...');

      const extractResult = await documentApi.extractCaseFieldsFromFolder(folderName);
      if (!extractResult.success) throw new Error(extractResult.message || 'Failed to extract case fields');

      setProcessingProgress(100);

      const extracted = extractResult.extractedData || {};
      let matchedCaseType = null, matchedCourtName = null, matchedJurisdiction = null, matchedSubType = null;
      let fetchedCourts = [], fetchedSubTypes = [];
      const autoFilledFields = new Set();

      if (extracted.jurisdiction && !caseData.jurisdictionId && !caseData.jurisdiction) {
        matchedJurisdiction = matchJurisdiction(extracted.jurisdiction, jurisdictions);
        if (matchedJurisdiction) {
          await fetchCourtsByJurisdiction(matchedJurisdiction.value);
          await new Promise(resolve => setTimeout(resolve, 100));
          try {
            const courtsRes = await fetch(`${CONTENT_SERVICE_DIRECT}/jurisdictions/${matchedJurisdiction.value}/courts`);
            if (courtsRes.ok) { fetchedCourts = await courtsRes.json(); setCourts(Array.isArray(fetchedCourts) ? fetchedCourts : []); }
          } catch (err) { console.error('Error fetching courts:', err); }
        }
      }

      const courtsToUse = fetchedCourts.length > 0 ? fetchedCourts : courts;
      if (matchedJurisdiction && extracted.courtName && !caseData.courtId && !caseData.courtName && courtsToUse.length > 0) {
        matchedCourtName = matchCourtName(extracted.courtName, courtsToUse);
      }

      if (extracted.caseType && !caseData.caseTypeId && !caseData.caseType) {
        matchedCaseType = matchCaseType(extracted.caseType, caseTypes);
        if (matchedCaseType) {
          await fetchSubTypes(matchedCaseType.value);
          await new Promise(resolve => setTimeout(resolve, 100));
          try {
            const subTypesRes = await fetch(`${CONTENT_SERVICE_DIRECT}/case-types/${matchedCaseType.value}/sub-types`);
            if (subTypesRes.ok) { fetchedSubTypes = await subTypesRes.json(); setSubTypes(Array.isArray(fetchedSubTypes) ? fetchedSubTypes : []); }
          } catch (err) { console.error('Error fetching subTypes:', err); }
        }
      }

      const subTypesToUse = fetchedSubTypes.length > 0 ? fetchedSubTypes : subTypes;
      if (matchedCaseType && extracted.subType && !caseData.subTypeId && !caseData.subType && subTypesToUse.length > 0)
        matchedSubType = matchSubType(extracted.subType, subTypesToUse);

      const matchedPriority = extracted.priorityLevel ? matchPriorityLevel(extracted.priorityLevel) : null;
      const matchedCourtLevel = extracted.courtLevel ? matchCourtLevel(extracted.courtLevel) : null;

      let generatedCaseTitle = extracted.caseTitle || '';
      if (!generatedCaseTitle && extracted.petitioners && extracted.respondents) {
        const petitionerNames = Array.isArray(extracted.petitioners) && extracted.petitioners.length > 0
          ? extracted.petitioners.map(p => typeof p === 'string' ? p : (p.fullName || '')).filter(Boolean)
          : (typeof extracted.petitioners === 'string' ? [extracted.petitioners] : []);
        const respondentNames = Array.isArray(extracted.respondents) && extracted.respondents.length > 0
          ? extracted.respondents.map(r => typeof r === 'string' ? r : (r.fullName || '')).filter(Boolean)
          : (typeof extracted.respondents === 'string' ? [extracted.respondents] : []);
        if (petitionerNames.length > 0 && respondentNames.length > 0) {
          const pp = petitionerNames.length === 1 ? petitionerNames[0] : `${petitionerNames[0]} & ${petitionerNames.length - 1} Other${petitionerNames.length - 1 > 1 ? 's' : ''}`;
          const rp = respondentNames.length === 1 ? respondentNames[0] : `${respondentNames[0]} & ${respondentNames.length - 1} Other${respondentNames.length - 1 > 1 ? 's' : ''}`;
          generatedCaseTitle = `${pp} vs ${rp}`;
        } else if (petitionerNames.length > 0) generatedCaseTitle = `${petitionerNames[0]} vs Unknown`;
        else if (respondentNames.length > 0) generatedCaseTitle = `Unknown vs ${respondentNames[0]}`;
      }

      const af = (field, value) => { if (value) autoFilledFields.add(field); return value; };

      const updatedCaseData = {
        ...caseData,
        caseTitle: caseData.caseTitle || (af('caseTitle', generatedCaseTitle) || ''),
        caseNumber: caseData.caseNumber || (af('caseNumber', extracted.caseNumber) || ''),
        casePrefix: caseData.casePrefix || (af('casePrefix', extracted.casePrefix) || ''),
        caseYear: caseData.caseYear || (af('caseYear', extracted.caseYear) || ''),
        caseType: caseData.caseType || (matchedCaseType ? (af('caseType', matchedCaseType.label) || '') : (af('caseType', extracted.caseType) || '')),
        caseTypeId: caseData.caseTypeId || (matchedCaseType ? matchedCaseType.value.toString() : ''),
        caseNature: caseData.caseNature || (af('caseNature', extracted.caseNature) || ''),
        subType: caseData.subType || (matchedCaseType && matchedSubType ? (af('subType', matchedSubType.label) || '') : (matchedCaseType && extracted.subType ? (af('subType', extracted.subType) || '') : '')),
        subTypeId: caseData.subTypeId || (matchedCaseType && matchedSubType ? matchedSubType.value.toString() : ''),
        courtName: caseData.courtName || (matchedJurisdiction && matchedCourtName ? (af('courtName', matchedCourtName.label) || '') : (matchedJurisdiction && extracted.courtName ? (af('courtName', extracted.courtName) || '') : '')),
        courtId: caseData.courtId || (matchedJurisdiction && matchedCourtName ? (af('courtId', matchedCourtName.value.toString()) || '') : ''),
        courtLevel: caseData.courtLevel || (af('courtLevel', matchedCourtLevel || extracted.courtLevel) || ''),
        benchDivision: caseData.benchDivision || (af('benchDivision', extracted.benchDivision) || ''),
        jurisdiction: caseData.jurisdiction || (matchedJurisdiction ? (af('jurisdiction', matchedJurisdiction.label) || '') : (af('jurisdiction', extracted.jurisdiction) || '')),
        jurisdictionName: caseData.jurisdictionName || (matchedJurisdiction ? matchedJurisdiction.label : extracted.jurisdiction || ''),
        jurisdictionId: caseData.jurisdictionId || (matchedJurisdiction ? (af('jurisdictionId', matchedJurisdiction.value.toString()) || '') : ''),
        state: caseData.state || (af('state', extracted.state) || ''),
        filingDate: caseData.filingDate || (af('filingDate', extracted.filingDate) || ''),
        judges: (caseData.judges?.length > 0) ? caseData.judges : (af('judges', extracted.judges) || []),
        courtRoom: caseData.courtRoom || (af('courtRoom', extracted.courtRoom) || ''),
        petitioners: (caseData.petitioners?.length > 0 && caseData.petitioners[0].fullName) ? caseData.petitioners
          : (extracted.petitioners
              ? (Array.isArray(extracted.petitioners) && extracted.petitioners.length > 0
                  ? extracted.petitioners.map(p => typeof p === 'string' ? { fullName: p, role: '', advocateName: '', barRegistration: '', contact: '' } : { fullName: p.fullName || '', role: p.role || '', advocateName: p.advocateName || '', barRegistration: p.barRegistration || '', contact: p.contact || '' })
                  : typeof extracted.petitioners === 'string' ? [{ fullName: extracted.petitioners, role: '', advocateName: '', barRegistration: '', contact: '' }]
                  : [{ fullName: '', role: '', advocateName: '', barRegistration: '', contact: '' }])
              : [{ fullName: '', role: '', advocateName: '', barRegistration: '', contact: '' }]),
        respondents: (caseData.respondents?.length > 0 && caseData.respondents[0].fullName) ? caseData.respondents
          : (extracted.respondents
              ? (Array.isArray(extracted.respondents) && extracted.respondents.length > 0
                  ? extracted.respondents.map(r => typeof r === 'string' ? { fullName: r, role: '', advocateName: '', barRegistration: '', contact: '' } : { fullName: r.fullName || '', role: r.role || '', advocateName: r.advocateName || '', barRegistration: r.barRegistration || '', contact: r.contact || '' })
                  : typeof extracted.respondents === 'string' ? [{ fullName: extracted.respondents, role: '', advocateName: '', barRegistration: '', contact: '' }]
                  : [{ fullName: '', role: '', advocateName: '', barRegistration: '', contact: '' }])
              : [{ fullName: '', role: '', advocateName: '', barRegistration: '', contact: '' }]),
        categoryType: caseData.categoryType || extracted.categoryType || '',
        primaryCategory: caseData.primaryCategory || extracted.primaryCategory || '',
        subCategory: caseData.subCategory || extracted.subCategory || '',
        complexity: caseData.complexity || extracted.complexity || '',
        monetaryValue: caseData.monetaryValue || (extracted.monetaryValue ? String(extracted.monetaryValue).replace(/[₹,]/g, '').trim() : ''),
        priorityLevel: caseData.priorityLevel || matchedPriority || extracted.priorityLevel || 'Medium',
        currentStatus: caseData.currentStatus || extracted.currentStatus || '',
        nextHearingDate: caseData.nextHearingDate || extracted.nextHearingDate || '',
        documentType: caseData.documentType || extracted.documentType || '',
        filedBy: caseData.filedBy || extracted.filedBy || '',
        uploadedFiles: uploadedFiles,
        tempFolderName: folderName,
        autoFilledFields: Array.from(autoFilledFields),
      };

      setCaseData(updatedCaseData);
      setUploadStatus('success');
      setUploadMessage('Documents processed! All form fields have been auto-filled.');
      toast.success('Documents uploaded and case details extracted successfully!');

    } catch (error) {
      console.error('Error uploading and extracting:', error);
      setUploadStatus('error');
      setUploadMessage(error.message || 'Failed to upload and process documents');
      toast.error(error.message || 'Failed to upload and process documents');
    } finally {
      setIsUploading(false);
    }
  };

  const handleBrowseClick = () => fileInputRef.current?.click();

  const removeFile = (index) => {
    const newFiles = selectedFiles.filter((_, i) => i !== index);
    setSelectedFiles(newFiles);
    setCaseData({ ...caseData, uploadedFiles: newFiles });
  };

  const handleGoogleDriveFilesSelected = (files) => {
    if (!files?.length) return;
    const newPendingFiles = files.map(f => ({ id: f.id, name: f.name, mimeType: f.mimeType, size: f.sizeBytes || 0, fromGoogleDrive: true }));
    setPendingGoogleDriveFiles(prev => [...prev, ...newPendingFiles]);
    const displayFiles = files.map(f => ({ name: f.name, size: f.sizeBytes || 0, fromGoogleDrive: true, googleDriveId: f.id }));
    const newFiles = [...selectedFiles, ...displayFiles];
    setSelectedFiles(newFiles);
    setCaseData({ ...caseData, uploadedFiles: newFiles });
    toast.success(`${files.length} file(s) selected from Google Drive`);
  };

  const removeGoogleDriveFile = (googleDriveId) => {
    setPendingGoogleDriveFiles(prev => prev.filter(f => f.id !== googleDriveId));
    const newSelectedFiles = selectedFiles.filter(f => !(f.fromGoogleDrive && f.googleDriveId === googleDriveId));
    setSelectedFiles(newSelectedFiles);
    setCaseData({ ...caseData, uploadedFiles: newSelectedFiles });
  };

  const getStageStatus = (stageId) => {
    const order = ['uploading', 'processing', 'extracting', 'success'];
    const currentIdx = order.indexOf(uploadStatus);
    const stageIdx = order.indexOf(stageId);
    if (currentIdx > stageIdx) return 'done';
    if (currentIdx === stageIdx) return 'active';
    return 'pending';
  };

  return (
    <div className="space-y-5">
      {/* Shimmer keyframes */}
      <style>{`
        @keyframes progressShimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(400%); }
        }
        @keyframes fadeSlideUp {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-slide { animation: fadeSlideUp 0.3s ease forwards; }
      `}</style>

      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#21C1B6]/20 to-[#21C1B6]/5 flex items-center justify-center flex-shrink-0 border border-[#21C1B6]/20">
          <Upload className="w-6 h-6 text-[#21C1B6]" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-gray-900">Upload Case Documents</h2>
          <p className="text-sm text-gray-500 mt-0.5">AI-powered extraction automatically fills all case details from your documents</p>
        </div>
      </div>

      {/* Drag & Drop Zone */}
      {!isUploading && uploadStatus !== 'success' && (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`relative rounded-2xl border-2 border-dashed p-8 text-center transition-all duration-300 cursor-pointer select-none
            ${isDragging
              ? 'border-[#21C1B6] bg-[#21C1B6]/5 shadow-lg shadow-[#21C1B6]/10 scale-[1.005]'
              : 'border-gray-200 bg-gradient-to-b from-gray-50 to-white hover:border-[#21C1B6]/50 hover:bg-[#21C1B6]/3'
            }`}
          onClick={handleBrowseClick}
        >
          {isDragging && (
            <div className="absolute inset-0 rounded-2xl bg-[#21C1B6]/10 flex items-center justify-center z-10">
              <div className="flex flex-col items-center gap-2">
                <div className="w-16 h-16 rounded-full bg-[#21C1B6] text-white flex items-center justify-center shadow-lg">
                  <Upload className="w-8 h-8" />
                </div>
                <p className="text-[#21C1B6] font-bold text-lg">Drop files to upload</p>
              </div>
            </div>
          )}

          <div className="flex flex-col items-center gap-4">
            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-all duration-300 ${
              isDragging ? 'bg-[#21C1B6] text-white scale-110' : 'bg-[#21C1B6]/10 text-[#21C1B6]'
            }`}>
              <FolderOpen className="w-7 h-7" />
            </div>
            <div>
              <p className="text-base font-semibold text-gray-800">Drag & drop files here</p>
              <p className="text-sm text-gray-400 mt-1">or select from your device or cloud</p>
            </div>

            <div className="flex items-center gap-3" onClick={e => e.stopPropagation()}>
              <button
                type="button"
                onClick={handleBrowseClick}
                disabled={isUploading}
                className="flex items-center gap-2 px-5 py-2.5 bg-white border border-gray-200 text-gray-700 rounded-xl hover:border-[#21C1B6] hover:text-[#21C1B6] hover:bg-[#21C1B6]/5 transition-all duration-200 font-semibold text-sm shadow-sm hover:shadow-md"
              >
                <HardDrive className="w-4 h-4" />
                Local Files
              </button>
              <span className="text-gray-300 text-sm font-medium">or</span>
              <div onClick={e => e.stopPropagation()}>
                <GoogleDrivePicker
                  onFilesSelected={handleGoogleDriveFilesSelected}
                  buttonText="Connect Drive"
                  buttonClassName="flex items-center gap-2 px-5 py-2.5 bg-white border border-gray-200 text-gray-700 rounded-xl hover:border-[#4285F4] hover:text-[#4285F4] hover:bg-blue-50/50 transition-all duration-200 font-semibold text-sm shadow-sm hover:shadow-md"
                  iconClassName="w-4 h-4"
                  multiselect={true}
                  disabled={isUploading}
                />
              </div>
            </div>
            <p className="text-xs text-gray-400">PDF • DOC • DOCX • TXT • PNG • JPG • TIFF &nbsp;|&nbsp; Multiple files supported</p>
          </div>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={handleFileChange}
        className="hidden"
        accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.tiff"
        aria-label="Select files"
      />

      {/* Selected Files */}
      {selectedFiles.length > 0 && !isUploading && uploadStatus !== 'success' && (
        <div className="animate-fade-slide">
          <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 bg-gray-50 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-gray-500" />
                <span className="text-sm font-semibold text-gray-700">
                  Selected files
                </span>
                <span className="text-xs font-semibold text-white bg-[#21C1B6] rounded-full px-2 py-0.5">
                  {selectedFiles.length}
                </span>
              </div>
              <button
                onClick={handleBrowseClick}
                className="text-xs text-[#21C1B6] font-semibold hover:text-[#1AA89E] transition-colors"
              >
                + Add more
              </button>
            </div>
            <div className="divide-y divide-gray-50 max-h-52 overflow-y-auto">
              {selectedFiles.map((file, index) => {
                const typeInfo = getFileTypeInfo(file);
                return (
                  <div key={index} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50/80 transition-colors group">
                    {file.fromGoogleDrive ? (
                      <div className="w-9 h-9 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center flex-shrink-0">
                        <Cloud className="w-4 h-4 text-[#4285F4]" />
                      </div>
                    ) : (
                      <div className={`w-9 h-9 rounded-lg ${typeInfo.bg} border ${typeInfo.border} flex items-center justify-center flex-shrink-0`}>
                        <span className={`text-xs font-bold ${typeInfo.color}`}>{typeInfo.label}</span>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{file.name}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {file.fromGoogleDrive
                          ? <span className="text-[#4285F4] font-medium">Google Drive</span>
                          : formatFileSize(file.size)}
                      </p>
                    </div>
                    <button
                      onClick={() => file.fromGoogleDrive && file.googleDriveId ? removeGoogleDriveFile(file.googleDriveId) : removeFile(index)}
                      disabled={isUploading}
                      className="opacity-0 group-hover:opacity-100 w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 transition-all duration-200 flex-shrink-0"
                      aria-label={`Remove ${file.name}`}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Upload Button */}
      {selectedFiles.length > 0 && !isUploading && uploadStatus !== 'success' && (
        <div className="flex justify-center animate-fade-slide">
          <button
            onClick={handleUploadAndExtract}
            className="group relative flex items-center gap-3 px-10 py-3.5 bg-gradient-to-r from-[#21C1B6] to-[#18a89e] text-white rounded-2xl font-bold text-sm shadow-lg shadow-[#21C1B6]/30 hover:shadow-xl hover:shadow-[#21C1B6]/40 hover:scale-105 transition-all duration-300 overflow-hidden"
          >
            <div className="absolute inset-0 bg-white/10 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700 skew-x-12" />
            <Upload className="w-5 h-5 relative z-10" />
            <span className="relative z-10">Upload & Extract Information</span>
            <Zap className="w-4 h-4 relative z-10 opacity-80" />
          </button>
        </div>
      )}

      {/* Processing Progress Panel */}
      {isUploading && (
        <div className="animate-fade-slide rounded-2xl border border-gray-100 bg-white shadow-lg overflow-hidden">
          {/* Header */}
          <div className="px-6 py-4 bg-gradient-to-r from-[#21C1B6]/8 to-transparent border-b border-gray-100">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-[#21C1B6]/15 flex items-center justify-center">
                  <Loader2 className="w-5 h-5 text-[#21C1B6] animate-spin" />
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-900">{uploadMessage}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {uploadStatus === 'uploading' && 'Securely transferring your files...'}
                    {uploadStatus === 'processing' && 'AI is reading and understanding your documents...'}
                    {uploadStatus === 'extracting' && 'Pulling case details, parties, and dates...'}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <span className="text-3xl font-black text-[#21C1B6] tabular-nums">{Math.round(processingProgress)}</span>
                <span className="text-lg font-bold text-[#21C1B6]">%</span>
              </div>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="px-6 py-3">
            <div className="relative w-full h-3 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 rounded-full transition-all duration-700 ease-out"
                style={{
                  width: `${Math.max(0, Math.min(100, processingProgress))}%`,
                  background: 'linear-gradient(90deg, #21C1B6 0%, #25d5ca 60%, #1AA89E 100%)',
                }}
              >
                <div
                  className="absolute inset-0 rounded-full"
                  style={{
                    background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.5) 50%, transparent 100%)',
                    backgroundSize: '60% 100%',
                    animation: 'progressShimmer 1.5s ease-in-out infinite',
                  }}
                />
              </div>
            </div>
          </div>

          {/* Stage Indicators */}
          <div className="px-6 pb-5">
            <div className="flex items-start justify-between relative">
              {/* Connecting line */}
              <div className="absolute top-3.5 left-[14px] right-[14px] h-px bg-gray-100 -z-0" />

              {PROCESSING_STAGES.map((stage, idx) => {
                const status = getStageStatus(stage.id);
                return (
                  <div key={stage.id} className="flex flex-col items-center gap-1.5 z-10" style={{ minWidth: 60 }}>
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center border-2 transition-all duration-500 ${
                      status === 'done'
                        ? 'bg-[#21C1B6] border-[#21C1B6] text-white shadow-md shadow-[#21C1B6]/30'
                        : status === 'active'
                        ? 'bg-white border-[#21C1B6] text-[#21C1B6] shadow-md shadow-[#21C1B6]/20 ring-2 ring-[#21C1B6]/20'
                        : 'bg-white border-gray-200 text-gray-300'
                    }`}>
                      {status === 'done'
                        ? <CheckCircle className="w-4 h-4" />
                        : status === 'active'
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <span className="text-xs font-bold">{idx + 1}</span>
                      }
                    </div>
                    <span className={`text-xs font-semibold text-center leading-tight ${
                      status === 'done' ? 'text-[#21C1B6]' :
                      status === 'active' ? 'text-gray-800' : 'text-gray-300'
                    }`}>{stage.label}</span>
                    {status === 'active' && (
                      <span className="text-[10px] text-gray-400 text-center leading-tight max-w-[60px]">{stage.description}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Success State */}
      {uploadStatus === 'success' && (
        <div className="animate-fade-slide rounded-2xl bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-200 p-5 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="w-11 h-11 rounded-xl bg-emerald-100 flex items-center justify-center flex-shrink-0">
              <CheckCircle className="w-6 h-6 text-emerald-600" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold text-emerald-900">Extraction Complete!</p>
              <p className="text-sm text-emerald-700 mt-1">{uploadMessage}</p>
              <p className="text-xs text-emerald-600 mt-2 font-medium">
                Review and edit the auto-filled fields in the next steps before submitting.
              </p>
            </div>
          </div>

          {/* Files processed summary */}
          {selectedFiles.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {selectedFiles.map((file, i) => {
                const typeInfo = getFileTypeInfo(file);
                return (
                  <div key={i} className="flex items-center gap-1.5 px-2.5 py-1 bg-white rounded-lg border border-emerald-200 shadow-sm">
                    <span className={`text-xs font-bold ${typeInfo.color}`}>{typeInfo.label}</span>
                    <span className="text-xs text-gray-600 truncate max-w-[120px]">{file.name}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Error State */}
      {uploadStatus === 'error' && (
        <div className="animate-fade-slide rounded-2xl bg-gradient-to-br from-red-50 to-rose-50 border border-red-200 p-5 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="w-11 h-11 rounded-xl bg-red-100 flex items-center justify-center flex-shrink-0">
              <AlertCircle className="w-6 h-6 text-red-500" />
            </div>
            <div>
              <p className="text-sm font-bold text-red-900">Upload Failed</p>
              <p className="text-sm text-red-700 mt-1">{uploadMessage}</p>
              <button
                onClick={() => { setUploadStatus(null); setProcessingProgress(0); setIsUploading(false); }}
                className="mt-2 text-xs text-red-600 underline font-medium hover:text-red-800 transition-colors"
              >
                Try again
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Info Note */}
      {!isUploading && uploadStatus !== 'success' && uploadStatus !== 'error' && (
        <div className="flex gap-3 p-4 bg-blue-50/60 rounded-xl border border-blue-100">
          <div className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center flex-shrink-0 mt-0.5">
            <span className="text-white text-xs font-bold">i</span>
          </div>
          <p className="text-sm text-gray-600">
            <span className="font-semibold text-gray-800">How it works: </span>
            Upload your case documents and our AI will automatically extract and populate case title, parties, court details, dates, and more. You can review and edit every field before submitting.
          </p>
        </div>
      )}
    </div>
  );
};

export default UploadStep;
