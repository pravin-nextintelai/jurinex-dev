// import React, { useState, useEffect } from 'react';
// import { Link, useNavigate } from 'react-router-dom';
// import { Menu, X } from 'lucide-react';
// import JuriNexGavelLogo from '../assets/JuriNex_gavel_logo.png';

// const PublicHeader = () => {
//   const navigate = useNavigate();
//   const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

//   const handleLogin = () => {
//     navigate('/login');
//   };

//   const toggleMobileMenu = () => {
//     setIsMobileMenuOpen(!isMobileMenuOpen);
//   };

//   useEffect(() => {
//     setIsMobileMenuOpen(false);
//   }, [location.pathname]);

//   return (
//     <nav className="fixed top-4 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-6xl rounded-[30px] bg-white/10 backdrop-blur-md shadow-xl z-50" style={{ background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0.05))' }}>
//       <div className="w-full px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between relative">
//         <div className="flex items-center flex-shrink-0">
//           <Link to="/" className="flex items-center space-x-2">
//             <img src={JuriNexGavelLogo} alt="JuriNex Logo" className="h-8 w-auto" />
//             <span className="text-xl font-bold">
//               <span style={{ color: '#21C1B6' }}>Juri</span>
//               <span className="text-black relative">Nex
//                 <span
//                   className="absolute text-xs font-normal"
//                   style={{ top: '0', right: '-0.6em', color: '#0b0c0cff' }}
//                 >
//                   ™
//                 </span>
//               </span>
//             </span>
//           </Link>
//         </div>

//         <div className="hidden md:flex flex-1 justify-center items-center space-x-4 lg:space-x-8 mx-2 lg:mx-4">
//           <Link to="/" className="text-sm lg:text-base text-black hover:text-gray-700 font-medium transition-colors whitespace-nowrap">Home</Link>
//           <Link to="/services" className="text-sm lg:text-base text-black hover:text-gray-700 font-medium transition-colors whitespace-nowrap">Services</Link>
//           <Link to="/pricing" className="text-sm lg:text-base text-black hover:text-gray-700 font-medium transition-colors whitespace-nowrap">Pricing</Link>
//           <Link to="/aboutus" className="text-sm lg:text-base text-black hover:text-gray-700 font-medium transition-colors whitespace-nowrap">About Us</Link>
//         </div>

//         <div className="hidden md:flex items-center flex-shrink-0 ml-2 lg:ml-4">
//           <button
//             onClick={handleLogin}
//             type="button"
//             className="text-white text-sm lg:text-base font-semibold py-2 lg:py-2.5 px-4 lg:px-6 rounded-full transition-all shadow-lg hover:shadow-xl whitespace-nowrap"
//             style={{ 
//               backgroundColor: '#21C1B6',
//               display: 'flex',
//               alignItems: 'center',
//               justifyContent: 'center',
//               minWidth: '75px',
//               position: 'relative',
//               zIndex: 100
//             }}
//             onMouseEnter={(e) => {
//               e.currentTarget.style.backgroundColor = '#1AA49B';
//               e.currentTarget.style.transform = 'scale(1.05)';
//             }}
//             onMouseLeave={(e) => {
//               e.currentTarget.style.backgroundColor = '#21C1B6';
//               e.currentTarget.style.transform = 'scale(1)';
//             }}
//           >
//             Login
//           </button>
//         </div>

//         <div className="md:hidden flex items-center flex-shrink-0 ml-2">
//           <button
//             onClick={toggleMobileMenu}
//             type="button"
//             className="p-2 rounded-md text-black hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-teal-500"
//           >
//             {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
//           </button>
//         </div>
//       </div>

//       {isMobileMenuOpen && (
//         <div className="lg:hidden fixed inset-0 bg-black bg-opacity-50 z-40" onClick={toggleMobileMenu}>
//           <div className="fixed top-0 right-0 w-64 h-full bg-white shadow-lg p-6 transform transition-transform ease-in-out duration-300 translate-x-0" onClick={(e) => e.stopPropagation()}>
//             <div className="flex justify-end mb-4">
//               <button
//                 onClick={toggleMobileMenu}
//                 className="p-2 rounded-md text-gray-600 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-teal-500"
//               >
//                 <X className="w-6 h-6" />
//               </button>
//             </div>
//             <nav className="flex flex-col space-y-4">
//               <Link to="/" className="text-base text-black hover:text-teal-500 font-medium" onClick={toggleMobileMenu}>Home</Link>
//               <Link to="/services" className="text-base text-black hover:text-teal-500 font-medium" onClick={toggleMobileMenu}>Services</Link>
//               <Link to="/pricing" className="text-base text-black hover:text-teal-500 font-medium" onClick={toggleMobileMenu}>Pricing</Link>
//               <Link to="/aboutus" className="text-base text-black hover:text-teal-500 font-medium" onClick={toggleMobileMenu}>About Us</Link>
//               <button
//                 onClick={() => { handleLogin(); toggleMobileMenu(); }}
//                 className="w-full text-white text-base font-medium py-2.5 px-6 rounded-lg transition-all shadow-md"
//                 style={{ backgroundColor: '#21C1B6' }}
//                 onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#1AA49B'}
//                 onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#21C1B6'}
//               >
//                 Login
//               </button>
//             </nav>
//           </div>
//         </div>
//       )}
//     </nav>
//   );
// };

// export default PublicHeader;


import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import JuriNexWordmark from '../assets/jurinex-wordmark.png';

const PublicHeader = () => {
  const navigate = useNavigate();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const handleLogin = () => {
    navigate('/login');
  };

  const toggleMobileMenu = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen);
  };

  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, []);

  return (
    <nav 
      className="fixed top-4 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-6xl rounded-[30px] shadow-xl z-50"
      style={{ 
        background: 'rgba(255, 255, 255, 0.9)',
        backdropFilter: 'blur(10px)',
        border: '1px solid rgba(255, 255, 255, 0.3)'
      }}
    >
      <div className="w-full px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center flex-shrink-0">
          <Link to="/" className="flex items-center">
            <img src={JuriNexWordmark} alt="JURINEX" className="h-8 w-auto" />
          </Link>
        </div>

        {/* Desktop Navigation Links - Show on medium and larger screens */}
        <div className="flex-1 justify-center items-center gap-6 lg:gap-8 md:flex" style={{ display: 'none' }}>
          <Link 
            to="/" 
            className="font-semibold transition-all duration-200"
            style={{ 
              color: '#1a1a1a',
              fontSize: '16px',
              textDecoration: 'none',
              cursor: 'pointer'
            }}
            onMouseEnter={(e) => e.currentTarget.style.color = '#21C1B6'}
            onMouseLeave={(e) => e.currentTarget.style.color = '#1a1a1a'}
          >
            Home
          </Link>
          <Link 
            to="/services" 
            className="font-semibold transition-all duration-200"
            style={{ 
              color: '#1a1a1a',
              fontSize: '16px',
              textDecoration: 'none',
              cursor: 'pointer'
            }}
            onMouseEnter={(e) => e.currentTarget.style.color = '#21C1B6'}
            onMouseLeave={(e) => e.currentTarget.style.color = '#1a1a1a'}
          >
            Services
          </Link>
          <Link 
            to="/pricing" 
            className="font-semibold transition-all duration-200"
            style={{ 
              color: '#1a1a1a',
              fontSize: '16px',
              textDecoration: 'none',
              cursor: 'pointer'
            }}
            onMouseEnter={(e) => e.currentTarget.style.color = '#21C1B6'}
            onMouseLeave={(e) => e.currentTarget.style.color = '#1a1a1a'}
          >
            Pricing
          </Link>
          <Link 
            to="/aboutus" 
            className="font-semibold transition-all duration-200"
            style={{ 
              color: '#1a1a1a',
              fontSize: '16px',
              textDecoration: 'none',
              cursor: 'pointer'
            }}
            onMouseEnter={(e) => e.currentTarget.style.color = '#21C1B6'}
            onMouseLeave={(e) => e.currentTarget.style.color = '#1a1a1a'}
          >
            About Us
          </Link>
        </div>

        {/* Desktop Login Button - Show on medium and larger screens */}
        <div className="items-center flex-shrink-0 md:flex" style={{ display: 'none' }}>
          <button
            onClick={handleLogin}
            type="button"
            className="font-semibold transition-all duration-200"
            style={{ 
              backgroundColor: '#21C1B6',
              color: 'white',
              padding: '10px 24px',
              borderRadius: '25px',
              border: 'none',
              cursor: 'pointer',
              fontSize: '16px',
              boxShadow: '0 4px 6px rgba(33, 193, 182, 0.3)',
              whiteSpace: 'nowrap',
              minWidth: '90px'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#1AA49B';
              e.currentTarget.style.transform = 'scale(1.05)';
              e.currentTarget.style.boxShadow = '0 6px 12px rgba(33, 193, 182, 0.4)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '#21C1B6';
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.boxShadow = '0 4px 6px rgba(33, 193, 182, 0.3)';
            }}
          >
            Login
          </button>
        </div>

        {/* Mobile Menu Button - Show only on small screens */}
        <div className="flex items-center flex-shrink-0 md:hidden">
          <button
            onClick={toggleMobileMenu}
            type="button"
            className="p-2 rounded-md hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-teal-500"
            style={{ color: '#1a1a1a' }}
          >
            {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      {isMobileMenuOpen && (
        <div className="md:hidden fixed inset-0 bg-black bg-opacity-50 z-[100]" onClick={toggleMobileMenu}>
          <div 
            className="fixed top-0 right-0 w-64 h-full bg-white shadow-lg p-6 transform transition-transform ease-in-out duration-300"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-end mb-4">
              <button
                onClick={toggleMobileMenu}
                className="p-2 rounded-md text-gray-600 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-teal-500"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            <nav className="flex flex-col space-y-4">
              <Link 
                to="/" 
                className="text-base text-black hover:text-teal-500 font-medium" 
                onClick={toggleMobileMenu}
              >
                Home
              </Link>
              <Link 
                to="/services" 
                className="text-base text-black hover:text-teal-500 font-medium" 
                onClick={toggleMobileMenu}
              >
                Services
              </Link>
              <Link 
                to="/pricing" 
                className="text-base text-black hover:text-teal-500 font-medium" 
                onClick={toggleMobileMenu}
              >
                Pricing
              </Link>
              <Link 
                to="/aboutus" 
                className="text-base text-black hover:text-teal-500 font-medium" 
                onClick={toggleMobileMenu}
              >
                About Us
              </Link>
              <button
                onClick={() => { 
                  handleLogin(); 
                  toggleMobileMenu(); 
                }}
                className="w-full text-white text-base font-medium py-2.5 px-6 rounded-lg transition-all shadow-md"
                style={{ backgroundColor: '#21C1B6' }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#1AA49B'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#21C1B6'}
              >
                Login
              </button>
            </nav>
          </div>
        </div>
      )}

      {/* CSS to show desktop menu on larger screens */}
      <style jsx>{`
        @media (min-width: 768px) {
          .md\\:flex[style*="display: none"] {
            display: flex !important;
          }
        }
      `}</style>
    </nav>
  );
};

export default PublicHeader;