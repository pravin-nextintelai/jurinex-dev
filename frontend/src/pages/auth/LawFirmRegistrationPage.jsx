import React, { useState, useEffect } from 'react';
import { Eye, EyeOff, Home, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import ApiService from '../../services/api';
import Swal from 'sweetalert2';
import './LawFirmRegistrationPage.css';
import { AUTH_SERVICE_URL } from '../../config/apiConfig';
import useReferralCode from '../../hooks/useReferralCode';
import ReferralCodeField from '../../components/auth/ReferralCodeField';

const FIRM_TYPES = ['Registered', 'Not Registered'];

const Field = ({ label, required, error, children }) => (
  <div className="form-group">
    <label>{label}{required && <span className="required"> *</span>}</label>
    {children}
    {error && <span className="error-message">{error}</span>}
  </div>
);

const LawFirmRegistrationPage = () => {
  const navigate = useNavigate();
  const [registrationType, setRegistrationType] = useState('SOLO');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [errors, setErrors] = useState({});
  const [roles, setRoles] = useState([]);
  const [rolesLoading, setRolesLoading] = useState(false);
  // Sales Referrals: optional code from ?ref= link, memory (30 days) or typed in.
  const referral = useReferralCode();

  const [soloData, setSoloData] = useState({
    full_name: '',
    role_id: '',
    email: '',
    mobile: '',
    password: '',
    confirmPassword: '',
  });

  const [firmData, setFirmData] = useState({
    firm_name: '',
    registering_advocate_name: '',
    firm_type: '',
    role_id: '',
    email: '',
    mobile: '',
  });

  useEffect(() => {
    setRolesLoading(true);
    fetch(`${AUTH_SERVICE_URL}/api/auth/roles`)
      .then((r) => r.json())
      .then((data) => setRoles(data.roles || []))
      .catch(() => setRoles([]))
      .finally(() => setRolesLoading(false));
  }, []);

  const handleSoloChange = (field, value) => {
    setSoloData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors(prev => ({ ...prev, [field]: '' }));
  };

  const handleFirmChange = (field, value) => {
    setFirmData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors(prev => ({ ...prev, [field]: '' }));
  };

  const handleToggle = (type) => {
    setRegistrationType(type);
    setErrors({});
  };

  const validateSolo = () => {
    const e = {};
    if (!soloData.full_name.trim()) e.full_name = 'Full name is required';
    if (!soloData.role_id) e.role_id = 'Please select your professional role';
    if (!soloData.email.trim()) e.email = 'Email is required';
    else if (!/\S+@\S+\.\S+/.test(soloData.email)) e.email = 'Email is invalid';
    if (!soloData.mobile.trim()) e.mobile = 'Mobile number is required';
    else if (!/^[0-9]{10}$/.test(soloData.mobile)) e.mobile = 'Enter a valid 10-digit mobile number';
    if (!soloData.password) e.password = 'Password is required';
    else if (soloData.password.length < 6) e.password = 'Password must be at least 6 characters';
    if (!soloData.confirmPassword) e.confirmPassword = 'Please confirm your password';
    else if (soloData.password !== soloData.confirmPassword) e.confirmPassword = 'Passwords do not match';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const validateFirm = () => {
    const e = {};
    if (!firmData.firm_name.trim()) e.firm_name = 'Firm name is required';
    if (!firmData.registering_advocate_name.trim()) e.registering_advocate_name = 'Advocate name is required';
    if (!firmData.firm_type) e.firm_type = 'Firm type is required';
    if (!firmData.role_id) e.role_id = 'Please select your professional role';
    if (!firmData.email.trim()) e.email = 'Email is required';
    else if (!/\S+@\S+\.\S+/.test(firmData.email)) e.email = 'Email is invalid';
    if (!firmData.mobile.trim()) e.mobile = 'Mobile number is required';
    else if (!/^[0-9]{10}$/.test(firmData.mobile)) e.mobile = 'Enter a valid 10-digit mobile number';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async () => {
    const isValid = registrationType === 'SOLO' ? validateSolo() : validateFirm();
    if (!isValid) return;

    // Referral code: block on invalid / inactive / too short, wait for an in-flight check,
    // send the code only when it is valid or the check could not be made.
    const referralDecision = await referral.resolveForSubmit();
    if (!referralDecision.allowed) return;
    const referralPayload = referralDecision.referralCode ? { referralCode: referralDecision.referralCode } : {};

    setIsLoading(true);
    try {
      if (registrationType === 'SOLO') {
        const response = await ApiService.registerSoloLawyer({
          full_name: soloData.full_name,
          role_id: soloData.role_id,
          email: soloData.email,
          mobile: soloData.mobile,
          password: soloData.password,
          ...referralPayload,
        });

        if (response.token) localStorage.setItem('token', response.token);
        referral.onSignupSuccess();

        await Swal.fire({
          icon: 'success',
          title: 'Registration Successful!',
          html: `<p>You have been registered successfully. Redirecting to login...</p>${
            referral.ownerName && referralDecision.referralCode
              ? `<p style="margin-top:10px;"><strong>Referred by:</strong> ${referral.ownerName}</p>`
              : ''
          }`,
          confirmButtonColor: '#1AA49B',
        });
        navigate('/login');
      } else {
        await ApiService.registerFirm({
          firm_name: firmData.firm_name,
          registering_advocate_name: firmData.registering_advocate_name,
          firm_type: firmData.firm_type,
          role_id: firmData.role_id,
          email: firmData.email,
          mobile: firmData.mobile,
          ...referralPayload,
        });
        referral.onSignupSuccess();

        await Swal.fire({
          icon: 'info',
          title: 'Application Submitted!',
          html: `
            <p style="text-align:left;margin:10px 0;">Your firm registration application has been submitted successfully.</p>
            <p style="text-align:left;margin:10px 0;"><strong>Status:</strong> Under Review</p>
            <p style="text-align:left;margin:10px 0;">You will receive admin credentials via email once approved (within 24 hours).</p>
            ${referral.ownerName && referralDecision.referralCode ? `<p style="text-align:left;margin:10px 0;"><strong>Referred by:</strong> ${referral.ownerName}</p>` : ''}
          `,
          confirmButtonColor: '#1AA49B',
          width: '500px',
        });
        navigate('/login');
      }
    } catch (error) {
      const msg = error.response?.data?.message || error.message || 'Registration failed. Please try again.';
      await Swal.fire({ icon: 'error', title: 'Registration Failed', text: msg, confirmButtonColor: '#1AA49B' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="law-firm-registration">
      <div className="main-content">
        {/* Back to Home */}
        <div style={{ marginBottom: '20px' }}>
          <button
            onClick={() => navigate('/')}
            style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: '10px 20px', backgroundColor: '#21C1B6', color: 'white',
              border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: '600',
              cursor: 'pointer', transition: 'all 0.3s ease',
              boxShadow: '0 2px 4px rgba(33,193,182,0.3)',
            }}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#1AA49B'; }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = '#21C1B6'; }}
          >
            <Home size={18} />
            Back to Home
          </button>
        </div>

        <div className="form-container">
          {/* Toggle */}
          <div className="toggle-container">
            <span className="toggle-label">Registration Type:</span>
            <span
              className={`toggle-option ${registrationType === 'SOLO' ? 'active' : ''}`}
              onClick={() => handleToggle('SOLO')}
              style={{ cursor: 'pointer', fontWeight: registrationType === 'SOLO' ? '700' : '400', color: registrationType === 'SOLO' ? '#1AA49B' : '#666' }}
            >
              Solo User
            </span>
            <div
              className="toggle-switch"
              onClick={() => handleToggle(registrationType === 'SOLO' ? 'FIRM' : 'SOLO')}
              style={{ cursor: 'pointer' }}
            >
              <div className={`toggle-thumb ${registrationType === 'FIRM' ? 'right' : 'left'}`} />
            </div>
            <span
              className={`toggle-option ${registrationType === 'FIRM' ? 'active' : ''}`}
              onClick={() => handleToggle('FIRM')}
              style={{ cursor: 'pointer', fontWeight: registrationType === 'FIRM' ? '700' : '400', color: registrationType === 'FIRM' ? '#1AA49B' : '#666' }}
            >
              Firm
            </span>
          </div>

          {/* Form Header */}
          <div className="form-header">
            <h2>{registrationType === 'SOLO' ? 'Solo Lawyer Registration' : 'Law Firm Registration'}</h2>
            <p className="section-description">Please fill in all the mandatory fields marked with <span className="required">*</span></p>
          </div>

          {registrationType === 'SOLO' ? (
            <div className="section">
              <div className="section-title">Personal Information</div>
              <div className="form-row">
                <Field label="Full Name" required error={errors.full_name}>
                  <input
                    type="text"
                    value={soloData.full_name}
                    onChange={e => handleSoloChange('full_name', e.target.value)}
                    placeholder="Your full name"
                    className={errors.full_name ? 'error' : ''}
                  />
                </Field>
                <Field label="Professional Role" required error={errors.role_id}>
                  <select
                    value={soloData.role_id}
                    onChange={e => handleSoloChange('role_id', e.target.value)}
                    className={errors.role_id ? 'error' : ''}
                    disabled={rolesLoading}
                  >
                    <option value="">{rolesLoading ? 'Loading roles...' : '-- Select your role --'}</option>
                    {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </Field>
              </div>
              <div className="form-row">
                <Field label="Email Address" required error={errors.email}>
                  <input
                    type="email"
                    value={soloData.email}
                    onChange={e => handleSoloChange('email', e.target.value)}
                    placeholder="your.email@example.com"
                    className={errors.email ? 'error' : ''}
                  />
                </Field>
                <Field label="Mobile Number" required error={errors.mobile}>
                  <input
                    type="tel"
                    value={soloData.mobile}
                    onChange={e => handleSoloChange('mobile', e.target.value.replace(/\D/g, '').slice(0, 10))}
                    placeholder="10-digit mobile number"
                    maxLength="10"
                    className={errors.mobile ? 'error' : ''}
                  />
                </Field>
              </div>
              <div className="form-row">
                <Field label="Password" required error={errors.password}>
                  <div className="password-input-wrapper">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={soloData.password}
                      onChange={e => handleSoloChange('password', e.target.value)}
                      placeholder="Min 6 characters"
                      className={errors.password ? 'error' : ''}
                    />
                    <button type="button" onClick={() => setShowPassword(!showPassword)} className="password-toggle">
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </Field>
                <Field label="Confirm Password" required error={errors.confirmPassword}>
                  <div className="password-input-wrapper">
                    <input
                      type={showConfirmPassword ? 'text' : 'password'}
                      value={soloData.confirmPassword}
                      onChange={e => handleSoloChange('confirmPassword', e.target.value)}
                      placeholder="Re-enter password"
                      className={errors.confirmPassword ? 'error' : ''}
                    />
                    <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} className="password-toggle">
                      {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </Field>
              </div>
            </div>
          ) : (
            <div className="section">
              <div className="section-title">Firm Information</div>
              <div className="form-row">
                <Field label="Firm Name" required error={errors.firm_name}>
                  <input
                    type="text"
                    value={firmData.firm_name}
                    onChange={e => handleFirmChange('firm_name', e.target.value)}
                    placeholder="Enter registered firm name"
                    className={errors.firm_name ? 'error' : ''}
                  />
                </Field>
                <Field label="Full Name of Registering Advocate" required error={errors.registering_advocate_name}>
                  <input
                    type="text"
                    value={firmData.registering_advocate_name}
                    onChange={e => handleFirmChange('registering_advocate_name', e.target.value)}
                    placeholder="As per Bar Council enrollment"
                    className={errors.registering_advocate_name ? 'error' : ''}
                  />
                </Field>
              </div>
              <div className="form-row">
                <Field label="Type of Firm" required error={errors.firm_type}>
                  <select
                    value={firmData.firm_type}
                    onChange={e => handleFirmChange('firm_type', e.target.value)}
                    className={errors.firm_type ? 'error' : ''}
                  >
                    <option value="">-- Select --</option>
                    {FIRM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </Field>
                <Field label="Professional Role" required error={errors.role_id}>
                  <select
                    value={firmData.role_id}
                    onChange={e => handleFirmChange('role_id', e.target.value)}
                    className={errors.role_id ? 'error' : ''}
                    disabled={rolesLoading}
                  >
                    <option value="">{rolesLoading ? 'Loading roles...' : '-- Select your role --'}</option>
                    {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </Field>
              </div>
              <div className="form-row">
                <Field label="Email Address" required error={errors.email}>
                  <input
                    type="email"
                    value={firmData.email}
                    onChange={e => handleFirmChange('email', e.target.value)}
                    placeholder="firm@example.com"
                    className={errors.email ? 'error' : ''}
                  />
                </Field>
                <Field label="Mobile Number" required error={errors.mobile}>
                  <input
                    type="tel"
                    value={firmData.mobile}
                    onChange={e => handleFirmChange('mobile', e.target.value.replace(/\D/g, '').slice(0, 10))}
                    placeholder="10-digit mobile number"
                    maxLength="10"
                    className={errors.mobile ? 'error' : ''}
                  />
                </Field>
              </div>
              <p style={{ fontSize: '13px', color: '#666', marginTop: '8px' }}>
                Admin credentials will be sent to the registered email after approval.
              </p>
            </div>
          )}

          {/* Optional referral code (shown for both solo and firm signups) */}
          <ReferralCodeField {...referral.fieldProps} />

          {/* Footer buttons */}
          <div className="form-footer">
            <button
              onClick={() => navigate('/login')}
              style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: '14px', textDecoration: 'underline' }}
            >
              Already have an account? Login
            </button>
            <button
              onClick={handleSubmit}
              disabled={isLoading}
              className="btn-primary"
              style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '12px 32px', backgroundColor: isLoading ? '#9CA3AF' : '#21C1B6',
                color: 'white', border: 'none', borderRadius: '8px',
                fontSize: '15px', fontWeight: '600', cursor: isLoading ? 'not-allowed' : 'pointer',
                transition: 'background-color 0.2s',
              }}
              onMouseEnter={e => !isLoading && (e.currentTarget.style.backgroundColor = '#1AA49B')}
              onMouseLeave={e => !isLoading && (e.currentTarget.style.backgroundColor = '#21C1B6')}
            >
              {isLoading ? (
                <>
                  <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                  Registering...
                </>
              ) : (
                registrationType === 'SOLO' ? 'Register' : 'Submit Application'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LawFirmRegistrationPage;
