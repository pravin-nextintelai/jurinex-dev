//     if (!user) {


//     if (!user.password || typeof user.password !== 'string' || user.password.trim() === '') {
//     if (!isMatch) {





//     if (!isOTPValid) {

//     if (!user) {





//     if (!user) {

//       if (existingUser && existingUser.id !== userId) {




//     if (!user) {






//     if (!user) {



//     if (!user) {



//     if (!user) {







//     if (!idToken) {


//     if (!email) {


//     if (!user) {












const http = require('http');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const User = require('../models/User');
const Session = require('../models/Session');
const UserProfessionalProfile = require('../models/UserProfessionalProfile');
const Firm = require('../models/Firm');
const FirmUser = require('../models/FirmUser');
const { generateToken } = require('../utils/jwt');
const crypto = require('crypto');
const { collectDeviceInfo, lookupGeoLocation } = require('../utils/deviceInfo');
const { createAndSendOTP, verifyOTP, sendPasswordSetEmail } = require('../services/otpService');
const { syncContactToBrevo } = require('../services/brevoService');
const referralService = require('../services/referralCodes.service');

// ⚠️ TEMPORARY: skips email OTP on regular login (username/password only).
// Set to false (or BYPASS_LOGIN_OTP=false in env) to restore OTP verification.
const BYPASS_LOGIN_OTP = process.env.BYPASS_LOGIN_OTP !== 'false';

// Device-session bookkeeping shared by every token-issuing path: enforce the
// 3-device limit (oldest active session is signed out), record the new device's
// IP/browser/OS, and resolve the IP's location in the background. Returns the
// JWT (which carries `sid` so the session can be revoked remotely).
const createDeviceSession = async (req, activeUser) => {
  const sid = crypto.randomUUID();
  const token = generateToken(activeUser, sid);
  const device = collectDeviceInfo(req);
  // Same device logging in again replaces its own session (device-wise list),
  // THEN the 3-device cap evicts the oldest of what remains.
  await Session.revokeSameDevice(activeUser.id, device.userAgent);
  await Session.enforceDeviceLimit(activeUser.id);
  await Session.create({
    user_id: activeUser.id,
    token,
    sid,
    ip_address: device.ip,
    user_agent: device.userAgent,
    browser: device.browser,
    os: device.os,
    device_type: device.deviceType,
    location: null,
  });
  lookupGeoLocation(device.ip)
    .then((location) => Session.updateLocationBySid(sid, location))
    .catch(() => {});
  return token;
};
const { getAuthDenial } = require('../utils/authAccess');
const admin = require('../config/firebase'); // Import Firebase Admin SDK
const { OAuth2Client } = require('google-auth-library');
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Fire-and-forget: assign the free plan to a newly registered user via payment service.
// Failure is logged but does not block registration.
function assignFreePlanToUser(userId) {
  return new Promise((resolve) => {
    try {
      const paymentServiceUrl = process.env.PAYMENT_SERVICE_URL || 'http://localhost:5003';
      const url = new URL('/api/plans/internal/assign-free-plan', paymentServiceUrl);
      const body = JSON.stringify({ userId: String(userId) });
      const options = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      };
      const req = http.request(options, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', (err) => {
        console.warn(`[Registration] Free plan assignment failed for user ${userId}:`, err.message);
        resolve();
      });
      req.setTimeout(5000, () => {
        req.destroy();
        console.warn(`[Registration] Free plan assignment timed out for user ${userId}`);
        resolve();
      });
      req.write(body);
      req.end();
    } catch (err) {
      console.warn(`[Registration] Free plan assignment error for user ${userId}:`, err.message);
      resolve();
    }
  });
}

async function markUserActiveSession(userId) {
  if (!userId) return null;
  try {
    return await User.touchLogin(userId);
  } catch (error) {
    console.error('[AuthController] Failed to update login activity:', error);
    return null;
  }
}

// Solo Lawyer Registration
const registerSoloLawyer = async (req, res) => {
  const {
    full_name,
    bar_enrollment_number,
    state_bar_council,
    email,
    mobile,
    office_address,
    city,
    state,
    pin_code,
    pan_number,
    gst_number,
    password,
    domain_role,
    role_id
  } = req.body;

  try {
    // Validate required fields
    if (!full_name || !email || !mobile || !password) {
      return res.status(400).json({
        success: false,
        message: 'All mandatory fields are required'
      });
    }

    // Check if user already exists
    const existingUser = await User.findByEmail(email);
    if (existingUser) {
      return res.status(400).json({ 
        success: false,
        message: 'User with this email already exists' 
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const resolvedDomainRole = domain_role && VALID_DOMAIN_ROLES.includes(domain_role.toUpperCase())
      ? domain_role.toUpperCase()
      : 'LEGAL_PROFESSIONAL';

    const user = await User.create({
      username: full_name,
      email,
      password: hashedPassword,
      auth_type: 'manual',
      account_type: 'SOLO',
      approval_status: 'APPROVED',
      first_login: false,
      is_active: true,
      phone: mobile,
      location: city && state ? `${city}, ${state}` : null,
      domain_role: resolvedDomainRole,
      role_id: role_id || null,
    });

    // Sales Referrals: a solo user has no firm, so the attribution row goes to user_referrals
    // (same shape as tenant_referrals, keyed on users.id). Never fails the signup.
    const soloReferral = await referralService.recordUserSignupReferral(user.id, req.body.referralCode);

    await UserProfessionalProfile.findOrCreate(user.id);
    const profileUpdate = { is_profile_completed: false };
    if (bar_enrollment_number) profileUpdate.bar_enrollment_number = bar_enrollment_number;
    if (state_bar_council) profileUpdate.primary_jurisdiction = state_bar_council;
    await UserProfessionalProfile.update(user.id, profileUpdate);

    // Assign free plan (non-blocking)
    assignFreePlanToUser(user.id).catch(() => {});

    // Sync contact to Brevo list (non-blocking — triggers Welcome Email automation)
    syncContactToBrevo(email, full_name);

    // Generate token and create device session (3-device limit + IP/browser metadata)
    const activeUser = await markUserActiveSession(user.id) || user;
    const token = await createDeviceSession(req, activeUser);

    res.status(201).json({
      success: true,
      message: 'Solo lawyer registered successfully',
      token,
      // Sales Referrals: lets the signup page show "Referred by <owner>" (owner name comes from the status API)
      referral: { code: soloReferral.code, status: soloReferral.result },
      user: {
        id: activeUser.id,
        username: activeUser.username,
        email: activeUser.email,
        account_type: activeUser.account_type,
        approval_status: activeUser.approval_status,
      },
    });
  } catch (error) {
    console.error('Error during solo lawyer registration:', error);
    res.status(500).json({ 
      success: false,
      message: 'Internal server error' 
    });
  }
};

// Firm Registration
const registerFirm = async (req, res) => {
  const {
    firm_name,
    registering_advocate_name,
    bar_enrollment_number,
    enrollment_date,
    state_bar_council,
    firm_type,
    establishment_date,
    email,
    mobile,
    landline,
    office_address,
    city,
    district,
    state,
    pin_code,
    pan_number,
    gst_number,
    domain_role,
    role_id
  } = req.body;

  try {
    // Validate required fields
    if (!firm_name || !registering_advocate_name || !firm_type || !email || !mobile) {
      return res.status(400).json({
        success: false,
        message: 'All mandatory fields are required'
      });
    }

    // Check if firm email already exists
    const existingFirm = await Firm.findByEmail(email);
    if (existingFirm) {
      return res.status(400).json({ 
        success: false,
        message: 'Firm with this email already exists' 
      });
    }

    // Check if user with this email exists
    const existingUser = await User.findByEmail(email);
    if (existingUser) {
      return res.status(400).json({ 
        success: false,
        message: 'User with this email already exists' 
      });
    }

    // Generate temporary password for firm admin
    const tempPassword = Math.random().toString(36).slice(-12) + Math.random().toString(36).slice(-12).toUpperCase() + '!@#';
    const hashedPassword = await bcrypt.hash(tempPassword, 10);

    // Create firm admin user
    const firmDomainRole = domain_role && VALID_DOMAIN_ROLES.includes(domain_role.toUpperCase())
      ? domain_role.toUpperCase()
      : 'LEGAL_PROFESSIONAL';

    // One transaction: admin user, firm, firm_user link and the tenant_referrals row.
    // If anything after the firms insert fails, everything is rolled back (no orphan rows).
    const client = await pool.connect();
    let adminUser = null;
    let firm = null;
    let referral = null;
    try {
      await client.query('BEGIN');

      adminUser = await User.create({
        username: registering_advocate_name,
        email,
        password: hashedPassword,
        auth_type: 'manual',
        account_type: 'FIRM_ADMIN',
        approval_status: 'PENDING',
        first_login: true,
        is_active: true,
        phone: mobile,
        location: city && state ? `${city}, ${state}` : null,
        domain_role: firmDomainRole,
        role_id: role_id || null,
      }, client);

      // Create firm record (address/PAN optional — simplified registration form)
      firm = await Firm.create({
        firm_name,
        firm_type,
        establishment_date: establishment_date || null,
        registering_advocate_name,
        bar_enrollment_number: bar_enrollment_number || null,
        enrollment_date: enrollment_date || null,
        state_bar_council: state_bar_council || null,
        email,
        mobile,
        landline: landline || null,
        office_address: office_address || null,
        city: city || null,
        district: district || null,
        state: state || null,
        pin_code: pin_code || null,
        pan_number: pan_number || null,
        gst_number: gst_number || null,
        approval_status: 'PENDING',
        admin_user_id: adminUser.id
      }, client);

      // Create firm_user relationship
      await FirmUser.create({
        firm_id: firm.id,
        user_id: adminUser.id,
        role: 'ADMIN'
      }, client);

      // Sales Referrals: one tenant_referrals row for every new workspace (code_id NULL = Direct),
      // inside this same transaction, under a savepoint so it can never fail the signup.
      referral = await referralService.attributeSignup(client, firm.id, req.body.referralCode);

      await client.query('COMMIT');
    } catch (createError) {
      try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
      throw createError;
    } finally {
      client.release();
    }

    // Assign free plan to firm admin (non-blocking)
    assignFreePlanToUser(adminUser.id).catch(() => {});

    // Sync contact to Brevo list (non-blocking — triggers Welcome Email automation)
    syncContactToBrevo(email, registering_advocate_name);

    // TODO: Send email to admin with credentials (tempPassword)
    // For now, we'll return it in response (remove in production)
    console.log(`[Firm Registration] Admin credentials for ${email}: Password: ${tempPassword}`);

    return res.status(201).json({
      success: true,
      message: 'Firm registration submitted successfully. Your application is under review. You will receive access within 24 hours after verification.',
      firm: {
        id: firm.id,
        firm_name: firm.firm_name,
        email: firm.email,
        approval_status: firm.approval_status
      },
      // Sales Referrals: lets the signup page show "Referred by <owner>" (owner name comes from the status API)
      referral: {
        code: referral ? referral.code : null,
        status: referral ? referral.result : 'DIRECT'
      },
      // Remove admin_credentials in production - send via email instead
      admin_credentials: {
        email: adminUser.email,
        temporary_password: tempPassword,
        note: 'Please change your password on first login'
      }
    });
  } catch (error) {
    console.error('Error during firm registration:', error);
    res.status(500).json({ 
      success: false,
      message: 'Internal server error' 
    });
  }
};

const VALID_DOMAIN_ROLES = [
  'LEGAL_PROFESSIONAL',
  'CHARTERED_ACCOUNTANT',
  'FINANCE_PROFESSIONAL',
  'BANKING_PROFESSIONAL',
  'CORPORATE_ADVISOR',
  'TAX_CONSULTANT',
  'COMPLIANCE_OFFICER',
  'OTHER',
];

// Legacy register endpoint (keeping for backward compatibility)
const register = async (req, res) => {
  const { username, email, password, phone, domain_role, role_id } = req.body;

  try {
    const existingUser = await User.findByEmail(email);
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const resolvedDomainRole = domain_role && VALID_DOMAIN_ROLES.includes(domain_role.toUpperCase())
      ? domain_role.toUpperCase()
      : 'OTHER';

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      username,
      email,
      password: hashedPassword,
      auth_type: 'manual',
      phone: phone || null,
      domain_role: resolvedDomainRole,
      role_id: role_id || null,
    });

    // Sales Referrals: every self-signup gets a row (code_id NULL = Direct). Never fails the signup.
    const legacyReferral = await referralService.recordUserSignupReferral(user.id, req.body.referralCode);

    // Assign free plan (non-blocking)
    assignFreePlanToUser(user.id).catch(() => {});

    // Sync contact to Brevo list (non-blocking — triggers Welcome Email automation)
    syncContactToBrevo(email, username);

    const token = generateToken(user);

    res.status(201).json({
      message: 'User registered successfully',
      token,
      referral: { code: legacyReferral.code, status: legacyReferral.result },
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        phone: user.phone,
        role: user.role,
        domain_role: user.domain_role,
        is_blocked: user.is_blocked,
      },
    });
  } catch (error) {
    console.error('Error during registration:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

const login = async (req, res) => {
  const { email, password } = req.body;
  console.log(`[AuthController] Attempting manual login for email: ${email}`);

  try {
    const user = await User.findByEmail(email);
    if (!user) {
      console.log(`[AuthController] User not found for email: ${email}`);
      return res.status(400).json({ message: 'Invalid credentials' });
    }
    console.log(`[AuthController] User found: ${user.email}`);

    const denial = await getAuthDenial(user);
    if (denial) {
      return res.status(403).json(denial);
    }

    if (!user.password || typeof user.password !== 'string' || user.password.trim() === '') {
      console.log(`[AuthController] User ${user.email} has no password (likely Google sign-in user).`);
      return res.status(400).json({ 
        message: 'This account was created using Google Sign-In. Please use "Sign in with Google" button.' 
      });
    }

    console.log(`[AuthController] Comparing password for user: ${user.email}`);
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      console.log(`[AuthController] Password mismatch for user: ${user.email}`);
      return res.status(400).json({ message: 'Invalid credentials' });
    }
    console.log(`[AuthController] ✅ Password matched for user: ${user.email}`);

    // Handle first-time login for FIRM_ADMIN and FIRM_USER
    if ((user.account_type === 'FIRM_ADMIN' || user.account_type === 'FIRM_USER') && user.first_login === true) {
      // Send OTP for first-time login to change password
      await createAndSendOTP(user.email);
      console.log(`[AuthController] ✅ First-time login - OTP sent to: ${user.email}`);
      
      return res.status(200).json({
        requiresOtp: true,
        firstLogin: true,
        success: true,
        message: 'First-time login detected. OTP sent to your email. Please verify to change your password.',
        email: user.email,
      });
    }

    // ⚠️ TEMPORARY OTP BYPASS: issue the token directly after password check.
    // Restore OTP by setting BYPASS_LOGIN_OTP=false (or removing this block).
    if (BYPASS_LOGIN_OTP) {
      const activeUser = await markUserActiveSession(user.id) || user;
      const token = await createDeviceSession(req, activeUser);
      console.log(`[AuthController] ⚠️ OTP bypass active - direct login for: ${email}`);

      let professionalProfile;
      try {
        professionalProfile = await UserProfessionalProfile.findOrCreate(activeUser.id);
      } catch (profileError) {
        console.error('[AuthController] ⚠️ Error checking/creating professional profile:', profileError);
      }

      return res.status(200).json({
        success: true,
        message: 'Login successful',
        token,
        user: {
          id: activeUser.id,
          username: activeUser.username,
          email: activeUser.email,
          role: activeUser.role,
          is_blocked: activeUser.is_blocked,
          account_type: activeUser.account_type,
          approval_status: activeUser.approval_status,
          first_login: activeUser.first_login,
        },
        professionalProfile: professionalProfile ? {
          is_profile_completed: professionalProfile.is_profile_completed
        } : null,
      });
    }

    // Regular login flow - send OTP for verification
    await createAndSendOTP(user.email);
    console.log(`[AuthController] ✅ OTP sent to: ${user.email}`);

    res.status(200).json({
      requiresOtp: true,  // ⚠️ CRITICAL: This flag tells frontend to switch to OTP screen
      success: true,
      message: 'OTP sent to your email. Please verify to complete login.',
      email: user.email,
    });
  } catch (error) {
    console.error('[AuthController] ❌ Error during manual login:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

const verifyOtpAndLogin = async (req, res) => {
  const { email, otp, newPassword } = req.body;
  console.log(`[AuthController] Attempting OTP verification for email: ${email}`);

  try {
    const isOTPValid = await verifyOTP(email, otp);

    if (!isOTPValid) {
      console.log(`[AuthController] ❌ Invalid or expired OTP for: ${email}`);
      return res.status(400).json({ 
        success: false,
        message: 'Invalid or expired OTP. Please try again.' 
      });
    }
    console.log(`[AuthController] ✅ OTP verified successfully for: ${email}`);

    const user = await User.findByEmail(email);
    if (!user) {
      return res.status(404).json({ 
        success: false,
        message: 'User not found after OTP verification.' 
      });
    }

    const denial = await getAuthDenial(user);
    if (denial) {
      return res.status(403).json(denial);
    }

    // Handle first-time login password change
    let isFirstLogin = false;
    if ((user.account_type === 'FIRM_ADMIN' || user.account_type === 'FIRM_USER') && user.first_login === true) {
      if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({
          success: false,
          message: 'New password is required and must be at least 6 characters long.'
        });
      }

      const hashedPassword = await bcrypt.hash(newPassword, 10);
      await User.update(user.id, { 
        password: hashedPassword, 
        first_login: false 
      });
      isFirstLogin = true;
      console.log(`[AuthController] ✅ Password changed for first-time login: ${email}`);
    }

    // Refresh user data after update
    const updatedUser = await User.findByEmail(email);

    const activeUser = await markUserActiveSession(updatedUser.id) || updatedUser;
    const token = await createDeviceSession(req, activeUser);
    console.log(`[AuthController] ✅ Device session created for user: ${email}`);

    let professionalProfile;
    try {
      professionalProfile = await UserProfessionalProfile.findOrCreate(updatedUser.id);
      console.log(`[AuthController] ✅ Professional profile checked/created for user: ${email}`);
    } catch (profileError) {
      console.error('[AuthController] ⚠️ Error checking/creating professional profile:', profileError);
    }

    res.status(200).json({
      success: true,
      message: isFirstLogin ? 'Password changed successfully. Login successful.' : 'Login successful',
      token,
      user: {
        id: activeUser.id,
        username: activeUser.username,
        email: activeUser.email,
        role: activeUser.role,
        is_blocked: activeUser.is_blocked,
        account_type: activeUser.account_type,
        approval_status: activeUser.approval_status,
        first_login: activeUser.first_login,
      },
      professionalProfile: professionalProfile ? {
        is_profile_completed: professionalProfile.is_profile_completed
      } : null,
    });

  } catch (error) {
    console.error('[AuthController] ❌ Error during OTP verification and login:', error);
    res.status(500).json({ 
      success: false,
      message: 'Internal server error' 
    });
  }
};

const firebaseGoogleSignIn = async (req, res) => {
  const { idToken, email, displayName, photoURL, uid } = req.body;
  console.log(`[GoogleSignIn] Attempting Google Sign-In for email: ${email}`);

  try {
    if (!idToken) {
      return res.status(400).json({ message: "Firebase ID token is required" });
    }

    let decodedToken;
    try {
      decodedToken = await admin.auth().verifyIdToken(idToken);
      console.log(`[GoogleSignIn] ✅ Firebase token verified for: ${decodedToken.email}`);
    } catch (verifyError) {
      console.error('[GoogleSignIn] ❌ Firebase token verification failed:', verifyError);
      return res.status(401).json({ 
        message: 'Invalid or expired Firebase token. Please try signing in again.' 
      });
    }

    const { 
      uid: firebase_uid, 
      email: tokenEmail, 
      name, 
      picture 
    } = decodedToken;

    const userEmail = tokenEmail || email;

    if (!userEmail) {
      return res.status(400).json({ message: "Email not found in Firebase token" });
    }

    let user = await User.findByEmail(userEmail);

    if (!user) {
      const username = name || displayName || userEmail.split("@")[0];

      user = await User.create({
        username,
        email: userEmail,
        password: null, // Google users don't have passwords
        firebase_uid: firebase_uid || uid,
        auth_type: "google",
        profile_image: picture || photoURL || null,
      });

      console.log(`[GoogleSignIn] ✅ New Google user created: ${userEmail}`);

      // Sales Referrals: a Google signup is a self-signup too → user_referrals row (Direct unless a ref was sent)
      await referralService.recordUserSignupReferral(user.id, req.body.referralCode);

      // Sync contact to Brevo list (non-blocking — triggers Welcome Email automation)
      syncContactToBrevo(userEmail, username);
    } else {
      console.log(`[GoogleSignIn] ✅ Existing user found: ${userEmail}`);
      
      if (!user.firebase_uid && (firebase_uid || uid)) {
        await User.update(user.id, { firebase_uid: firebase_uid || uid });
      }
    }

    const denial = await getAuthDenial(user);
    if (denial) {
      return res.status(403).json(denial);
    }

    const activeUser = await markUserActiveSession(user.id) || user;
    const jwtToken = await createDeviceSession(req, activeUser);
    console.log(`[GoogleSignIn] ✅ Device session created for: ${userEmail}`);

    let professionalProfile;
    try {
      professionalProfile = await UserProfessionalProfile.findOrCreate(user.id);
      console.log(`[GoogleSignIn] ✅ Professional profile checked/created for user: ${userEmail}`);
    } catch (profileError) {
      console.error('[GoogleSignIn] ⚠️ Error checking/creating professional profile:', profileError);
    }

    res.status(200).json({
      message: "Google Sign-In successful",
      token: jwtToken,  // ⚠️ CRITICAL: Token returned immediately (no OTP required)
      user: {
        id: activeUser.id,
        username: activeUser.username,
        email: activeUser.email,
        role: activeUser.role,
        is_blocked: activeUser.is_blocked,
        profile_image: activeUser.profile_image,
      },
      professionalProfile: professionalProfile ? {
        is_profile_completed: professionalProfile.is_profile_completed
      } : null,
    });
  } catch (error) {
    console.error("[GoogleSignIn] ❌ Error during Google Sign-In:", error);
    res.status(500).json({ 
      message: "Internal server error during Google Sign-In" 
    });
  }
};

const updateProfile = async (req, res) => {
  const { fullname, email, password, phone, location } = req.body;
  const userId = req.user.id;

  try {
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const updateFields = {};
    if (fullname) updateFields.username = fullname;
    if (email) {
      const existingUser = await User.findByEmail(email);
      if (existingUser && existingUser.id !== userId) {
        return res.status(400).json({ message: 'Email already in use' });
      }
      updateFields.email = email;
    }
    if (password) {
      updateFields.password = await bcrypt.hash(password, 10);
    }
    if (phone) updateFields.phone = phone;
    if (location) updateFields.location = location;

    const updatedUser = await User.update(userId, updateFields);

    res.status(200).json({ 
      message: 'Profile updated successfully', 
      user: { 
        id: updatedUser.id, 
        username: updatedUser.username, 
        email: updatedUser.email, 
        role: updatedUser.role, 
        is_blocked: updatedUser.is_blocked, 
        phone: updatedUser.phone, 
        location: updatedUser.location 
      } 
    });
  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

const deleteAccount = async (req, res) => {
  const userId = req.user.id;

  try {
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    await user.delete();

    res.status(200).json({ message: 'Account deleted successfully' });
  } catch (error) {
    console.error('Error deleting account:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

const logout = async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];

  try {
    if (token) {
      await Session.deleteByToken(token);
    }
    res.status(200).json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Error during logout:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

const fetchProfile = async (req, res) => {
  const userId = req.user.id;

  try {
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.status(200).json({
      message: 'User profile fetched successfully',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        is_blocked: user.is_blocked,
        phone: user.phone,
        location: user.location,
        account_type: user.account_type || 'SOLO',
        created_at: user.created_at,
        updated_at: user.updated_at,
        last_login_at: user.last_login_at,
        last_seen_at: user.last_seen_at,
      },
    });
  } catch (error) {
    console.error('Error fetching profile:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

const pingActivity = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    console.log('[AuthController] Activity ping received', {
      userId,
      email: req.user?.email || null,
      accountType: req.user?.account_type || null,
      visibilityPingAt: new Date().toISOString(),
    });

    const updatedUser = await User.touchSeen(userId);

    // Keep the device session's "last active" fresh for the Settings panel.
    try {
      const pingToken = req.headers.authorization?.split(' ')[1];
      const pingDecoded = pingToken ? require('../utils/jwt').verifyTokenLenient(pingToken) : null;
      if (pingDecoded?.sid) await Session.touchBySid(pingDecoded.sid);
    } catch { /* non-critical */ }

    console.log('[AuthController] Activity ping updated', {
      userId,
      email: req.user?.email || null,
      accountType: req.user?.account_type || null,
      last_login_at: updatedUser?.last_login_at || null,
      last_seen_at: updatedUser?.last_seen_at || null,
      backfilledLastLogin: !!updatedUser?.last_login_at,
    });

    return res.status(200).json({
      success: true,
      message: 'Activity updated successfully',
      last_login_at: updatedUser?.last_login_at || null,
      last_seen_at: updatedUser?.last_seen_at || null,
    });
  } catch (error) {
    console.error('[AuthController] Error updating activity ping:', {
      userId: req.user?.id || null,
      email: req.user?.email || null,
      accountType: req.user?.account_type || null,
      message: error?.message,
      code: error?.code,
      detail: error?.detail,
      stack: error?.stack,
    });
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

const getUserById = async (req, res) => {
  const { userId } = req.params;

  try {
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.status(200).json({
      message: 'User fetched successfully',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        is_blocked: user.is_blocked,
        phone: user.phone,
        location: user.location,
        created_at: user.created_at,
        updated_at: user.updated_at,
      },
    });
  } catch (error) {
    console.error('Error fetching user by ID:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

const updateRazorpayCustomerId = async (req, res) => {
  const { id } = req.params;
  const { razorpay_customer_id } = req.body;

  try {
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const updatedUser = await User.update(id, { razorpay_customer_id });

    res.status(200).json({
      message: 'Razorpay customer ID updated successfully',
      user: {
        id: updatedUser.id,
        username: updatedUser.username,
        email: updatedUser.email,
        role: updatedUser.role,
        is_blocked: updatedUser.is_blocked,
        phone: updatedUser.phone,
        location: updatedUser.location,
        razorpay_customer_id: updatedUser.razorpay_customer_id,
      },
    });
  } catch (error) {
    console.error('Error updating Razorpay customer ID:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

const getUserInfo = async (req, res) => {
  const userId = req.user.id;

  try {
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.status(200).json({
      type: 'final',
      message: 'User information fetched successfully',
      data: {
        fullname: user.username || null,
        email: user.email || null,
        mobile: user.phone || null,
      },
    });
  } catch (error) {
    console.error('Error fetching user info:', error);
    res.status(500).json({ 
      type: 'status',
      message: 'Internal server error' 
    });
  }
};

const getProfessionalProfile = async (req, res) => {
  const userId = req.user.id;

  try {
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        type: 'status',
        message: 'User not found'
      });
    }

    const profile = await UserProfessionalProfile.findOrCreate(userId);

    const responseData = {
      fullname: user.username || null,
      email: user.email || null,
      phone: user.phone || null,
      ...profile,
    };

    res.status(200).json({
      type: 'final',
      message: 'Professional profile fetched successfully',
      data: responseData,
    });
  } catch (error) {
    console.error('Error fetching professional profile:', error);
    res.status(500).json({ 
      type: 'status',
      message: 'Internal server error' 
    });
  }
};



    
//     if (is_profile_completed !== undefined) {
    
//     if (preferred_tone !== undefined) updateFields.preferred_tone = preferred_tone;
//     if (preferred_detail_level !== undefined) updateFields.preferred_detail_level = preferred_detail_level;
//     if (citation_style !== undefined) updateFields.citation_style = citation_style;
//     if (perspective !== undefined) updateFields.perspective = perspective;
//     if (typical_client !== undefined) updateFields.typical_client = typical_client;
//     if (highlights_in_summary !== undefined) updateFields.highlights_in_summary = highlights_in_summary;
//     if (organization_name !== undefined) updateFields.organization_name = organization_name;
//     if (primary_role !== undefined) updateFields.primary_role = primary_role;
//     if (experience !== undefined) updateFields.experience = experience;
//     if (primary_jurisdiction !== undefined) updateFields.primary_jurisdiction = primary_jurisdiction;
//     if (main_areas_of_practice !== undefined) updateFields.main_areas_of_practice = main_areas_of_practice;
//     if (organization_type !== undefined) updateFields.organization_type = organization_type;
//     if (bar_enrollment_number !== undefined) updateFields.bar_enrollment_number = bar_enrollment_number;







//     if (phone !== undefined) userUpdateFields.phone = phone;
//     if (location !== undefined) userUpdateFields.location = location;
//     if (profile_image !== undefined) userUpdateFields.profile_image = profile_image;





//     if (is_profile_completed !== undefined) {

//     if (preferred_tone !== undefined) updateFields.preferred_tone = preferred_tone;
//     if (preferred_detail_level !== undefined) updateFields.preferred_detail_level = preferred_detail_level;
//     if (citation_style !== undefined) updateFields.citation_style = citation_style;
//     if (perspective !== undefined) updateFields.perspective = perspective;
//     if (typical_client !== undefined) updateFields.typical_client = typical_client;
//     if (highlights_in_summary !== undefined) updateFields.highlights_in_summary = highlights_in_summary;
//     if (organization_name !== undefined) updateFields.organization_name = organization_name;
//     if (primary_role !== undefined) updateFields.primary_role = primary_role;
//     if (experience !== undefined) updateFields.experience = experience;
//     if (primary_jurisdiction !== undefined) updateFields.primary_jurisdiction = primary_jurisdiction;
//     if (main_areas_of_practice !== undefined) updateFields.main_areas_of_practice = main_areas_of_practice;
//     if (organization_type !== undefined) updateFields.organization_type = organization_type;
//     if (bar_enrollment_number !== undefined) updateFields.bar_enrollment_number = bar_enrollment_number;




const updateProfessionalProfile = async (req, res) => {
  const userId = req.user.id;

  const {
    phone,
    location,
    profile_image,  // optional if user wants to update profile image
  } = req.body;

  const {
    is_profile_completed,
    preferred_tone,
    preferred_detail_level,
    citation_style,
    perspective,
    typical_client,
    highlights_in_summary,
    organization_name,
    primary_role,
    experience,
    primary_jurisdiction,
    main_areas_of_practice,
    organization_type,
    bar_enrollment_number,
  } = req.body;

  try {
    console.log("🔍 Updating profile for user:", userId);


    const userUpdateFields = {};

    if (phone !== undefined) userUpdateFields.phone = phone;
    if (location !== undefined) userUpdateFields.location = location;
    if (profile_image !== undefined) userUpdateFields.profile_image = profile_image;

    if (Object.keys(userUpdateFields).length > 0) {
      await User.update(userId, userUpdateFields);
    }


    await UserProfessionalProfile.findOrCreate(userId);


    const updateFields = {};

    if (is_profile_completed !== undefined)
      updateFields.is_profile_completed = is_profile_completed;

    if (preferred_tone !== undefined)
      updateFields.preferred_tone = preferred_tone;

    if (preferred_detail_level !== undefined)
      updateFields.preferred_detail_level = preferred_detail_level;

    if (citation_style !== undefined)
      updateFields.citation_style = citation_style;

    if (perspective !== undefined)
      updateFields.perspective = perspective;

    if (typical_client !== undefined)
      updateFields.typical_client = typical_client;

    if (highlights_in_summary !== undefined)
      updateFields.highlights_in_summary = highlights_in_summary;

    if (organization_name !== undefined)
      updateFields.organization_name = organization_name;

    if (primary_role !== undefined)
      updateFields.primary_role = primary_role;

    if (experience !== undefined)
      updateFields.experience = experience;

    if (primary_jurisdiction !== undefined)
      updateFields.primary_jurisdiction = primary_jurisdiction;

    if (main_areas_of_practice !== undefined)
      updateFields.main_areas_of_practice = main_areas_of_practice;

    if (organization_type !== undefined)
      updateFields.organization_type = organization_type;

    if (bar_enrollment_number !== undefined)
      updateFields.bar_enrollment_number = bar_enrollment_number;

    const updatedProfile = await UserProfessionalProfile.update(userId, updateFields);


    res.status(200).json({
      type: "final",
      message: "Professional profile updated successfully",
      data: updatedProfile,
    });

  } catch (error) {
    console.error("❌ Error updating profile:", error);
    res.status(500).json({
      type: "status",
      message: "Internal server error",
    });
  }
};


const changePassword = async (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body;
  const userId = req.user.id;

  console.log(`[AuthController] Attempting password change for user ID: ${userId}`);

  try {
    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({ 
        message: 'Current password, new password, and confirmation are required' 
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ 
        message: 'New password and confirmation do not match' 
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ 
        message: 'New password must be at least 6 characters long' 
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      console.log(`[AuthController] User not found for ID: ${userId}`);
      return res.status(404).json({ message: 'User not found' });
    }

    if (!user.password || typeof user.password !== 'string' || user.password.trim() === '') {
      console.log(`[AuthController] User ${user.email} has no password (likely Google sign-in user).`);
      return res.status(400).json({ 
        message: 'This account was created using Google Sign-In and does not have a password. Password change is not available.' 
      });
    }

    console.log(`[AuthController] Verifying current password for user: ${user.email}`);
    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isCurrentPasswordValid) {
      console.log(`[AuthController] Current password mismatch for user: ${user.email}`);
      return res.status(400).json({ message: 'Current password is incorrect' });
    }
    console.log(`[AuthController] ✅ Current password verified for user: ${user.email}`);

    const isSamePassword = await bcrypt.compare(newPassword, user.password);
    if (isSamePassword) {
      return res.status(400).json({ 
        message: 'New password must be different from current password' 
      });
    }

    const hashedNewPassword = await bcrypt.hash(newPassword, 10);
    console.log(`[AuthController] ✅ New password hashed for user: ${user.email}`);

    await User.update(userId, { password: hashedNewPassword });
    console.log(`[AuthController] ✅ Password updated successfully for user: ${user.email}`);


    res.status(200).json({
      success: true,
      message: 'Password changed successfully. Please log in again with your new password.',
    });

  } catch (error) {
    console.error('[AuthController] ❌ Error during password change:', error);
    res.status(500).json({ 
      success: false,
      message: 'Internal server error' 
    });
  }
};

// Set Password for First-Time Login (Firm Users)
const setPassword = async (req, res) => {
  const { email, newPassword, confirmPassword, token } = req.body;

  console.log(`[AuthController] Attempting to set password for email: ${email}`);

  try {
    if (!email || !newPassword || !confirmPassword) {
      return res.status(400).json({ 
        success: false,
        message: 'Email, new password, and confirmation are required' 
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ 
        success: false,
        message: 'New password and confirmation do not match' 
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ 
        success: false,
        message: 'New password must be at least 6 characters long' 
      });
    }

    const user = await User.findByEmail(email);
    if (!user) {
      console.log(`[AuthController] User not found for email: ${email}`);
      return res.status(404).json({ 
        success: false,
        message: 'User not found' 
      });
    }

    // Verify this is a firm user (FIRM_ADMIN or FIRM_USER) with first_login = true
    if (user.account_type !== 'FIRM_ADMIN' && user.account_type !== 'FIRM_USER') {
      return res.status(403).json({ 
        success: false,
        message: 'This endpoint is only for firm users setting their initial password' 
      });
    }

    if (!user.first_login) {
      return res.status(403).json({ 
        success: false,
        message: 'Password has already been set. Please use change password instead.' 
      });
    }

    // Optional: Verify token if provided (for email link security)
    // For now, we'll allow setting password if user exists and first_login is true

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    // Update password and set first_login to false
    await User.update(user.id, { 
      password: hashedPassword, 
      first_login: false 
    });

    console.log(`[AuthController] ✅ Password set successfully for user: ${email}`);

    // Send password set confirmation email to firm email
    try {
      // Get firm email if user is FIRM_ADMIN
      if (user.account_type === 'FIRM_ADMIN') {
        const Firm = require('../models/Firm');
        const firm = await Firm.findByAdminUserId(user.id);
        if (firm && firm.email) {
          await sendPasswordSetEmail(firm.email);
          console.log(`[AuthController] ✅ Password set email sent to firm: ${firm.email}`);
        }
      }
      // Also send to user's email
      await sendPasswordSetEmail(email);
      console.log(`[AuthController] ✅ Password set email sent to user: ${email}`);
    } catch (emailError) {
      console.error('[AuthController] ⚠️ Error sending password set email:', emailError);
      // Don't fail the request if email fails
    }

    res.status(200).json({
      success: true,
      message: 'Password set successfully. You can now login with your new password.'
    });
  } catch (error) {
    console.error('[AuthController] ❌ Error during password setup:', error);
    res.status(500).json({ 
      success: false,
      message: 'Internal server error'
    });
  }
};

const getAllActiveUsers = async (req, res) => {
  try {
    const users = await User.findAllActive();
    
    res.status(200).json({
      success: true,
      message: 'Active users fetched successfully',
      users: users.map(user => ({
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        status: user.is_blocked ? 'blocked' : 'active',
        created_at: user.created_at,
        updated_at: user.updated_at
      }))
    });
  } catch (error) {
    console.error('Error fetching active users:', error);
    res.status(500).json({ 
      success: false,
      message: 'Internal server error' 
    });
  }
};

const getAllUsers = async (req, res) => {
  try {
    const { is_blocked } = req.query;
    let users;
    
    if (is_blocked === 'false' || is_blocked === false) {
      users = await User.findAllActive();
    } else {
      users = await User.findAll();
    }
    
    res.status(200).json({
      success: true,
      message: 'Users fetched successfully',
      users: users.map(user => ({
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        status: user.is_blocked ? 'blocked' : 'active',
        created_at: user.created_at,
        updated_at: user.updated_at
      }))
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ 
      success: false,
      message: 'Internal server error' 
    });
  }
};

// Firm Admin: Create Staff User
const createFirmStaff = async (req, res) => {
  const { email, password, username, phone } = req.body;
  const adminUserId = req.user.id;

  try {
    // Verify admin is a firm admin
    if (req.user.account_type !== 'FIRM_ADMIN') {
      return res.status(403).json({
        success: false,
        message: 'Only firm admins can create staff users'
      });
    }

    // Get firm info
    const firm = await Firm.findByAdminUserId(adminUserId);
    if (!firm) {
      return res.status(404).json({
        success: false,
        message: 'Firm not found'
      });
    }

    if (firm.approval_status !== 'APPROVED') {
      return res.status(403).json({
        success: false,
        message: 'Firm is not approved yet'
      });
    }

    // Check if user already exists
    const existingUser = await User.findByEmail(email);
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User with this email already exists'
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create staff user
    const staffUser = await User.create({
      username: username || email.split('@')[0],
      email,
      password: hashedPassword,
      auth_type: 'manual',
      account_type: 'FIRM_USER',
      approval_status: 'APPROVED',
      first_login: true,
      is_active: true,
      phone: phone || null
    });

    // Create firm_user relationship
    await FirmUser.create({
      firm_id: firm.id,
      user_id: staffUser.id,
      role: 'STAFF'
    });

    // Sync contact to Brevo list (non-blocking — triggers Welcome Email automation)
    syncContactToBrevo(email, staffUser.username);

    res.status(201).json({
      success: true,
      message: 'Staff user created successfully',
      user: {
        id: staffUser.id,
        username: staffUser.username,
        email: staffUser.email,
        account_type: staffUser.account_type,
        first_login: staffUser.first_login
      }
    });
  } catch (error) {
    console.error('Error creating firm staff:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get firm staff list (for firm admin)
const getFirmStaff = async (req, res) => {
  const adminUserId = req.user.id;

  try {
    if (req.user.account_type !== 'FIRM_ADMIN') {
      return res.status(403).json({
        success: false,
        message: 'Only firm admins can view staff list'
      });
    }

    const firm = await Firm.findByAdminUserId(adminUserId);
    if (!firm) {
      return res.status(200).json({
        success: true,
        staff: [],
        message: 'No firm linked to your account. Your account is marked as Firm Admin but no firm record exists. Please complete firm registration or contact support.'
      });
    }

    const staffList = await FirmUser.findByFirmId(firm.id);

    res.status(200).json({
      success: true,
      message: 'Staff list fetched successfully',
      staff: staffList
    });
  } catch (error) {
    console.error('Error fetching firm staff:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get firm information (for firm admin)
const getFirmInfo = async (req, res) => {
  const adminUserId = req.user.id;

  try {
    if (req.user.account_type !== 'FIRM_ADMIN') {
      return res.status(403).json({
        success: false,
        message: 'Only firm admins can view firm information'
      });
    }

    const firm = await Firm.findByAdminUserId(adminUserId);
    if (!firm) {
      return res.status(404).json({
        success: false,
        message: 'Firm not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Firm information fetched successfully',
      firm
    });
  } catch (error) {
    console.error('Error fetching firm info:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

module.exports = { 
  register,
  registerSoloLawyer,
  registerFirm,
  login, 
  firebaseGoogleSignIn, 
  verifyOtpAndLogin, 
  updateProfile, 
  deleteAccount, 
  logout, 
  fetchProfile, 
  getUserById, 
  updateRazorpayCustomerId,
  getUserInfo,
  getProfessionalProfile,
  updateProfessionalProfile,
  changePassword,
  setPassword,
  getAllActiveUsers,
  getAllUsers,
  createFirmStaff,
  getFirmStaff,
  getFirmInfo,
  pingActivity
};
