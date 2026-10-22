import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, ChevronLeft, ChevronRight, Check, ChevronDown } from 'lucide-react';
import { useAuth } from '@/shared/context';
import api from '@/shared/api/api';
import { toast } from 'react-toastify';

const ProfileSetupPopup = ({ isOpen, onClose, onComplete }) => {
  const { user } = useAuth();
  const [currentStep, setCurrentStep] = useState(1);
  const [isSaving, setIsSaving] = useState(false);
  const autoSaveTimeoutRef = useRef(null);
  
  const [fullName, setFullName] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [workEmail, setWorkEmail] = useState('');
  const [contactNumber, setContactNumber] = useState('');

  const [primaryRole, setPrimaryRole] = useState('');
  const [primaryRoleOther, setPrimaryRoleOther] = useState('');
  const [yearsOfExperience, setYearsOfExperience] = useState('');
  const [primaryJurisdictions, setPrimaryJurisdictions] = useState([]);
  const [primaryJurisdictionOther, setPrimaryJurisdictionOther] = useState('');
  const [showJurisdictionOtherInput, setShowJurisdictionOtherInput] = useState(false);
  const [areasOfPractice, setAreasOfPractice] = useState([]);
  const [areaOfPracticeOther, setAreaOfPracticeOther] = useState('');
  const [showPracticeAreaOtherInput, setShowPracticeAreaOtherInput] = useState(false);
  const [organizationType, setOrganizationType] = useState('');
  const [organizationTypeOther, setOrganizationTypeOther] = useState('');
  const [barCouncilEnrollment, setBarCouncilEnrollment] = useState('');

  const [jurisdictionSearch, setJurisdictionSearch] = useState('');
  const [practiceAreaSearch, setPracticeAreaSearch] = useState('');
  const [showJurisdictionDropdown, setShowJurisdictionDropdown] = useState(false);
  const [showPracticeAreaDropdown, setShowPracticeAreaDropdown] = useState(false);

  const jurisdictionRef = useRef(null);
  const practiceAreaRef = useRef(null);

  const [preferredTone, setPreferredTone] = useState('');
  const [verbosity, setVerbosity] = useState(5);
  const [citationStyle, setCitationStyle] = useState('');
  const [citationStyleOther, setCitationStyleOther] = useState('');
  const [myPerspective, setMyPerspective] = useState('');
  const [clientProfile, setClientProfile] = useState('');

  const [summaryHighlights, setSummaryHighlights] = useState({
    parties: false,
    keyDates: false,
    governingLaw: false,
    liabilities: false,
    obligations: false,
    caseRulings: false,
    nextSteps: false,
  });


  useEffect(() => {
    const loadProfileData = async () => {
      if (isOpen && user) {
        try {
          setFullName(user.displayName || user.username || '');
          setWorkEmail(user.email || '');
          
          const response = await api.getProfessionalProfile();
          console.log('Fetched profile data:', response);
          if (response && response.data) {
            const profile = response.data;
            console.log('Profile data to load:', profile);
            
            if (profile.fullname) {
              setFullName(profile.fullname);
            }
            if (profile.phone) {
              let phoneNumber = profile.phone.replace(/^\+91/, '');
              setContactNumber(phoneNumber);
            }
            if (profile.organization_name) {
              setOrganizationName(profile.organization_name);
            }
            
            if (profile.primary_role) {
              if (!primaryRoles.includes(profile.primary_role)) {
                setPrimaryRole('Other');
                setPrimaryRoleOther(profile.primary_role);
              } else {
                setPrimaryRole(profile.primary_role);
              }
            }
            if (profile.experience) setYearsOfExperience(profile.experience);
            if (profile.primary_jurisdiction) {
              let jurisdictions = [];
              if (Array.isArray(profile.primary_jurisdiction)) {
                jurisdictions = profile.primary_jurisdiction;
              } else if (typeof profile.primary_jurisdiction === 'string') {
                try {
                  const parsed = JSON.parse(profile.primary_jurisdiction);
                  jurisdictions = Array.isArray(parsed) ? parsed : [parsed];
                } catch {
                  let cleaned = profile.primary_jurisdiction
                    .replace(/^[\{\["']+|[\}\]"']+$/g, '')
                    .replace(/\\"/g, '"')
                    .replace(/\\,/g, ',')
                    .trim();
                  
                  if (cleaned.includes(',') || cleaned.includes('","')) {
                    const parts = cleaned.split(/","|",|,/).map(p => 
                      p.replace(/^["']+|["']+$/g, '').trim()
                    );
                    jurisdictions = parts.filter(p => p);
                  } else {
                    jurisdictions = [cleaned];
                  }
                }
              }
              jurisdictions = jurisdictions.map(j => {
                if (typeof j === 'string') {
                  return j
                    .replace(/^[\{\["']+|[\}\]"']+$/g, '')
                    .replace(/\\"/g, '"')
                    .replace(/\\,/g, ',')
                    .replace(/\\/g, '')
                    .trim();
                }
                return j;
              }).filter(j => j && j.length > 0);
              console.log('Parsed jurisdictions:', jurisdictions);
              setPrimaryJurisdictions(jurisdictions);
            }
            if (profile.main_areas_of_practice) {
              let areas = [];
              if (Array.isArray(profile.main_areas_of_practice)) {
                areas = profile.main_areas_of_practice;
              } else if (typeof profile.main_areas_of_practice === 'string') {
                try {
                  const parsed = JSON.parse(profile.main_areas_of_practice);
                  areas = Array.isArray(parsed) ? parsed : [parsed];
                } catch {
                  let cleaned = profile.main_areas_of_practice
                    .replace(/^[\{\["']+|[\}\]"']+$/g, '')
                    .replace(/\\"/g, '"')
                    .replace(/\\,/g, ',')
                    .trim();
                  
                  if (cleaned.includes(',') || cleaned.includes('","')) {
                    const parts = cleaned.split(/","|",|,/).map(p => 
                      p.replace(/^["']+|["']+$/g, '').trim()
                    );
                    areas = parts.filter(p => p);
                  } else {
                    areas = [cleaned];
                  }
                }
              }
              areas = areas.map(a => {
                if (typeof a === 'string') {
                  return a
                    .replace(/^[\{\["']+|[\}\]"']+$/g, '')
                    .replace(/\\"/g, '"')
                    .replace(/\\,/g, ',')
                    .replace(/\\/g, '')
                    .trim();
                }
                return a;
              }).filter(a => a && a.length > 0);
              console.log('Parsed practice areas:', areas);
              setAreasOfPractice(areas);
            }
            if (profile.organization_type) {
              if (!organizationTypes.includes(profile.organization_type)) {
                setOrganizationType('Other');
                setOrganizationTypeOther(profile.organization_type);
              } else {
                setOrganizationType(profile.organization_type);
              }
            }
            if (profile.bar_enrollment_number) setBarCouncilEnrollment(profile.bar_enrollment_number);
            
            if (profile.preferred_tone) setPreferredTone(profile.preferred_tone);
            if (profile.preferred_detail_level !== undefined) {
              setVerbosity(parseInt(profile.preferred_detail_level) || 5);
            }
            if (profile.citation_style) {
              const citationStyleValues = citationStyles.map(s => s.value);
              if (!citationStyleValues.includes(profile.citation_style)) {
                setCitationStyle('other');
                setCitationStyleOther(profile.citation_style);
              } else {
                setCitationStyle(profile.citation_style);
              }
            }
            if (profile.perspective) setMyPerspective(profile.perspective);
            if (profile.typical_client) setClientProfile(profile.typical_client);
            
            if (profile.highlights_in_summary) {
              let highlightsData = profile.highlights_in_summary;
              
              if (typeof highlightsData === 'string') {
                try {
                  highlightsData = JSON.parse(highlightsData);
                } catch (e) {
                  console.error('Error parsing highlights_in_summary:', e);
                  highlightsData = null;
                }
              }
              
              if (highlightsData && typeof highlightsData === 'object') {
                setSummaryHighlights({
                  parties: highlightsData.parties || false,
                  keyDates: highlightsData.keyDates || highlightsData.key_dates || false,
                  governingLaw: highlightsData.governingLaw || highlightsData.governing_law || false,
                  liabilities: highlightsData.liabilities || false,
                  obligations: highlightsData.obligations || false,
                  caseRulings: highlightsData.caseRulings || highlightsData.case_rulings || false,
                  nextSteps: highlightsData.nextSteps || highlightsData.next_steps || false,
                });
              }
            }
          }
        } catch (error) {
          console.error('Error loading profile data:', error);
        }
      }
    };
    
    loadProfileData();
  }, [user, isOpen]);


  const primaryRoles = [
    'Attorney',
    'Paralegal',
    'Legal Consultant',
    'In-House Counsel',
    'Law Student',
    'Legal Researcher',
    'Other'
  ];

  const experienceOptions = ['0-1', '2-5', '6-10', '11-15', '16-20', '21+'];

  const jurisdictions = [
    'United States',
    'United Kingdom',
    'Canada',
    'Australia',
    'India',
    'Germany',
    'France',
    'Singapore',
    'Hong Kong',
    'Japan',
    'Brazil',
    'Mexico',
    'South Africa',
    'Nigeria',
    'Kenya',
    'UAE',
    'Saudi Arabia',
    'Other'
  ];

  const practiceAreas = [
    'Corporate Law',
    'Criminal Law',
    'Family Law',
    'Immigration Law',
    'Intellectual Property',
    'Employment Law',
    'Real Estate Law',
    'Tax Law',
    'Contract Law',
    'Litigation',
    'Regulatory Compliance',
    'Mergers & Acquisitions',
    'Securities Law',
    'Banking & Finance',
    'Environmental Law',
    'Healthcare Law',
    'Technology Law',
    'International Law',
    'Constitutional Law',
    'Administrative Law',
    'Other'
  ];

  const organizationTypes = [
    'Law Firm',
    'Corporate Legal Department',
    'Government Agency',
    'Non-Profit Organization',
    'Solo Practice',
    'Legal Tech Company',
    'Academic Institution',
    'Other'
  ];

  const toneOptions = [
    { value: 'professional', label: 'Professional' },
    { value: 'formal', label: 'Formal' },
    { value: 'conversational', label: 'Conversational' },
    { value: 'concise', label: 'Concise' }
  ];

  const languages = [
    'English',
    'Spanish',
    'French',
    'German',
    'Mandarin',
    'Japanese',
    'Hindi',
    'Arabic',
    'Portuguese',
    'Other'
  ];

  const citationStyles = [
    { value: 'bluebook', label: 'Bluebook' },
    { value: 'apa', label: 'APA' },
    { value: 'mla', label: 'MLA' },
    { value: 'chicago', label: 'Chicago' },
    { value: 'oscola', label: 'OSCOLA' },
    { value: 'aglc', label: 'AGLC' },
    { value: 'other', label: 'Other' }
  ];

  const indianStateCodes = [
    { code: '011', state: 'Delhi' },
    { code: '022', state: 'Mumbai, Maharashtra' },
    { code: '020', state: 'Pune, Maharashtra' },
    { code: '080', state: 'Bangalore, Karnataka' },
    { code: '044', state: 'Chennai, Tamil Nadu' },
    { code: '033', state: 'Kolkata, West Bengal' },
    { code: '040', state: 'Hyderabad, Telangana' },
    { code: '079', state: 'Ahmedabad, Gujarat' },
    { code: '0141', state: 'Jaipur, Rajasthan' },
    { code: '0522', state: 'Lucknow, Uttar Pradesh' },
    { code: '0120', state: 'Noida, Uttar Pradesh' },
    { code: '0124', state: 'Gurgaon, Haryana' },
    { code: '0172', state: 'Chandigarh' },
    { code: '0175', state: 'Patiala, Punjab' },
    { code: '0181', state: 'Amritsar, Punjab' },
    { code: '0261', state: 'Surat, Gujarat' },
    { code: '0265', state: 'Vadodara, Gujarat' },
    { code: '0312', state: 'Bhubaneswar, Odisha' },
    { code: '0361', state: 'Guwahati, Assam' },
    { code: '0422', state: 'Coimbatore, Tamil Nadu' },
    { code: '0484', state: 'Kochi, Kerala' },
    { code: '0512', state: 'Kanpur, Uttar Pradesh' },
    { code: '0612', state: 'Patna, Bihar' },
    { code: '0712', state: 'Nagpur, Maharashtra' },
    { code: '0755', state: 'Bhopal, Madhya Pradesh' },
    { code: '0761', state: 'Raipur, Chhattisgarh' },
    { code: '0821', state: 'Mysore, Karnataka' },
    { code: '0832', state: 'Goa' },
    { code: '0851', state: 'Ranchi, Jharkhand' },
    { code: '0891', state: 'Visakhapatnam, Andhra Pradesh' }
  ];



  useEffect(() => {
    const handleClickOutside = (event) => {
      if (jurisdictionRef.current && !jurisdictionRef.current.contains(event.target)) {
        setShowJurisdictionDropdown(false);
      }
      if (practiceAreaRef.current && !practiceAreaRef.current.contains(event.target)) {
        setShowPracticeAreaDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredJurisdictions = jurisdictions.filter(j =>
    j.toLowerCase().includes(jurisdictionSearch.toLowerCase())
  );

  const filteredPracticeAreas = practiceAreas.filter(p =>
    p.toLowerCase().includes(practiceAreaSearch.toLowerCase())
  );

  const handleJurisdictionSelect = (jurisdiction) => {
    if (jurisdiction === 'Other') {
      setShowJurisdictionDropdown(false);
      setShowJurisdictionOtherInput(true);
      return;
    }
    if (!primaryJurisdictions.includes(jurisdiction)) {
      setPrimaryJurisdictions([...primaryJurisdictions, jurisdiction]);
    }
    setJurisdictionSearch('');
    setShowJurisdictionDropdown(false);
  };

  const handleAddCustomJurisdiction = () => {
    if (primaryJurisdictionOther.trim() && !primaryJurisdictions.includes(primaryJurisdictionOther.trim())) {
      setPrimaryJurisdictions([...primaryJurisdictions, primaryJurisdictionOther.trim()]);
      setPrimaryJurisdictionOther('');
      setShowJurisdictionOtherInput(false);
    }
  };

  const removeJurisdiction = (jurisdiction) => {
    setPrimaryJurisdictions(primaryJurisdictions.filter(j => j !== jurisdiction));
  };

  const handlePracticeAreaSelect = (area) => {
    if (area === 'Other') {
      setShowPracticeAreaDropdown(false);
      setShowPracticeAreaOtherInput(true);
      return;
    }
    if (!areasOfPractice.includes(area)) {
      setAreasOfPractice([...areasOfPractice, area]);
    }
    setPracticeAreaSearch('');
    setShowPracticeAreaDropdown(false);
  };

  const handleAddCustomPracticeArea = () => {
    if (areaOfPracticeOther.trim() && !areasOfPractice.includes(areaOfPracticeOther.trim())) {
      setAreasOfPractice([...areasOfPractice, areaOfPracticeOther.trim()]);
      setAreaOfPracticeOther('');
      setShowPracticeAreaOtherInput(false);
    }
  };

  const removePracticeArea = (area) => {
    setAreasOfPractice(areasOfPractice.filter(a => a !== area));
  };

  const toggleHighlight = (key) => {
    setSummaryHighlights(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const autoSave = useCallback(async (skipToast = false) => {
    try {
      const cleanedJurisdictions = primaryJurisdictions.map(j => {
        if (typeof j === 'string') {
          return j.replace(/^[\{\["']+|[\}\]"']+$/g, '').trim();
        }
        return j;
      }).filter(j => j);
      
      const cleanedPracticeAreas = areasOfPractice.map(a => {
        if (typeof a === 'string') {
          return a.replace(/^[\{\["']+|[\}\]"']+$/g, '').trim();
        }
        return a;
      }).filter(a => a);
      
      const fullPhoneNumber = contactNumber ? `+91${contactNumber}` : undefined;
      
      const profileData = {
        ...(fullPhoneNumber && { phone: fullPhoneNumber }),
        
        is_profile_completed: true,
        organization_name: organizationName || undefined,
        primary_role: primaryRole === 'Other' ? primaryRoleOther : (primaryRole || undefined),
        experience: yearsOfExperience || undefined,
        primary_jurisdiction: cleanedJurisdictions.length > 0 ? cleanedJurisdictions : undefined,
        main_areas_of_practice: cleanedPracticeAreas.length > 0 ? cleanedPracticeAreas : undefined,
        organization_type: organizationType === 'Other' ? organizationTypeOther : (organizationType || undefined),
        bar_enrollment_number: barCouncilEnrollment || undefined,
        preferred_tone: preferredTone || undefined,
        preferred_detail_level: verbosity || undefined,
        citation_style: citationStyle === 'other' ? citationStyleOther : (citationStyle || undefined),
        perspective: myPerspective || undefined,
        typical_client: clientProfile || undefined,
        highlights_in_summary: summaryHighlights || undefined,
      };

      const isProfileCompleted = profileData.is_profile_completed;
      Object.keys(profileData).forEach(key => {
        if (profileData[key] === undefined || profileData[key] === '') {
          delete profileData[key];
        }
        if (Array.isArray(profileData[key]) && profileData[key].length === 0) {
          delete profileData[key];
        }
      });
      
      profileData.is_profile_completed = isProfileCompleted !== undefined ? isProfileCompleted : true;

      if (Object.keys(profileData).length > 1 || profileData.is_profile_completed) {
        await api.updateProfessionalProfile(profileData);
        if (!skipToast) {
          console.log('Profile auto-saved');
        }
      }
    } catch (error) {
      console.error('Error auto-saving profile:', error);
    }
  }, [
    contactNumber, organizationName, primaryRole, primaryRoleOther,
    yearsOfExperience, primaryJurisdictions,
    areasOfPractice, organizationType, organizationTypeOther,
    barCouncilEnrollment, preferredTone, verbosity, citationStyle, citationStyleOther,
    myPerspective, clientProfile, summaryHighlights
  ]);

  const debouncedAutoSave = useCallback(() => {
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }
    autoSaveTimeoutRef.current = setTimeout(() => {
      autoSave(true);
    }, 2000);
  }, [autoSave]);

  useEffect(() => {
    if (isOpen) {
      debouncedAutoSave();
    }
    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
    };
  }, [
    contactNumber, organizationName, primaryRole, primaryRoleOther,
    yearsOfExperience, primaryJurisdictions,
    areasOfPractice, organizationType, organizationTypeOther,
    barCouncilEnrollment, preferredTone, verbosity, citationStyle, citationStyleOther,
    myPerspective, clientProfile, summaryHighlights, isOpen, debouncedAutoSave
  ]);


  const handleNext = async () => {
    await autoSave(true);
    if (currentStep < 4) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleSkip = async () => {
    await autoSave(true);
    if (onComplete) {
      onComplete();
    }
    onClose();
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const cleanedJurisdictions = primaryJurisdictions.map(j => {
        if (typeof j === 'string') {
          return j.replace(/^[\{\["']+|[\}\]"']+$/g, '').trim();
        }
        return j;
      }).filter(j => j);
      
      const cleanedPracticeAreas = areasOfPractice.map(a => {
        if (typeof a === 'string') {
          return a.replace(/^[\{\["']+|[\}\]"']+$/g, '').trim();
        }
        return a;
      }).filter(a => a);
      
      const fullPhoneNumber = contactNumber ? `+91${contactNumber}` : undefined;
      
      const profileData = {
        ...(fullPhoneNumber && { phone: fullPhoneNumber }),
        is_profile_completed: true,
        organization_name: organizationName || undefined,
        primary_role: primaryRole === 'Other' ? primaryRoleOther : (primaryRole || undefined),
        experience: yearsOfExperience || undefined,
        primary_jurisdiction: cleanedJurisdictions.length > 0 ? cleanedJurisdictions : undefined,
        main_areas_of_practice: cleanedPracticeAreas.length > 0 ? cleanedPracticeAreas : undefined,
        organization_type: organizationType === 'Other' ? organizationTypeOther : (organizationType || undefined),
        bar_enrollment_number: barCouncilEnrollment || undefined,
        preferred_tone: preferredTone || undefined,
        preferred_detail_level: verbosity || undefined,
        citation_style: citationStyle === 'other' ? citationStyleOther : (citationStyle || undefined),
        perspective: myPerspective || undefined,
        typical_client: clientProfile || undefined,
        highlights_in_summary: summaryHighlights || undefined,
      };

      const isProfileCompleted = profileData.is_profile_completed;
      Object.keys(profileData).forEach(key => {
        if (profileData[key] === undefined || profileData[key] === '') {
          delete profileData[key];
        }
        if (Array.isArray(profileData[key]) && profileData[key].length === 0) {
          delete profileData[key];
        }
      });
      profileData.is_profile_completed = isProfileCompleted !== undefined ? isProfileCompleted : true;

      console.log('Saving profile data:', profileData);
      await api.updateProfessionalProfile(profileData);
      
      toast.success('Profile setup completed successfully!');
      
      if (onComplete) {
        onComplete();
      }
      onClose();
    } catch (error) {
      console.error('Error saving profile:', error);
      const errorMessage = error.response?.data?.message || error.message || 'Failed to save profile. Please try again.';
      toast.error(errorMessage);
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  const StepIndicator = () => (
    <div className="flex items-center justify-center mb-8">
      {[1, 2, 3, 4].map((step) => (
        <React.Fragment key={step}>
          <div className="flex items-center">
            <div
              className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold transition-all duration-300 ${
                step === currentStep
                  ? 'bg-[#21C1B6] text-white scale-110 shadow-lg'
                  : step < currentStep
                  ? 'bg-green-500 text-white'
                  : 'bg-gray-200 text-gray-500'
              }`}
            >
              {step < currentStep ? <Check className="w-5 h-5" /> : step}
            </div>
            {step < 4 && (
              <div
                className={`w-16 h-1 mx-2 transition-all duration-300 ${
                  step < currentStep ? 'bg-green-500' : 'bg-gray-200'
                }`}
              />
            )}
          </div>
        </React.Fragment>
      ))}
    </div>
  );

  const renderStep1 = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-xl font-semibold text-gray-900 mb-2">Basic Information</h3>
        <p className="text-sm text-gray-600">Let's start with your basic details</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Full Name <span className="text-gray-400">(pre-filled)</span>
        </label>
        <input
          type="text"
          value={fullName}
          readOnly
          className="w-full px-4 py-2.5 border border-gray-300 rounded-lg bg-gray-50 text-gray-600 cursor-not-allowed focus:outline-none"
          placeholder="Full Name"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Organization Name
        </label>
        <input
          type="text"
          value={organizationName}
          onChange={(e) => setOrganizationName(e.target.value)}
          className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent transition-all text-black"
          placeholder="Enter your organization name"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Work Email <span className="text-gray-400">(pre-filled)</span>
        </label>
        <input
          type="email"
          value={workEmail}
          readOnly
          className="w-full px-4 py-2.5 border border-gray-300 rounded-lg bg-gray-50 text-gray-600 cursor-not-allowed focus:outline-none"
          placeholder="work@example.com"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Contact Number
        </label>
        <div className="flex gap-2">
          <div className="flex items-center px-3 py-2.5 border border-gray-300 rounded-lg bg-gray-50 text-gray-600">
            +91
          </div>
          <input
            type="tel"
            value={contactNumber}
            onChange={(e) => setContactNumber(e.target.value.replace(/\D/g, ''))}
            className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent transition-all text-black"
            placeholder="Phone number"
          />
        </div>
      </div>
    </div>
  );

  const renderStep2 = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-xl font-semibold text-gray-900 mb-2">Professional Details</h3>
        <p className="text-sm text-gray-600">Tell us about your legal practice</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Primary Role
        </label>
        <select
          value={primaryRole}
          onChange={(e) => {
            setPrimaryRole(e.target.value);
            if (e.target.value !== 'Other') setPrimaryRoleOther('');
          }}
          className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent bg-white text-black"
        >
          <option value="" className="text-black">Select your role</option>
          {primaryRoles.map((role) => (
            <option key={role} value={role} className="text-black">
              {role}
            </option>
          ))}
        </select>
        {primaryRole === 'Other' && (
          <input
            type="text"
            value={primaryRoleOther}
            onChange={(e) => setPrimaryRoleOther(e.target.value)}
            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent mt-2 text-black"
            placeholder="Please specify your role"
          />
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Years of Experience
        </label>
        <div className="flex gap-2 flex-wrap">
          {experienceOptions.map((exp) => (
            <button
              key={exp}
              type="button"
              onClick={() => setYearsOfExperience(exp)}
              className={`px-4 py-2 rounded-lg font-medium transition-all ${
                yearsOfExperience === exp
                  ? 'bg-[#21C1B6] text-white shadow-md'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {exp === '21+' ? '21+' : exp} {exp !== '21+' && 'years'}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Primary Jurisdiction(s)
        </label>
        <div className="relative" ref={jurisdictionRef}>
          <div className="relative">
            <input
              type="text"
              value={jurisdictionSearch}
              onChange={(e) => {
                setJurisdictionSearch(e.target.value);
                setShowJurisdictionDropdown(true);
              }}
              onFocus={() => setShowJurisdictionDropdown(true)}
              className="w-full px-4 py-2.5 pr-10 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-black"
              placeholder="Search and select jurisdictions"
            />
            <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" />
          </div>
          {showJurisdictionDropdown && (
            <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
              {filteredJurisdictions.length > 0 ? (
                filteredJurisdictions.map((jurisdiction) => (
                  <button
                    key={jurisdiction}
                    type="button"
                    onClick={() => handleJurisdictionSelect(jurisdiction)}
                    className="w-full px-4 py-2 text-left hover:bg-gray-100 transition-colors text-black"
                  >
                    {jurisdiction}
                  </button>
                ))
              ) : (
                <div className="px-4 py-2 text-gray-500">No jurisdictions found</div>
              )}
            </div>
          )}
        </div>
        {showJurisdictionOtherInput && (
          <div className="mt-2 flex gap-2">
            <input
              type="text"
              value={primaryJurisdictionOther}
              onChange={(e) => setPrimaryJurisdictionOther(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddCustomJurisdiction();
                }
              }}
              onBlur={handleAddCustomJurisdiction}
              className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-black"
              placeholder="Enter custom jurisdiction"
            />
            <button
              type="button"
              onClick={handleAddCustomJurisdiction}
              className="px-4 py-2.5 bg-[#21C1B6] text-white rounded-lg hover:bg-[#1AA49B] transition-colors"
            >
              Add
            </button>
          </div>
        )}
        {primaryJurisdictions.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {primaryJurisdictions.map((jurisdiction) => {
              const cleanValue = typeof jurisdiction === 'string' 
                ? jurisdiction.replace(/^[\{\["']+|[\}\]"']+$/g, '').trim()
                : jurisdiction;
              return (
                <span
                  key={jurisdiction}
                  className="inline-flex items-center gap-1 px-3 py-1 bg-[#21C1B6] text-white rounded-full text-sm"
                >
                  {cleanValue}
                  <button
                    type="button"
                    onClick={() => removeJurisdiction(jurisdiction)}
                    className="hover:text-gray-200"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </span>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Areas of Practice
        </label>
        <div className="relative" ref={practiceAreaRef}>
          <div className="relative">
            <input
              type="text"
              value={practiceAreaSearch}
              onChange={(e) => {
                setPracticeAreaSearch(e.target.value);
                setShowPracticeAreaDropdown(true);
              }}
              onFocus={() => setShowPracticeAreaDropdown(true)}
              className="w-full px-4 py-2.5 pr-10 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-black"
              placeholder="Search and select practice areas"
            />
            <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" />
          </div>
          {showPracticeAreaDropdown && (
            <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
              {filteredPracticeAreas.length > 0 ? (
                filteredPracticeAreas.map((area) => (
                  <button
                    key={area}
                    type="button"
                    onClick={() => handlePracticeAreaSelect(area)}
                    className="w-full px-4 py-2 text-left hover:bg-gray-100 transition-colors text-black"
                  >
                    {area}
                  </button>
                ))
              ) : (
                <div className="px-4 py-2 text-gray-500">No practice areas found</div>
              )}
            </div>
          )}
        </div>
        {showPracticeAreaOtherInput && (
          <div className="mt-2 flex gap-2">
            <input
              type="text"
              value={areaOfPracticeOther}
              onChange={(e) => setAreaOfPracticeOther(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddCustomPracticeArea();
                }
              }}
              onBlur={handleAddCustomPracticeArea}
              className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-black"
              placeholder="Enter custom practice area"
            />
            <button
              type="button"
              onClick={handleAddCustomPracticeArea}
              className="px-4 py-2.5 bg-[#21C1B6] text-white rounded-lg hover:bg-[#1AA49B] transition-colors"
            >
              Add
            </button>
          </div>
        )}
        {areasOfPractice.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {areasOfPractice.map((area) => {
              const cleanValue = typeof area === 'string' 
                ? area.replace(/^[\{\["']+|[\}\]"']+$/g, '').trim()
                : area;
              return (
                <span
                  key={area}
                  className="inline-flex items-center gap-1 px-3 py-1 bg-[#21C1B6] text-white rounded-full text-sm"
                >
                  {cleanValue}
                  <button
                    type="button"
                    onClick={() => removePracticeArea(area)}
                    className="hover:text-gray-200"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </span>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Organization Type
        </label>
        <select
          value={organizationType}
          onChange={(e) => {
            setOrganizationType(e.target.value);
            if (e.target.value !== 'Other') setOrganizationTypeOther('');
          }}
          className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent bg-white text-black"
        >
          <option value="" className="text-black">Select organization type</option>
          {organizationTypes.map((type) => (
            <option key={type} value={type} className="text-black">
              {type}
            </option>
          ))}
        </select>
        {organizationType === 'Other' && (
          <input
            type="text"
            value={organizationTypeOther}
            onChange={(e) => setOrganizationTypeOther(e.target.value)}
            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent mt-2 text-black"
            placeholder="Please specify organization type"
          />
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Bar Council Enrollment Number <span className="text-gray-400">(optional)</span>
        </label>
        <input
          type="text"
          value={barCouncilEnrollment}
          onChange={(e) => setBarCouncilEnrollment(e.target.value)}
          className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent transition-all text-black"
          placeholder="Enter your bar council enrollment number"
        />
      </div>
    </div>
  );

  const renderStep3 = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-xl font-semibold text-gray-900 mb-2">AI Persona Settings</h3>
        <p className="text-sm text-gray-600">Customize how AI interacts with you</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-3">
          Preferred Tone of Voice
        </label>
        <div className="space-y-2">
          {toneOptions.map((tone) => (
            <label
              key={tone.value}
              className="flex items-center p-3 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
            >
              <input
                type="radio"
                name="tone"
                value={tone.value}
                checked={preferredTone === tone.value}
                onChange={(e) => setPreferredTone(e.target.value)}
                className="w-4 h-4 text-[#21C1B6] focus:ring-[#21C1B6]"
              />
              <span className="ml-3 text-gray-700">{tone.label}</span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-3">
          Verbosity / Detail Level: {verbosity}/10
        </label>
        <input
          type="range"
          min="1"
          max="10"
          value={verbosity}
          onChange={(e) => setVerbosity(parseInt(e.target.value))}
          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#21C1B6]"
        />
        <div className="flex justify-between text-xs text-gray-500 mt-1">
          <span>Concise</span>
          <span>Detailed</span>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-3">
          Preferred Citation Style
        </label>
        <div className="space-y-2">
          {citationStyles.map((style) => (
            <label
              key={style.value}
              className="flex items-center p-3 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
            >
              <input
                type="radio"
                name="citation"
                value={style.value}
                checked={citationStyle === style.value}
                onChange={(e) => {
                  setCitationStyle(e.target.value);
                  if (e.target.value !== 'other') setCitationStyleOther('');
                }}
                className="w-4 h-4 text-[#21C1B6] focus:ring-[#21C1B6]"
              />
              <span className="ml-3 text-gray-700">{style.label}</span>
            </label>
          ))}
        </div>
        {citationStyle === 'other' && (
          <input
            type="text"
            value={citationStyleOther}
            onChange={(e) => setCitationStyleOther(e.target.value)}
            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent mt-2 text-black"
            placeholder="Please specify citation style"
          />
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          My Perspective
        </label>
        <textarea
          value={myPerspective}
          onChange={(e) => setMyPerspective(e.target.value)}
          rows={4}
          className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent transition-all resize-none text-black"
          placeholder="Describe your legal perspective, approach, or philosophy..."
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          My Typical Client Profile
        </label>
        <textarea
          value={clientProfile}
          onChange={(e) => setClientProfile(e.target.value)}
          rows={4}
          className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent transition-all resize-none text-black"
          placeholder="Describe the types of clients you typically work with..."
        />
      </div>
    </div>
  );

  const renderStep4 = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-xl font-semibold text-gray-900 mb-2">Feature Preferences</h3>
        <p className="text-sm text-gray-600">Choose what to highlight in summaries</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-3">
          Always highlight these in summaries:
        </label>
        <div className="space-y-2">
          {Object.entries({
            parties: 'Parties',
            keyDates: 'Key Dates',
            governingLaw: 'Governing Law',
            liabilities: 'Liabilities',
            obligations: 'Obligations',
            caseRulings: 'Case Rulings',
            nextSteps: 'Next Steps'
          }).map(([key, label]) => (
            <label
              key={key}
              className="flex items-center p-3 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
            >
              <input
                type="checkbox"
                checked={summaryHighlights[key]}
                onChange={() => toggleHighlight(key)}
                className="w-4 h-4 text-[#21C1B6] rounded focus:ring-[#21C1B6]"
              />
              <span className="ml-3 text-gray-700">{label}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col animate-fadeIn">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Complete Your Profile</h2>
            <p className="text-sm text-gray-600 mt-1">Step {currentStep} of 4</p>
          </div>
          <button
            onClick={async () => {
              await autoSave(true);
              onClose();
            }}
            className="text-gray-400 hover:text-gray-600 transition-colors p-2 hover:bg-gray-100 rounded-lg"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 pt-6">
          <StepIndicator />
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-6">
          {currentStep === 1 && renderStep1()}
          {currentStep === 2 && renderStep2()}
          {currentStep === 3 && renderStep3()}
          {currentStep === 4 && renderStep4()}
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-gray-50">
          <button
            onClick={handleSkip}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors"
          >
            Skip
          </button>
          <div className="flex gap-3">
            {currentStep > 1 && (
              <button
                onClick={handleBack}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
                Back
              </button>
            )}
            {currentStep < 4 ? (
              <button
                onClick={handleNext}
                className="flex items-center gap-2 px-6 py-2 text-sm font-medium text-white bg-[#21C1B6] rounded-lg hover:bg-[#1AA49B] transition-colors shadow-md hover:shadow-lg"
              >
                Continue
                <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="px-6 py-2 text-sm font-medium text-white bg-[#21C1B6] rounded-lg hover:bg-[#1AA49B] transition-colors shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSaving ? 'Saving...' : 'Save & Finish'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProfileSetupPopup;

