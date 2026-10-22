import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/shared/context';
import ProfileSetupPopup from './ProfileSetupPopup';
import api from '@/shared/api/api';

const AuthChecker = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, loading, user } = useAuth();
  const [showProfileSetup, setShowProfileSetup] = useState(false);
  const [hasCheckedProfile, setHasCheckedProfile] = useState(false);

  useEffect(() => {
    if (loading) {
      return;
    }

    if (isAuthenticated) {
      if (!hasCheckedProfile && user) {
        checkProfileCompletion();
      }
      return;
    }

    const publicRoutes = ['/login', '/register', '/', '/forgot-password'];
    if (publicRoutes.includes(location.pathname)) {
      return;
    }

    console.log('AuthChecker: User not authenticated, redirecting to login');
    navigate('/login', { 
      replace: true,
      state: { from: location.pathname }
    });
  }, [isAuthenticated, loading, navigate, location.pathname, user, hasCheckedProfile]);

  const checkProfileCompletion = async () => {
    setHasCheckedProfile(true);
    
    try {
      const response = await api.getProfessionalProfile();
      
      if (response && response.data) {
        const isProfileCompleted = response.data.is_profile_completed;
        
        if (!isProfileCompleted) {
          console.log('AuthChecker: Profile not completed, showing setup popup');
          setShowProfileSetup(true);
          api.updateProfessionalProfile({
            is_profile_completed: true
          }).then(() => {
            console.log('AuthChecker: Profile marked as completed - popup will only show once');
          }).catch((error) => {
            console.error('AuthChecker: Error marking profile as completed:', error);
          });
        } else {
          console.log('AuthChecker: Profile already completed, skipping popup');
        }
      } else {
        console.log('AuthChecker: No profile data found, showing setup popup');
        setShowProfileSetup(true);
        api.updateProfessionalProfile({
          is_profile_completed: true
        }).then(() => {
          console.log('AuthChecker: Profile marked as completed - popup will only show once');
        }).catch((error) => {
          console.error('AuthChecker: Error marking profile as completed:', error);
        });
      }
    } catch (error) {
      console.error('AuthChecker: Error checking profile completion:', error);
      console.log('AuthChecker: Error fetching profile, showing setup popup');
      setShowProfileSetup(true);
      api.updateProfessionalProfile({
        is_profile_completed: true
      }).then(() => {
        console.log('AuthChecker: Profile marked as completed - popup will only show once');
      }).catch((markError) => {
        console.error('AuthChecker: Error marking profile as completed:', markError);
      });
    }
  };

  const handleProfileSetupComplete = () => {
    setShowProfileSetup(false);
    window.dispatchEvent(new CustomEvent('userInfoUpdated'));
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#1AA49B] mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {children}
      {showProfileSetup && (
        <ProfileSetupPopup
          isOpen={showProfileSetup}
          onClose={() => {
            setShowProfileSetup(false);
          }}
          onComplete={handleProfileSetupComplete}
        />
      )}
    </>
  );
};

export default AuthChecker;