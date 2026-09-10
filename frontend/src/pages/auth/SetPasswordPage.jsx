import React, { useState, useEffect } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { Eye, EyeOff, CheckCircle, ArrowLeft } from "lucide-react";
import ApiService from '../../services/api';
import Swal from 'sweetalert2';
import JuriNexLogo from '../../assets/jurinex-wordmark.png';

const SetPasswordPage = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  
  const [formData, setFormData] = useState({
    newPassword: "",
    confirmPassword: ""
  });
  const [errors, setErrors] = useState({});
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [logoError, setLogoError] = useState(false);
  const [email, setEmail] = useState('');

  useEffect(() => {
    // Get email from URL params
    const emailParam = searchParams.get('email');
    const tokenParam = searchParams.get('token');
    
    if (emailParam) {
      setEmail(emailParam);
    } else {
      // If no email in URL, show error and redirect
      Swal.fire({
        icon: 'error',
        title: 'Invalid Link',
        text: 'The password setup link is invalid. Please contact your administrator.',
        confirmButtonColor: '#1AA49B'
      }).then(() => {
        navigate('/login');
      });
    }
  }, [searchParams, navigate]);

  const validatePassword = (password) => {
    if (!password) return "Password is required.";
    if (password.length < 6) return "Password must be at least 6 characters long.";
    return "";
  };

  const validateConfirmPassword = (confirmPassword) => {
    if (!confirmPassword) return "Please confirm your password.";
    if (confirmPassword !== formData.newPassword) return "Passwords do not match.";
    return "";
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });
    setErrors({ ...errors, [name]: "" });
  };

  const handleBlur = (e) => {
    const { name, value } = e.target;
    if (name === 'newPassword') {
      setErrors((prev) => ({ ...prev, [name]: validatePassword(value) }));
    } else if (name === 'confirmPassword') {
      setErrors((prev) => ({ ...prev, [name]: validateConfirmPassword(value) }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // Validate all fields
    const newErrors = {};
    newErrors.newPassword = validatePassword(formData.newPassword);
    newErrors.confirmPassword = validateConfirmPassword(formData.confirmPassword);

    if (newErrors.newPassword || newErrors.confirmPassword) {
      setErrors(newErrors);
      return;
    }

    setIsLoading(true);

    try {
      const response = await ApiService.setPassword({
        email: email,
        newPassword: formData.newPassword,
        confirmPassword: formData.confirmPassword
      });

      if (response.success) {
        await Swal.fire({
          icon: 'success',
          title: 'Password Set Successfully!',
          text: 'Your password has been set. You can now login with your new password.',
          confirmButtonColor: '#1AA49B'
        });

        // Redirect to login page
        navigate('/login', { 
          state: { email: email, message: 'Password set successfully. Please login.' }
        });
      }
    } catch (error) {
      const errorMessage = error.response?.data?.message || error.message || 'Failed to set password. Please try again.';
      
      await Swal.fire({
        icon: 'error',
        title: 'Error',
        text: errorMessage,
        confirmButtonColor: '#1AA49B'
      });
    } finally {
      setIsLoading(false);
    }
  };

  const LogoComponent = ({ size = "w-16 h-16" }) => {
    if (logoError) {
      return (
        <div
          className={`${size} rounded-lg flex items-center justify-center`}
          style={{ backgroundColor: "#1AA49B" }}
        >
          <svg
            className="w-10 h-10 text-white"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M3 3h8l4 4-4 4H3V3zm10 10h8v8h-8l-4-4 4-4z" />
          </svg>
        </div>
      );
    }

    return (
      <img
        src={JuriNexLogo}
        alt="JURINEX"
        className="h-12 w-auto object-contain"
        onError={() => setLogoError(true)}
        onLoad={() => setLogoError(false)}
      />
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-xl p-8">
          {/* Logo and Header */}
          <div className="text-center mb-8">
            <div className="flex justify-center mb-4">
              <LogoComponent />
            </div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Set Your Password</h1>
            <p className="text-gray-600">
              {email ? `Setting password for ${email}` : 'Please set a secure password for your account'}
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* New Password */}
            <div>
              <label htmlFor="newPassword" className="block text-sm font-medium text-gray-700 mb-2">
                New Password <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <input
                  type={showNewPassword ? "text" : "password"}
                  id="newPassword"
                  name="newPassword"
                  value={formData.newPassword}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-[#1AA49B] focus:border-transparent transition-all ${
                    errors.newPassword ? "border-red-500" : "border-gray-300"
                  }`}
                  placeholder="Enter your new password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700"
                >
                  {showNewPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
              {errors.newPassword && (
                <p className="mt-1 text-sm text-red-600">{errors.newPassword}</p>
              )}
              <p className="mt-1 text-xs text-gray-500">Password must be at least 6 characters long</p>
            </div>

            {/* Confirm Password */}
            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-2">
                Confirm Password <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <input
                  type={showConfirmPassword ? "text" : "password"}
                  id="confirmPassword"
                  name="confirmPassword"
                  value={formData.confirmPassword}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-[#1AA49B] focus:border-transparent transition-all ${
                    errors.confirmPassword ? "border-red-500" : "border-gray-300"
                  }`}
                  placeholder="Confirm your new password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700"
                >
                  {showConfirmPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
              {errors.confirmPassword && (
                <p className="mt-1 text-sm text-red-600">{errors.confirmPassword}</p>
              )}
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-[#1AA49B] text-white py-3 rounded-lg font-semibold hover:bg-[#158a82] transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <>
                  <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Setting Password...
                </>
              ) : (
                <>
                  <CheckCircle size={20} />
                  Set Password
                </>
              )}
            </button>
          </form>

          {/* Back to Login */}
          <div className="mt-6 text-center">
            <Link
              to="/login"
              className="text-[#1AA49B] hover:text-[#158a82] font-medium text-sm flex items-center justify-center gap-2"
            >
              <ArrowLeft size={16} />
              Back to Login
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SetPasswordPage;

