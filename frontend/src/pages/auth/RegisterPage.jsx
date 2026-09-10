import React, { useState, useEffect } from 'react';
import { Eye, EyeOff, Check, X, Loader2, ArrowLeft } from 'lucide-react';
import ApiService from '../../services/api';
import TermsAndConditions from '../../components/TermsAndConditions';
import JuriNexLogo from '../../assets/jurinex-wordmark.png';
import AdvocateImage from '../../assets/advocate.png';
import { AUTH_SERVICE_URL } from '../../config/apiConfig';

const RegisterPage = () => {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [roleId, setRoleId] = useState('');
  const [roles, setRoles] = useState([]);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [consentData, setConsentData] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [validationErrors, setValidationErrors] = useState({});
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [logoError, setLogoError] = useState(false);

  useEffect(() => {
    setRolesLoading(true);
    fetch(`${AUTH_SERVICE_URL}/api/auth/roles`)
      .then((r) => r.json())
      .then((data) => setRoles(data.roles || []))
      .catch(() => setRoles([]))
      .finally(() => setRolesLoading(false));
  }, []);

  const LogoComponent = ({ size = 'w-12 h-12 sm:w-14 sm:h-14 md:w-16 md:h-16' }) => {
    if (logoError) {
      return (
        <div className={`${size} rounded-lg flex items-center justify-center`} style={{ backgroundColor: '#1AA49B' }}>
          <svg className="w-7 h-7 text-white" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3 3h8l4 4-4 4H3V3zm10 10h8v8h-8l-4-4 4-4z" />
          </svg>
        </div>
      );
    }
    return (
      <img
        src={JuriNexLogo}
        alt="JURINEX"
        className="h-10 sm:h-11 md:h-12 w-auto object-contain"
        onError={() => setLogoError(true)}
        onLoad={() => setLogoError(false)}
      />
    );
  };

  const getPasswordStrength = (pwd) => {
    const s = {
      length: pwd.length >= 8,
      uppercase: /[A-Z]/.test(pwd),
      number: /[0-9]/.test(pwd),
      specialChar: /[!@#$%^&*(),.?":{}|<>]/.test(pwd),
    };
    const count = Object.values(s).filter(Boolean).length;
    let level = 'Weak';
    if (count === 4) level = 'Strong';
    else if (count >= 2) level = 'Medium';
    return { ...s, level, count };
  };
  const passwordStrength = getPasswordStrength(password);

  const validateForm = () => {
    const e = {};
    if (!fullName.trim()) e.fullName = 'Full name is required';
    if (!email.trim()) e.email = 'Email is required';
    else if (!/\S+@\S+\.\S+/.test(email)) e.email = 'Email is invalid';
    if (!phone.trim()) e.phone = 'Mobile number is required';
    else if (!/^\+?[\d\s\-]{7,15}$/.test(phone.trim())) e.phone = 'Enter a valid mobile number';
    if (!roleId) e.domainRole = 'Please select your professional role';
    if (!password) e.password = 'Password is required';
    else if (passwordStrength.count < 4) e.password = 'Password must meet all requirements';
    if (!confirmPassword) e.confirmPassword = 'Please confirm your password';
    else if (password !== confirmPassword) e.confirmPassword = 'Passwords do not match';
    if (!termsAccepted) e.agreeTerms = 'You must accept the Terms & Conditions';
    if (!consentData) e.consentData = 'You must consent to data processing';
    setValidationErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleTermsCheckboxClick = (e) => {
    e.preventDefault();
    if (!termsAccepted) {
      setShowTermsModal(true);
    } else {
      setAgreeTerms(false);
      setTermsAccepted(false);
    }
  };

  const handleAcceptTerms = () => {
    setTermsAccepted(true);
    setAgreeTerms(true);
    setShowTermsModal(false);
  };

  const go = (path) => {
    if (window.history?.pushState) {
      window.history.pushState({}, '', path);
      window.dispatchEvent(new PopStateEvent('popstate'));
    } else {
      window.location.href = path;
    }
  };

  const handleBackToHome = () => go('/');
  const handleLoginClick = (e) => {
    e.preventDefault();
    go('/login');
  };

  const handleRegister = async () => {
    setError('');
    setValidationErrors({});
    if (!validateForm()) return;
    setIsLoading(true);
    try {
      const data = await ApiService.register({
        username: fullName,
        email,
        password,
        phone,
        role_id: roleId,
      });
      if (data.token) localStorage.setItem('token', data.token);
      alert('Registration successful! Redirecting to login...');
      go('/login');
    } catch (err) {
      setError(err.message || 'Registration failed');
    } finally {
      setIsLoading(false);
    }
  };

  const inputClass =
    'w-full px-3 sm:px-4 py-2 sm:py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1AA49B] transition text-xs sm:text-sm text-gray-900 bg-white';

  return (
    <>
      <div className="min-h-screen flex flex-col lg:flex-row font-sans">
        {/* Left — form */}
        <div className="w-full lg:w-1/2 bg-white flex items-start justify-center p-4 sm:p-6 md:p-8 lg:p-12">
          <div className="max-w-md w-full py-8">
            <div className="flex justify-center mb-6">
              <LogoComponent />
            </div>

            <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2 text-center">
              Welcome to JuriNex
            </h2>
            <p className="text-gray-500 mb-6 text-center text-xs sm:text-sm">
              Create your account to get started
            </p>

            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-xs sm:text-sm text-red-600">{error}</p>
              </div>
            )}

            <div className="space-y-4">
              {/* Full Name */}
              <div>
                <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1">Full Name</label>
                <input
                  type="text"
                  placeholder="Enter your full name"
                  className={inputClass}
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                />
                {validationErrors.fullName && <p className="text-xs text-red-600 mt-1">{validationErrors.fullName}</p>}
              </div>

              {/* Email */}
              <div>
                <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1">Email Address</label>
                <input
                  type="email"
                  placeholder="Enter your email address"
                  className={inputClass}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                {validationErrors.email && <p className="text-xs text-red-600 mt-1">{validationErrors.email}</p>}
              </div>

              {/* Mobile Number */}
              <div>
                <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1">Mobile Number</label>
                <input
                  type="tel"
                  placeholder="+91 98765 43210"
                  className={inputClass}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
                {validationErrors.phone && <p className="text-xs text-red-600 mt-1">{validationErrors.phone}</p>}
              </div>

              {/* Professional Role */}
              <div>
                <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1">Professional Role</label>
                <select
                  value={roleId}
                  onChange={(e) => setRoleId(e.target.value)}
                  className={inputClass}
                  style={{ borderColor: validationErrors.domainRole ? '#ef4444' : undefined }}
                  disabled={rolesLoading}
                >
                  <option value="">{rolesLoading ? 'Loading roles...' : 'Select your professional role'}</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
                {validationErrors.domainRole && <p className="text-xs text-red-600 mt-1">{validationErrors.domainRole}</p>}
              </div>

              {/* Password */}
              <div>
                <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1">Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="***********"
                    className={`${inputClass} pr-10`}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>

                {password && (
                  <>
                    <div className="flex gap-1 mt-2">
                      {[1, 2, 3, 4].map((i) => (
                        <div
                          key={i}
                          className="h-1 flex-1 rounded transition-colors"
                          style={{ backgroundColor: passwordStrength.count >= i ? (i === 4 ? '#10B981' : '#21C1B6') : '#E5E7EB' }}
                        />
                      ))}
                    </div>
                    <p className="text-xs text-gray-600 mt-1 text-right">{passwordStrength.level}</p>
                    <div className="mt-2 space-y-1">
                      {[
                        { cond: passwordStrength.length, txt: 'At least 8 characters' },
                        { cond: passwordStrength.uppercase, txt: 'Contains an uppercase letter' },
                        { cond: passwordStrength.number, txt: 'Contains a number' },
                        { cond: passwordStrength.specialChar, txt: 'Contains a special character (!@#$%^&*)' },
                      ].map((r, i) => (
                        <div key={i} className={`flex items-center text-xs ${r.cond ? 'text-green-600' : 'text-gray-500'}`}>
                          {r.cond ? <Check size={12} className="mr-1.5" /> : <X size={12} className="mr-1.5" />}
                          {r.txt}
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {validationErrors.password && <p className="text-xs text-red-600 mt-1">{validationErrors.password}</p>}
              </div>

              {/* Confirm Password */}
              <div>
                <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1">Confirm Password</label>
                <div className="relative">
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    placeholder="Enter password again"
                    className={`${inputClass} pr-10`}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {validationErrors.confirmPassword && <p className="text-xs text-red-600 mt-1">{validationErrors.confirmPassword}</p>}
              </div>

              {/* Checkboxes */}
              <div className="space-y-2 pt-1">
                <div className="flex items-start">
                  <input
                    type="checkbox"
                    id="agreeTerms"
                    className="h-3.5 w-3.5 mt-0.5 rounded border-gray-300"
                    style={{ accentColor: '#9CDFE1' }}
                    checked={agreeTerms}
                    onChange={handleTermsCheckboxClick}
                  />
                  <label htmlFor="agreeTerms" className="ml-2 block text-xs text-gray-700">
                    I agree to the{' '}
                    <button
                      type="button"
                      onClick={() => setShowTermsModal(true)}
                      className="font-medium hover:underline"
                      style={{ color: '#40a0a3ff' }}
                    >
                      Terms &amp; Conditions
                    </button>
                  </label>
                </div>
                {validationErrors.agreeTerms && <p className="text-xs text-red-600">{validationErrors.agreeTerms}</p>}

                <div className="flex items-start">
                  <input
                    type="checkbox"
                    id="consentData"
                    className="h-3.5 w-3.5 mt-0.5 rounded border-gray-300"
                    style={{ accentColor: '#9CDFE1' }}
                    checked={consentData}
                    onChange={(e) => setConsentData(e.target.checked)}
                  />
                  <label htmlFor="consentData" className="ml-2 block text-xs text-gray-700">
                    I consent to data processing under GDPR/DPDPA guidelines
                  </label>
                </div>
                {validationErrors.consentData && <p className="text-xs text-red-600">{validationErrors.consentData}</p>}
              </div>

              {/* Submit */}
              <button
                onClick={handleRegister}
                disabled={isLoading}
                className="w-full py-2.5 sm:py-3 mt-2 text-white font-semibold rounded-lg transition flex items-center justify-center text-sm sm:text-base disabled:opacity-70"
                style={{ backgroundColor: isLoading ? '#9CA3AF' : '#21C1B6' }}
                onMouseEnter={(e) => !isLoading && (e.currentTarget.style.backgroundColor = '#1AA49B')}
                onMouseLeave={(e) => !isLoading && (e.currentTarget.style.backgroundColor = '#21C1B6')}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="animate-spin mr-2" size={16} />
                    Registering...
                  </>
                ) : (
                  'Register'
                )}
              </button>
            </div>

            <div className="mt-6 text-center">
              <p className="text-xs sm:text-sm text-gray-600">
                Already have an account?{' '}
                <button onClick={handleLoginClick} className="font-semibold text-gray-900 hover:underline">
                  Login
                </button>
              </p>
              <button
                onClick={handleBackToHome}
                className="mt-3 flex items-center justify-center w-full text-gray-600 hover:text-gray-800 transition-colors text-xs sm:text-sm"
              >
                <ArrowLeft size={14} className="mr-1.5" />
                Back to Home
              </button>
            </div>
          </div>
        </div>

        {/* Right — branding (hidden on mobile) */}
        <div className="hidden lg:block w-full lg:w-1/2 relative overflow-hidden min-h-screen">
          <div className="absolute inset-0 w-full h-full">
            <div
              className="absolute inset-0 w-full h-full"
              style={{
                background: `linear-gradient(135deg,
                  rgba(11,21,36,0.95) 0%,
                  rgba(26,35,50,0.90) 25%,
                  rgba(11,21,36,0.95) 50%,
                  rgba(26,35,50,0.90) 75%,
                  rgba(11,21,36,0.95) 100%)`,
              }}
            />
            <div className="absolute top-16 right-16 w-56 h-56 rounded-full blur-3xl opacity-30" style={{ backgroundColor: '#1AA49B' }} />
            <div className="absolute bottom-16 left-16 w-56 h-56 bg-blue-500 rounded-full blur-3xl opacity-20" />
            <img
              src={AdvocateImage}
              alt="Legal Professional"
              className="absolute inset-0 w-full h-full object-cover"
              style={{ filter: 'brightness(0.92) contrast(1.08) saturate(1.1)', opacity: 0.3 }}
            />
          </div>

          <div className="absolute inset-0 z-10 flex flex-col justify-end p-10 xl:p-12 text-white">
            <div className="w-full max-w-lg">
              <h2 className="text-4xl xl:text-5xl font-bold mb-8 leading-tight">
                Automate Your Legal Workflow in Minutes
              </h2>
              <div className="space-y-5 rounded-2xl p-6" style={{ backgroundColor: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)' }}>
                {[
                  { title: 'Accelerate case preparation', sub: 'In minutes with AI-powered tools' },
                  { title: 'Smart Document Vault', sub: 'Secure, searchable, and organized' },
                  { title: 'Trusted Legal Insights', sub: 'AI-driven precedents & analysis' },
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-4">
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: 'rgba(156,223,225,0.15)', border: '1px solid rgba(26,164,155,0.3)' }}
                    >
                      <svg className="w-5 h-5" style={{ color: '#1AA49B' }} fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <div>
                      <h3 className="text-base lg:text-lg font-semibold mb-1">{item.title}</h3>
                      <p className="text-gray-300 text-sm">{item.sub}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <TermsAndConditions
        isOpen={showTermsModal}
        onClose={() => setShowTermsModal(false)}
        onAccept={handleAcceptTerms}
        showAcceptButton
        companyName="NexIntelAI"
        effectiveDate="January 1, 2025"
      />
    </>
  );
};

export default RegisterPage;
