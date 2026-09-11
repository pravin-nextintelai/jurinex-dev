import React from 'react';
import { Link } from 'react-router-dom';
import { Mail, Phone, MapPin } from 'lucide-react';
import JuriNexLogo from '../assets/nexintel.jpg';

const Footer = () => {
  const currentYear = new Date().getFullYear();

  const quickLinks = [
    { to: '/', label: 'Home' },
    { to: '/pricing', label: 'Pricing' },
    { to: '/aboutus', label: 'About Us' },
  ];

  const legalLinks = [
    { to: '/terms', label: 'Terms & Conditions' },
    { to: '/privacy-policy', label: 'Privacy Policy' },
  ];

  return (
    <footer className="bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-gray-300 py-12 border-t border-gray-700">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-12">
          <div className="flex flex-col items-center sm:items-start">
            <Link 
              to="/" 
              className="flex items-center mb-4 focus:outline-none focus:ring-2 focus:ring-teal-500 rounded-md transition-opacity hover:opacity-80"
              aria-label="Go to JuriNex homepage"
            >
              <div className="flex items-center">
                <span className="text-teal-500 text-2xl font-bold" style={{ color: '#21C1B6' }}>Juri</span>
                <span className="text-white text-2xl font-bold">Nex</span>
              </div>
            </Link>
            <p className="text-gray-400 text-sm leading-relaxed text-center sm:text-left">
              Transforming legal document analysis with cutting-edge AI technology.
            </p>
            
            <div className="flex items-center space-x-4 text-xs text-gray-500 mt-4">
              <span className="flex items-center">
                <div className="w-2 h-2 bg-green-500 rounded-full mr-2 animate-pulse"></div>
                Secure
              </span>
              <span className="flex items-center">
                <div className="w-2 h-2 bg-blue-500 rounded-full mr-2 animate-pulse"></div>
                Professional
              </span>
            </div>
          </div>

          <div className="flex flex-col items-center sm:items-start">
            <h4 className="text-white font-semibold mb-4 text-sm uppercase tracking-wider">
              Quick Links
            </h4>
            <nav aria-label="Footer quick links">
              <ul className="space-y-2 text-sm">
                {quickLinks.map((link) => (
                  <li key={link.to}>
                    <Link
                      to={link.to}
                      className="text-gray-400 hover:text-white transition-colors duration-300 inline-block relative group focus:outline-none focus:text-white"
                    >
                      {link.label}
                      <span className="absolute inset-x-0 -bottom-1 h-0.5 bg-teal-500 transform scale-x-0 group-hover:scale-x-100 transition-transform duration-300 origin-left"></span>
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </div>

          <div className="flex flex-col items-center sm:items-start">
            <h4 className="text-white font-semibold mb-4 text-sm uppercase tracking-wider">
              Contact Us
            </h4>
            <address className="not-italic space-y-3 text-sm text-gray-400">
              <a
                href="https://maps.google.com/?q=B-11,near+Railway+Station+Road,MIDC,Chhatrapati+Sambhajinagar,MH+431010"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start group hover:text-gray-300 transition-colors focus:outline-none focus:text-gray-300"
                aria-label="View our address on Google Maps"
              >
                <MapPin className="w-4 h-4 mr-2 mt-0.5 text-gray-500 group-hover:text-teal-500 transition-colors flex-shrink-0" />
                <span className="leading-relaxed">
                  B-11, near Railway Station Road,<br />
                  MIDC, Chhatrapati Sambhajinagar,<br />
                  Maharashtra 431010
                </span>
              </a>

              <a
                href="tel:+919226408832"
                className="flex items-center group hover:text-gray-300 transition-colors focus:outline-none focus:text-gray-300"
                aria-label="Call us at +91 9226408832"
              >
                <Phone className="w-4 h-4 mr-2 text-gray-500 group-hover:text-teal-500 transition-colors flex-shrink-0" />
                <span>+91 9226408832</span>
              </a>

              <a
                href="mailto:hr@jurinex.com"
                className="flex items-center group hover:text-gray-300 transition-colors focus:outline-none focus:text-gray-300"
                aria-label="Email us at hr@jurinex.com"
              >
                <Mail className="w-4 h-4 mr-2 text-gray-500 group-hover:text-teal-500 transition-colors flex-shrink-0" />
                <span>hr@nexintelai.com</span>
              </a>
            </address>
          </div>

          <div className="flex flex-col items-center sm:items-start">
            <h4 className="text-white font-semibold mb-4 text-sm uppercase tracking-wider">
              Legal
            </h4>
            <nav aria-label="Footer legal links">
              <ul className="space-y-2 text-sm">
                {legalLinks.map((link) => (
                  <li key={link.to}>
                    <Link
                      to={link.to}
                      className="text-gray-400 hover:text-white transition-colors duration-300 inline-block relative group focus:outline-none focus:text-white"
                    >
                      {link.label}
                      <span className="absolute inset-x-0 -bottom-1 h-0.5 bg-teal-500 transform scale-x-0 group-hover:scale-x-100 transition-transform duration-300 origin-left"></span>
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </div>

        <div className="border-t border-gray-700 mt-10 pt-8 text-center">
          <p className="text-sm text-gray-400">
            &copy; {currentYear} NexintelAi. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
