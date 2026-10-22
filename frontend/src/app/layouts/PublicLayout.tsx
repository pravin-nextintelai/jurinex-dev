import React, { useState, useEffect } from 'react';
import { Menu, X, Mail, Phone, MapPin } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const PublicLayout = ({
  children,
  hideHeaderAndFooter = false,
  hideContactBar = false,
  hideFooter = false,
}) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    setIsMenuOpen(false);
  }, [navigate]);

  useEffect(() => {
    if (isMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isMenuOpen]);

  const handleNavigation = (path) => {
    navigate(path);
    setIsMenuOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleLogin = () => {
    navigate('/login');
    setIsMenuOpen(false);
  };

  const navbarTopClass = hideContactBar ? 'top-0' : 'top-[34px]';
  const spacerHeight = hideContactBar ? 'h-[80px]' : 'h-[114px]';

  const navigationLinks = [
    { label: 'Home', path: '/' },
    { label: 'Services', path: '/services' },
    { label: 'Pricing', path: '/pricing' },
    { label: 'About Us', path: '/aboutus' },
  ];

  const footerLinks = [
    { label: 'Home', path: '/' },
    { label: 'Services', path: '/services' },
    { label: 'Pricing', path: '/pricing' },
    { label: 'About Us', path: '/aboutus' },
    { label: 'Terms & Conditions', path: '/terms' },
  ];

  return (
    <div className="flex flex-col min-h-screen bg-gray-50 font-sans">
      {!hideHeaderAndFooter && (
        <>
          {!hideContactBar && (
            <div className="fixed top-0 left-0 right-0 z-50 bg-gray-100 text-gray-600 text-xs py-2 px-4 sm:px-6 lg:px-8 border-b border-gray-200">
              <div className="flex justify-center items-center flex-wrap gap-x-6 gap-y-1">
                <a
                  href="https://maps.google.com/?q=B-11,MIDC,Chhatrapati+Sambhajinagar,MH+431010"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center hover:text-gray-900 transition-colors"
                  aria-label="View address on map"
                >
                  <MapPin className="w-3 h-3 mr-1 text-gray-500" />
                  <span className="hidden sm:inline">
                    B-11, MIDC, Chhatrapati Sambhajinagar, (MH) 431010
                  </span>
                  <span className="sm:hidden">Chh. Sambhajinagar, MH</span>
                </a>
                <a
                  href="tel:+919226408832"
                  className="flex items-center hover:text-gray-900 transition-colors"
                  aria-label="Call us"
                >
                  <Phone className="w-3 h-3 mr-1 text-gray-500" />
                  +91 9226408832
                </a>
                <a
                  href="mailto:hr@nexintelai.com"
                  className="flex items-center hover:text-gray-900 transition-colors"
                  aria-label="Email us"
                >
                  <Mail className="w-3 h-3 mr-1 text-gray-500" />
                  <span className="hidden sm:inline">hr@nexintelai.com</span>
                  <span className="sm:hidden">Email</span>
                </a>
              </div>
            </div>
          )}

          <nav
            className={`fixed ${navbarTopClass} left-0 right-0 z-40 bg-white transition-all duration-300 ${
              scrolled ? 'shadow-md' : 'shadow-sm'
            }`}
          >
            <div className="container mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex justify-between items-center py-4">
                <button
                  onClick={() => handleNavigation('/')}
                  className="flex items-center cursor-pointer hover:opacity-80 transition-opacity focus:outline-none focus:ring-2 focus:ring-teal-500 rounded-md px-1"
                  aria-label="Go to homepage"
                >
                  <div className="flex items-center">
                    <span className="text-2xl font-bold tracking-tight" style={{ 
                      color: '#21C1B6',
                      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
                    }}>
                      Juri
                    </span>
                    <span className="text-gray-800 text-2xl font-bold tracking-tight" style={{
                      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
                    }}>
                      NexAI
                    </span>
                  </div>
                </button>

                <div className="hidden md:flex items-center space-x-8">
                  {navigationLinks.map((link) => (
                    <button
                      key={link.path}
                      onClick={() => handleNavigation(link.path)}
                      className="text-sm font-medium font-sans text-gray-600 tracking-normal hover:text-gray-900 transition-all duration-300 relative group px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-teal-500"
                      aria-label={`Navigate to ${link.label}`}
                    >
                      <span className="relative z-10">{link.label}</span>
                      <span className="absolute inset-x-0 bottom-0 h-0.5 bg-teal-500 transform scale-x-0 group-hover:scale-x-100 transition-transform duration-300 origin-left"></span>
                    </button>
                  ))}

                  <button
                    onClick={handleLogin}
                    className="text-sm font-medium font-sans bg-teal-500 hover:bg-teal-600 text-white py-2.5 px-6 rounded-lg transition-all duration-300 shadow-md hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-teal-400"
                    aria-label="Login to your account"
                  >
                    Login
                  </button>
                </div>

                <button
                  className="md:hidden text-gray-700 p-2 rounded-lg hover:bg-gray-100 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-teal-500"
                  onClick={() => setIsMenuOpen(!isMenuOpen)}
                  aria-label={isMenuOpen ? 'Close menu' : 'Open menu'}
                  aria-expanded={isMenuOpen}
                >
                  {isMenuOpen ? (
                    <X className="w-6 h-6" />
                  ) : (
                    <Menu className="w-6 h-6" />
                  )}
                </button>
              </div>

              {isMenuOpen && (
                <div className="md:hidden border-t border-gray-200 bg-white py-4 space-y-2">
                  {navigationLinks.map((link) => (
                    <button
                      key={link.path}
                      onClick={() => handleNavigation(link.path)}
                      className="text-sm font-medium font-sans text-gray-600 hover:text-gray-900 hover:bg-gray-50 transition-all duration-300 block w-full text-left py-3 px-4 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                    >
                      {link.label}
                    </button>
                  ))}
                  <div className="px-4 pt-2">
                    <button
                      onClick={handleLogin}
                      className="w-full text-sm font-medium font-sans bg-teal-500 hover:bg-teal-600 text-white py-2.5 px-6 rounded-lg text-center transition-all duration-300 shadow-md focus:outline-none focus:ring-2 focus:ring-teal-400"
                      aria-label="Login to your account"
                    >
                      Login
                    </button>
                  </div>
                </div>
              )}
            </div>
          </nav>

          <div className={spacerHeight}></div>
        </>
      )}

      <main className="flex-grow">{children}</main>

      {!hideHeaderAndFooter && !hideFooter && (
        <footer className="bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-gray-300 py-12 border-t border-gray-700 relative overflow-hidden">
          <div className="absolute inset-0 opacity-5">
            <div
              className="absolute inset-0"
              style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23374151' fill-opacity='0.3'%3E%3Ccircle cx='7' cy='7' r='1'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
              }}
            />
          </div>

          <div className="container mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 lg:gap-12">
              <div className="flex flex-col items-center md:items-start">
                <div className="flex items-center mb-6">
                  <span className="text-2xl font-bold tracking-tight" style={{ 
                    color: '#21C1B6',
                    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
                  }}>
                    Juri
                  </span>
                  <span className="text-white text-2xl font-bold tracking-tight" style={{
                    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
                  }}>
                    NexAI
                  </span>
                </div>

                <p className="text-sm font-medium text-center md:text-left mb-4">
                  &copy; {new Date().getFullYear()} NexintelAi. All rights reserved.
                </p>

                <div className="flex items-center space-x-4 text-xs text-gray-400">
                  <span className="flex items-center">
                    <div className="w-2 h-2 bg-green-500 rounded-full mr-2 animate-pulse"></div>
                    Secure
                  </span>
                  <span className="flex items-center">
                    <div className="w-2 h-2 bg-blue-500 rounded-full mr-2 animate-pulse"></div>
                    Professional
                  </span>
                  <span className="flex items-center">
                    <div className="w-2 h-2 bg-purple-500 rounded-full mr-2 animate-pulse"></div>
                    Compliant
                  </span>
                </div>
              </div>

              <div className="flex flex-col items-center md:items-start">
                <h3 className="text-lg font-bold text-white mb-6 relative pb-2">
                  Quick Links
                  <div className="absolute bottom-0 left-0 w-16 h-0.5 bg-gradient-to-r from-teal-400 to-gray-600" />
                </h3>
                <nav aria-label="Footer navigation">
                  <ul className="space-y-3">
                    {footerLinks.map((link) => (
                      <li key={link.path}>
                        <button
                          onClick={() => handleNavigation(link.path)}
                          className="text-sm text-gray-400 hover:text-white transition-all duration-300 relative group focus:outline-none focus:text-white"
                        >
                          {link.label}
                          <span className="absolute inset-x-0 -bottom-1 h-0.5 bg-white transform scale-x-0 group-hover:scale-x-100 transition-transform duration-300 origin-left"></span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </nav>
              </div>

              <div className="flex flex-col items-center md:items-start">
                <h3 className="text-lg font-bold text-white mb-6 relative pb-2">
                  Contact Us
                  <div className="absolute bottom-0 left-0 w-16 h-0.5 bg-gradient-to-r from-teal-400 to-gray-600" />
                </h3>
                <address className="not-italic space-y-4 text-sm text-gray-400">
                  <a
                    href="https://maps.google.com/?q=B-11,MIDC,Chhatrapati+Sambhajinagar,MH+431010"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-start group hover:text-gray-300 transition-colors focus:outline-none focus:text-gray-300"
                  >
                    <MapPin className="w-5 h-5 mr-3 mt-0.5 text-gray-500 group-hover:text-gray-300 transition-colors flex-shrink-0" />
                    <span>
                      B-11, near Railway Station Road, MIDC, Chhatrapati Sambhajinagar, (MH) 431010
                    </span>
                  </a>

                  <a
                    href="tel:+919226408832"
                    className="flex items-center group hover:text-gray-300 transition-colors focus:outline-none focus:text-gray-300"
                  >
                    <Phone className="w-5 h-5 mr-3 text-gray-500 group-hover:text-gray-300 transition-colors flex-shrink-0" />
                    <span>+91 9226408832</span>
                  </a>

                  <a
                    href="mailto:hr@nexintelai.com"
                    className="flex items-center group hover:text-gray-300 transition-colors focus:outline-none focus:text-gray-300"
                  >
                    <Mail className="w-5 h-5 mr-3 text-gray-500 group-hover:text-gray-300 transition-colors flex-shrink-0" />
                    <span>hr@nexintelai.com</span>
                  </a>
                </address>
              </div>
            </div>

            <div className="mt-12 pt-8 border-t border-gray-700 text-center">
              <p className="text-sm text-gray-500">
                Transforming legal document analysis with cutting-edge AI technology
              </p>
            </div>
          </div>

          <div className="absolute top-10 right-10 w-32 h-32 bg-gradient-to-br from-gray-700 to-gray-800 rounded-full opacity-5 blur-2xl animate-pulse pointer-events-none" />
        </footer>
      )}
    </div>
  );
};

export default PublicLayout;