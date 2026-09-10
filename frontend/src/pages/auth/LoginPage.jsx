import React, { useState, useEffect } from "react";
import { useNavigate, Link, useLocation } from "react-router-dom";
import { Eye, EyeOff, CheckCircle, ArrowLeft } from "lucide-react";
import { auth, googleProvider } from '../../config/firebase';
import { AUTH_SERVICE_URL } from '../../config/apiConfig';
import { signInWithPopup } from 'firebase/auth';
import { useAuth } from '../../context';
import JuriNexLogo from '../../assets/jurinex-wordmark.png';
import AdvocateImage from '../../assets/advocate.png';

const LoginPage = () => {
 const [formData, setFormData] = useState({ email: "", password: "" });
 const [errors, setErrors] = useState({});
 const [showPassword, setShowPassword] = useState(false);
 const [isOTPStage, setIsOTPStage] = useState(false);
 const [otp, setOtp] = useState("");
 const [successMessage, setSuccessMessage] = useState("");
 const [isVerifying, setIsVerifying] = useState(false);
 const [isLoading, setIsLoading] = useState(false);
 const [serverMessage, setServerMessage] = useState("");
 const [otpEmail, setOtpEmail] = useState('');
 const [logoError, setLogoError] = useState(false);
 const [isFirstLogin, setIsFirstLogin] = useState(false);
 const [newPassword, setNewPassword] = useState("");
 const [confirmNewPassword, setConfirmNewPassword] = useState("");
 const [showNewPassword, setShowNewPassword] = useState(false);
 const [showConfirmNewPassword, setShowConfirmNewPassword] = useState(false);

 const [isGoogleSignInProgress, setIsGoogleSignInProgress] = useState(false);

 const navigate = useNavigate();
 const location = useLocation();
 const { login, verifyOtp, isAuthenticated, setAuthState } = useAuth();
 const getPostLoginDestination = () => {
  const from = location.state?.from
  return typeof from === "string" && from.trim() ? from : "/dashboard"
 };
 const getPostLoginState = () => {
  if (location.state?.pendingUpgradePlan) {
    return { pendingUpgradePlan: location.state.pendingUpgradePlan }
  }
  return undefined
 };

 useEffect(() => {
 if (isAuthenticated && !isLoading) {
 console.log('LoginPage: User already authenticated, redirecting to dashboard');
 navigate(getPostLoginDestination(), { replace: true, state: getPostLoginState() });
 }
 }, [isAuthenticated, navigate, isLoading]);

 const validateEmail = (email) => {
 if (!email) return "Email is required.";
 if (!/\S+@\S+\.\S+/.test(email)) return "Invalid email format.";
 return "";
 };
 
 const validatePassword = (password) => {
 if (!password) return "Password is required.";
 if (password.length < 8) return "Password must be at least 8 characters long.";
 if (!/(?=.*[a-z])/.test(password)) return "Password must contain at least one lowercase letter.";
 if (!/(?=.*[A-Z])/.test(password)) return "Password must contain at least one uppercase letter.";
 if (!/(?=.*\d)/.test(password)) return "Password must contain at least one number.";
 if (!/(?=.*[@$!%*?&])/.test(password)) return "Password must contain at least one special character (@$!%*?&).";
 return "";
 };

 const handleChange = (e) => {
 const { name, value } = e.target;
 setFormData({ ...formData, [name]: value });
 
 setServerMessage("");
 setSuccessMessage("");
 
 if (name === 'email') {
 setErrors((prev) => ({ ...prev, email: validateEmail(value) }));
 } else if (name === 'password') {
 setErrors((prev) => ({ ...prev, password: validatePassword(value) }));
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

 const handleGoogleSignIn = async () => {
 try {
 setIsLoading(true);
 setServerMessage('');
 setSuccessMessage('');
 setIsOTPStage(false);
 
 const result = await signInWithPopup(auth, googleProvider);
 const user = result.user;
 
 const idToken = await user.getIdToken();
 
 const response = await fetch(`${AUTH_SERVICE_URL}/api/auth/google`, {
 method: 'POST',
 headers: {
 'Content-Type': 'application/json',
 },
 body: JSON.stringify({
 idToken: idToken,
 email: user.email,
 displayName: user.displayName,
 photoURL: user.photoURL,
 }),
 });

 const data = await response.json();

 if (response.ok && data.token) {
 const userData = {
 email: user.email,
 displayName: user.displayName,
 photoURL: user.photoURL,
 uid: user.uid
 };

 setSuccessMessage('Google Sign-In successful! Redirecting...');
 
 setAuthState(data.token, userData);
 
 setTimeout(() => {
 setIsLoading(false);
 navigate(getPostLoginDestination(), { replace: true, state: getPostLoginState() });
 }, 500);
 } else {
 setServerMessage(data.message || 'Google Sign-In failed. Please try again.');
 setIsLoading(false);
 }
 } catch (error) {
 console.error('Google Sign-In Error:', error);
 
 if (error.code === 'auth/popup-closed-by-user') {
 setServerMessage('Sign-in cancelled. Please try again.');
 } else if (error.code === 'auth/popup-blocked') {
 setServerMessage('Pop-up blocked. Please allow pop-ups and try again.');
 } else if (error.code === 'auth/cancelled-popup-request') {
 return;
 } else {
 setServerMessage(error.message || 'Failed to sign in with Google. Please try again.');
 }
 setIsLoading(false);
 }
 };

 const handleLogin = async (e) => {
 e.preventDefault();
 
 const emailError = validateEmail(formData.email);
 const passwordError = validatePassword(formData.password);
 setErrors({ email: emailError, password: passwordError });
 
 if (emailError || passwordError) return;

 setIsLoading(true);
 setServerMessage('');
 setSuccessMessage('');

 try {
 const result = await login(formData.email, formData.password);

    if (result.requiresOtp) {
      setIsOTPStage(true);
      setIsFirstLogin(result.firstLogin || false);
      setOtpEmail(result.email || formData.email);
      setServerMessage('');
      setSuccessMessage(result.message || 'OTP sent to your email. Please check and enter the code.');
    } else if (result.success) {
 setSuccessMessage('Login successful! Redirecting...');
 setTimeout(() => {
 navigate(getPostLoginDestination(), { replace: true, state: getPostLoginState() });
 }, 1500);
    } else {
      if (result.code === 'FIRM_DISABLED') {
        setServerMessage('Your firm is blocked by Jurinex. Please contact your firm admin.');
      } else if (result.code === 'USER_DISABLED' || result.code === 'FIRM_NOT_APPROVED') {
        setServerMessage(
          result.code === 'FIRM_NOT_APPROVED'
            ? (result.message || 'Your firm is not approved yet.')
            : (result.message || 'Your account is disabled. Contact your firm admin or support.')
        );
      } else {
        setServerMessage(result.message || "Login failed. Please try again.");
      }
    }
 } catch (error) {
 const code = error.code || error.response?.data?.code;
 const status = error.response?.status;
 if (code === 'FIRM_DISABLED') {
   setServerMessage('Your firm is blocked by Jurinex. Please contact your firm admin.');
 } else if (code === 'USER_DISABLED' || code === 'FIRM_NOT_APPROVED' || status === 403) {
   setServerMessage(
     code === 'FIRM_NOT_APPROVED'
       ? (error.message || 'Your firm is not approved yet.')
       : (error.message || 'Your account is disabled. Contact your firm admin or support.')
   );
 } else {
   setServerMessage(error.message || "Login failed. Please try again.");
 }
 console.error('Login error:', error);
 } finally {
 setIsLoading(false);
 }
 };

const handleVerifyOTP = async (e) => {
  if (e) e.preventDefault();
  
  if (otp.length !== 6) {
    setSuccessMessage("");
    setServerMessage("Please enter a 6-digit OTP.");
    return;
  }

  // If first login, validate new password
  if (isFirstLogin) {
    if (!newPassword || newPassword.length < 6) {
      setServerMessage("New password is required and must be at least 6 characters long.");
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setServerMessage("Passwords do not match.");
      return;
    }
  }

  setIsVerifying(true);
  setServerMessage('');
  setSuccessMessage('');

  try {
    const result = await verifyOtp(
      otpEmail || formData.email, 
      otp, 
      isFirstLogin ? newPassword : null
    );

    if (result.success) {
      setSuccessMessage(isFirstLogin 
        ? 'Password changed successfully! Logging in...' 
        : 'OTP verification successful! Logging in...');
      setServerMessage('');
      
      setTimeout(() => {
        navigate(getPostLoginDestination(), { replace: true, state: getPostLoginState() });
      }, 1500);
    } else {
      setServerMessage(result.message || "Invalid OTP. Please try again.");
      setSuccessMessage('');
    }
  } catch (error) {
    setServerMessage(error.message || "Invalid OTP. Please try again.");
    setSuccessMessage('');
    console.error('OTP verification error:', error);
  } finally {
    setIsVerifying(false);
  }
};

const handleBackToLogin = () => {
 setIsOTPStage(false);
 setIsFirstLogin(false);
 setOtp('');
 setNewPassword('');
 setConfirmNewPassword('');
 setServerMessage('');
 setSuccessMessage('');
 setErrors({});
};

 return (
 <div className="min-h-screen flex font-sans transition-all duration-700 ease-in-out">
 <div className="w-full lg:w-1/2 bg-white flex items-center justify-center p-8 lg:p-12">
 {!isOTPStage && (
 <div className="max-w-md w-full transition-opacity duration-700">
 <div className="flex justify-center mb-8">
 <LogoComponent />
 </div>

 <h2 className="text-3xl font-bold text-gray-900 mb-2 text-center">
 Welcome to JuriNex
 </h2>
 <p className="text-gray-500 mb-8 text-center text-sm">
 Sign in to continue managing your legal workspace.
 </p>

 <form className="space-y-5" onSubmit={handleLogin}>
 <div>
 <label className="block text-sm font-medium text-gray-700 mb-1">
 Email / User ID
 </label>
 <input
 type="text"
 name="email"
 placeholder="Enter your email"
 className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] text-black"
 value={formData.email}
 onChange={handleChange}
 />
 {errors.email && (
 <p className="mt-1 text-xs text-red-600">{errors.email}</p>
 )}
 </div>

 <div>
 <label className="block text-sm font-medium text-gray-700 mb-1">
 Password
 </label>
 <div className="relative">
 <input
 type={showPassword ? "text" : "password"}
 name="password"
 placeholder="Enter your password"
 className="w-full px-4 py-2.5 border border-gray-300 rounded-lg pr-10 focus:ring-2 focus:ring-[#21C1B6] text-black"
 value={formData.password}
 onChange={handleChange}
 />
 <button
 type="button"
 onClick={() => setShowPassword(!showPassword)}
 className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
 >
 {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
 </button>
 </div>
 {errors.password && (
 <p className="mt-1 text-xs text-red-600">{errors.password}</p>
 )}
 </div>

 <button
 type="submit"
 disabled={isLoading}
 className="w-full py-3 px-5 text-white font-semibold rounded-lg transition duration-300 mt-6 disabled:opacity-50 disabled:cursor-not-allowed"
 style={{
 background: "linear-gradient(90deg, #21C1B6 0%, #1AA49B 100%)",
 }}
 >
 {isLoading ? "Signing In..." : "Sign In"}
 </button>
 </form>

 <div className="mt-6">
 <div className="relative">
 <div className="absolute inset-0 flex items-center">
 <div className="w-full border-t border-gray-300" />
 </div>
 <div className="relative flex justify-center text-sm">
 <span className="px-2 bg-white text-gray-500">Or continue with</span>
 </div>
 </div>
 </div>

 <div className="mt-6">
 <button
 onClick={handleGoogleSignIn}
 disabled={isLoading}
 type="button"
 className="w-full flex items-center justify-center px-4 py-2.5 border border-gray-300 rounded-lg shadow-sm bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#21C1B6] disabled:opacity-50 disabled:cursor-not-allowed transition duration-200"
 >
 <svg className="h-5 w-5 mr-2" viewBox="0 0 24 24">
 <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
 <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
 <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
 <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
 </svg>
 Sign in with Google
 </button>
 </div>

 <div className="mt-6 space-y-4">
 <div className="text-center">
 <p className="text-sm text-gray-600">
 Don't have an account?{' '}
 <Link
 to="/register"
 className="font-medium text-[#1AA49B] hover:text-[#21C1B6] transition-colors duration-200"
 >
 Create new account
 </Link>
 </p>
 </div>
 
 <div className="text-center">
 <button
 onClick={() => navigate('/')}
 type="button"
 className="flex items-center justify-center mx-auto text-gray-600 hover:text-gray-800 transition-colors duration-200 group"
 >
 <ArrowLeft size={18} className="mr-2 group-hover:-translate-x-1 transition-transform duration-200" />
 <span className="text-sm font-medium">Back to Home</span>
 </button>
 </div>
 </div>

 {serverMessage && (
 <p className="text-sm text-center mt-4 text-red-600">
 {serverMessage}
 </p>
 )}

 {successMessage && (
 <p className="text-sm text-center mt-4 text-green-600">
 {successMessage}
 </p>
 )}
 </div>
 )}

 {isOTPStage && (
 <div className="max-w-md w-full text-center animate-fadeIn">
 <div className="mb-6 text-left">
 <button
 onClick={handleBackToLogin}
 type="button"
 className="flex items-center text-gray-600 hover:text-gray-800 transition-colors duration-200 group"
 >
 <ArrowLeft size={20} className="mr-2 group-hover:-translate-x-1 transition-transform duration-200" />
 <span className="text-sm font-medium">Back to Login</span>
 </button>
 </div>

 <div className="flex justify-center mb-8">
 <LogoComponent />
 </div>
 <h2 className="text-2xl font-bold text-gray-900 mb-2">Enter OTP</h2>
 <p className="text-gray-500 mb-6 text-sm">
 We've sent a 6-digit code to <span className="font-medium text-gray-700">{otpEmail || formData.email}</span>
 </p>

 <form onSubmit={handleVerifyOTP} className="space-y-6">
 <input
 type="text"
 maxLength="6"
 placeholder="Enter 6-digit OTP"
 className="w-full px-4 py-3 border border-gray-300 rounded-lg text-center tracking-widest text-lg text-black focus:ring-2 focus:ring-[#21C1B6]"
 value={otp}
 onChange={(e) => {
 const value = e.target.value.replace(/\D/g, '');
 setOtp(value);
 setServerMessage('');
 setSuccessMessage('');
 }}
 />

 {isFirstLogin && (
 <div className="space-y-4 mt-4">
 <div className="bg-blue-50 border-l-4 border-blue-400 p-3 rounded">
 <p className="text-sm text-blue-800">
 <strong>First-time login:</strong> Please set a new password for your account.
 </p>
 </div>
 
 <div>
 <label className="block text-sm font-medium text-gray-700 mb-1">
 New Password *
 </label>
 <div className="relative">
 <input
 type={showNewPassword ? "text" : "password"}
 placeholder="Enter new password (min 6 characters)"
 className="w-full px-4 py-2.5 border border-gray-300 rounded-lg pr-10 focus:ring-2 focus:ring-[#21C1B6] text-black"
 value={newPassword}
 onChange={(e) => {
 setNewPassword(e.target.value);
 setServerMessage('');
 }}
 />
 <button
 type="button"
 onClick={() => setShowNewPassword(!showNewPassword)}
 className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
 >
 {showNewPassword ? <EyeOff size={18} /> : <Eye size={18} />}
 </button>
 </div>
 </div>

 <div>
 <label className="block text-sm font-medium text-gray-700 mb-1">
 Confirm New Password *
 </label>
 <div className="relative">
 <input
 type={showConfirmNewPassword ? "text" : "password"}
 placeholder="Confirm new password"
 className="w-full px-4 py-2.5 border border-gray-300 rounded-lg pr-10 focus:ring-2 focus:ring-[#21C1B6] text-black"
 value={confirmNewPassword}
 onChange={(e) => {
 setConfirmNewPassword(e.target.value);
 setServerMessage('');
 }}
 />
 <button
 type="button"
 onClick={() => setShowConfirmNewPassword(!showConfirmNewPassword)}
 className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
 >
 {showConfirmNewPassword ? <EyeOff size={18} /> : <Eye size={18} />}
 </button>
 </div>
 </div>
 </div>
 )}

 <button
 type="submit"
 disabled={isVerifying || otp.length !== 6 || (isFirstLogin && (!newPassword || newPassword.length < 6 || newPassword !== confirmNewPassword))}
 className="w-full mt-6 py-3 px-5 text-white font-semibold rounded-lg transition duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
 style={{
 background: "linear-gradient(90deg, #21C1B6 0%, #1AA49B 100%)",
 }}
 >
 {isVerifying ? "Verifying..." : isFirstLogin ? "Verify OTP & Change Password" : "Verify OTP"}
 </button>
 </form>

 {serverMessage && (
 <p className="mt-4 text-sm animate-fadeIn text-red-600">
 {serverMessage}
 </p>
 )}

 {successMessage && (
 <p className="mt-4 text-sm animate-fadeIn text-green-600">
 {successMessage}
 </p>
 )}
 </div>
 )}
 </div>

 <div className="w-full lg:w-1/2 relative overflow-hidden">
 <div className="absolute inset-0 w-full h-full">
 <div
 className="absolute inset-0 w-full h-full"
 style={{
 background: `
 linear-gradient(135deg,
 rgba(11, 21, 36, 0.95) 0%,
 rgba(26, 35, 50, 0.90) 25%,
 rgba(11, 21, 36, 0.95) 50%,
 rgba(26, 35, 50, 0.90) 75%,
 rgba(11, 21, 36, 0.95) 100%
 )
 `
 }}
 />
 
 <div className="absolute inset-0">
 <div className="absolute top-16 right-16 w-40 h-40 md:w-48 md:h-48 lg:w-56 lg:h-56 xl:w-64 xl:h-64 rounded-full blur-3xl opacity-30" style={{ backgroundColor: '#1AA49B' }}></div>
 <div className="absolute bottom-16 left-16 w-40 h-40 md:w-48 md:h-48 lg:w-56 lg:h-56 xl:w-64 xl:h-64 bg-blue-500 rounded-full blur-3xl opacity-20"></div>
 <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-32 h-32 md:w-40 md:h-40 lg:w-48 lg:h-48 bg-gradient-to-br from-blue-400 to-purple-600 rounded-full blur-2xl opacity-10"></div>
 </div>
 
 <div className="absolute inset-0 w-full h-full">
 <img
 src={AdvocateImage}
 alt="Legal Professional"
 className="w-full h-full"
 style={{
 objectFit: 'cover',
 objectPosition: 'center center',
 filter: 'brightness(0.92) contrast(1.08) saturate(1.1)',
 opacity: 0.3,
 }}
 />
 
 <div
 className="absolute inset-0 w-full h-full pointer-events-none"
 style={{
 background: `
 linear-gradient(
 135deg,
 rgba(11, 21, 36, 0.15) 0%,
 rgba(11, 21, 36, 0.05) 30%,
 rgba(26, 35, 50, 0.10) 50%,
 rgba(11, 21, 36, 0.05) 70%,
 rgba(11, 21, 36, 0.15) 100%
 )
 `
 }}
 />
 </div>
 </div>
 
 <div className="absolute inset-0 z-10 flex flex-col justify-between p-6 md:p-8 lg:p-10 xl:p-12 text-white">
 <div className="flex-1 flex items-start justify-center lg:items-start pt-4 lg:pt-8">
 </div>
 
 <div className="w-full max-w-md lg:max-w-lg xl:max-w-xl">
 <h2 className="text-2xl md:text-3xl lg:text-4xl xl:text-5xl font-bold mb-4 md:mb-6 lg:mb-8 leading-tight text-center lg:text-left">
 Automate Your Legal Workflow in Minutes
 </h2>
 
 <div className="space-y-4 md:space-y-5 lg:space-y-6 bg-gradient-to-br from-gray-800/40 to-gray-900/40 backdrop-blur-sm rounded-2xl p-4 md:p-5 lg:p-6 border border-gray-700/20">
 <div className="flex items-start gap-3 lg:gap-4">
 <div className="w-8 h-8 lg:w-10 lg:h-10 rounded-lg flex items-center justify-center flex-shrink-0 border border-teal-500/30" style={{ backgroundColor: 'rgba(156, 223, 225, 0.15)' }}>
 <svg className="w-4 h-4 lg:w-5 lg:h-5" style={{ color: '#1AA49B' }} fill="currentColor" viewBox="0 0 20 20">
 <path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM15.657 5.757a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM5.05 6.464A1 1 0 106.464 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zM5 10a1 1 0 01-1 1H3a1 1 0 110-2h1a1 1 0 011 1zM8 16v-1h4v1a2 2 0 11-4 0zM12 14c.015-.34.208-.646.477-.859a4 4 0 10-4.954 0c.27.213.462.519.476.859h4.002z"/>
 </svg>
 </div>
 <div className="min-w-0 flex-1">
 <h3 className="text-sm md:text-base lg:text-lg font-semibold mb-1">Accelerate case preparation</h3>
 <p className="text-gray-300 text-xs md:text-sm">in minutes with AI-powered tools</p>
 </div>
 </div>
 
 <div className="flex items-start gap-3 lg:gap-4">
 <div className="w-8 h-8 lg:w-10 lg:h-10 rounded-lg flex items-center justify-center flex-shrink-0 border border-teal-500/30" style={{ backgroundColor: 'rgba(156, 223, 225, 0.15)' }}>
 <svg className="w-4 h-4 lg:w-5 lg:h-5" style={{ color: '#1AA49B' }} fill="currentColor" viewBox="0 0 20 20">
 <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd"/>
 </svg>
 </div>
 <div className="min-w-0 flex-1">
 <h3 className="text-sm md:text-base lg:text-lg font-semibold mb-1">Smart Document Vault</h3>
 <p className="text-gray-300 text-xs md:text-sm">Secure, searchable, and organized</p>
 </div>
 </div>
 
 <div className="flex items-start gap-3 lg:gap-4">
 <div className="w-8 h-8 lg:w-10 lg:h-10 rounded-lg flex items-center justify-center flex-shrink-0 border border-teal-500/30" style={{ backgroundColor: 'rgba(156, 223, 225, 0.15)' }}>
 <svg className="w-4 h-4 lg:w-5 lg:h-5" style={{ color: '#1AA49B' }} fill="currentColor" viewBox="0 0 20 20">
 <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd"/>
 </svg>
 </div>
 <div className="min-w-0 flex-1">
 <h3 className="text-sm md:text-base lg:text-lg font-semibold mb-1">Trusted Legal Insights</h3>
 <p className="text-gray-300 text-xs md:text-sm">AI-driven precedents & analysis</p>
 </div>
 </div>
 </div>
 </div>
 </div>
 </div>
</div>
 );
};

export default LoginPage;