import React from 'react';
import { FileText, FileEdit, FileType } from 'lucide-react';

const DraftSelectionCard = ({ 
  title, 
  description, 
  icon, 
  onClick, 
  iconBgColor,
  logo,
  logoSize = 'normal',
  disabled = false 
}) => {
  const getIcon = () => {
    switch (icon) {
      case 'google':
        return <FileText className="w-8 h-8" />;
      case 'microsoft':
        return <FileEdit className="w-8 h-8" />;
      default:
        return <FileType className="w-8 h-8" />;
    }
  };

  return (
    <div
      onClick={disabled ? undefined : onClick}
      className={`
        relative h-full flex flex-col p-4 rounded-xl shadow-sm border transition-all duration-300
        ${disabled 
          ? 'opacity-60 cursor-not-allowed bg-white border-gray-200' 
          : 'cursor-pointer bg-white border-gray-200 hover:shadow-xl hover:-translate-y-1'
        }
      `}
    >
      <div className="flex flex-col items-center text-center flex-grow">
        {/* Icon/Logo */}
        <div
          className={`${logoSize === 'large' ? 'w-20 h-20' : 'w-16 h-16'} rounded-full flex items-center justify-center mb-3 text-white flex-shrink-0`}
          style={{ backgroundColor: logo ? 'transparent' : (iconBgColor || '#21C1B6') }}
        >
          {logo ? (
            <img 
              src={logo} 
              alt={title}
              className={logoSize === 'large' ? 'w-16 h-16 object-contain' : 'w-12 h-12 object-contain'}
            />
          ) : (
            getIcon()
          )}
        </div>
        
        {/* Title */}
        <h3 className="text-lg font-bold text-gray-900 mb-1.5">
          {title}
        </h3>
        
        {/* Description */}
        <p className="text-xs text-gray-600 mb-4 min-h-[48px]">
          {description}
        </p>
        
        {/* Button */}
        <button
          disabled={disabled}
          onClick={(e) => {
            e.stopPropagation();
            if (!disabled && onClick) onClick();
          }}
          className={`
            mt-auto px-4 py-2 rounded-lg font-semibold text-sm transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5
            ${disabled
              ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
              : 'text-white'
            }
          `}
          style={!disabled ? { 
            backgroundColor: '#21C1B6',
          } : {}}
          onMouseEnter={(e) => {
            if (!disabled) {
              e.currentTarget.style.backgroundColor = '#1AA49B';
            }
          }}
          onMouseLeave={(e) => {
            if (!disabled) {
              e.currentTarget.style.backgroundColor = '#21C1B6';
            }
          }}
        >
          {disabled ? 'Coming Soon' : 'Get Started'}
        </button>
      </div>
    </div>
  );
};

export default DraftSelectionCard;
