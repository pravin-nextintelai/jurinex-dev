import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';

const SearchableSelect = ({
  options = [],
  value = '',
  onChange,
  placeholder = 'Select an option...',
  disabled = false,
  loading = false,
  getOptionLabel = (option) => option?.name || option?.label || String(option),
  getOptionValue = (option) => option?.id || option?.value || option,
  className = '',
  label = '',
  required = false,
  isAutoFilled = false, // New prop to indicate if field was auto-filled
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [filteredOptions, setFilteredOptions] = useState(options);
  const wrapperRef = useRef(null);
  const inputRef = useRef(null);

  // Check if options are grouped
  const hasGroups = options.some(opt => opt && opt.group);
  
  // Update filtered options when search term or options change
  useEffect(() => {
    if (!searchTerm.trim()) {
      setFilteredOptions(options);
    } else {
      const filtered = options.filter((option) => {
        const label = getOptionLabel(option).toLowerCase();
        return label.includes(searchTerm.toLowerCase());
      });
      setFilteredOptions(filtered);
    }
  }, [searchTerm, options, getOptionLabel]);
  
  // Group filtered options by group name
  const groupedOptions = hasGroups && !searchTerm.trim() ? filteredOptions.reduce((acc, option) => {
    const group = option?.group || 'Other';
    if (!acc[group]) {
      acc[group] = [];
    }
    acc[group].push(option);
    return acc;
  }, {}) : null;

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setIsOpen(false);
        setSearchTerm('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Get selected option label
  const selectedOption = options.find(
    (opt) => getOptionValue(opt).toString() === value?.toString()
  );
  const displayValue = selectedOption ? getOptionLabel(selectedOption) : '';

  const handleSelect = (option) => {
    const optionValue = getOptionValue(option);
    onChange(optionValue);
    setIsOpen(false);
    setSearchTerm('');
  };

  const handleInputChange = (e) => {
    setSearchTerm(e.target.value);
    setIsOpen(true);
  };

  const handleInputFocus = () => {
    setIsOpen(true);
    setSearchTerm('');
  };

  const handleInputClick = () => {
    if (!disabled && !loading) {
      setIsOpen(true);
      setSearchTerm('');
      // Focus the input to enable typing
      setTimeout(() => {
        inputRef.current?.focus();
      }, 0);
    }
  };

  return (
    <div className={`relative ${className}`}>
      {label && (
        <label className="block text-sm font-medium text-gray-700 mb-2">
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}
      <div className="relative" ref={wrapperRef}>
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            value={isOpen ? searchTerm : displayValue}
            onChange={handleInputChange}
            onFocus={handleInputFocus}
            onClick={handleInputClick}
            placeholder={!value ? placeholder : ''}
            disabled={disabled || loading}
            className={`w-full px-3 py-2 pr-10 border rounded-md text-sm
              ${isAutoFilled ? 'border-[#21C1B6] bg-[#E0F7F6] ring-2 ring-[#21C1B6] ring-opacity-30' : 'border-gray-300'}
              ${disabled || loading ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : isAutoFilled ? 'bg-[#E0F7F6] text-gray-900 cursor-text' : 'bg-white text-gray-900 cursor-text'}
              placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none
              ${!value && !isOpen ? 'text-gray-500' : ''}`}
            readOnly={!isOpen && !!value}
          />
          <ChevronDown
            className={`absolute right-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none transition-transform ${
              isOpen ? 'rotate-180' : ''
            }`}
          />
        </div>

        {isOpen && !disabled && !loading && (
          <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
            {filteredOptions.length > 0 ? (
              hasGroups && !searchTerm.trim() ? (
                // Show grouped options when not searching
                Object.entries(groupedOptions).map(([groupName, groupOptions]) => (
                  <div key={groupName}>
                    <div className="px-3 py-2 text-xs font-bold text-black bg-gray-50 sticky top-0">
                      {groupName}
                    </div>
                    {groupOptions.map((option, index) => {
                      const optionValue = getOptionValue(option);
                      const optionLabel = getOptionLabel(option);
                      const isSelected = optionValue.toString() === value?.toString();

                      return (
                        <button
                          key={`${groupName}-${index}`}
                          type="button"
                          onClick={() => handleSelect(option)}
                          className={`w-full px-3 py-2 text-left text-sm hover:bg-gray-100 transition-colors ${
                            isSelected ? 'bg-[#E6F8F7] text-[#21C1B6] font-medium' : 'text-gray-900'
                          }`}
                        >
                          {optionLabel}
                        </button>
                      );
                    })}
                  </div>
                ))
              ) : (
                // Show flat list when searching or no groups
                filteredOptions.map((option, index) => {
                  const optionValue = getOptionValue(option);
                  const optionLabel = getOptionLabel(option);
                  const isSelected = optionValue.toString() === value?.toString();

                  return (
                    <button
                      key={index}
                      type="button"
                      onClick={() => handleSelect(option)}
                      className={`w-full px-3 py-2 text-left text-sm hover:bg-gray-100 transition-colors ${
                        isSelected ? 'bg-[#E6F8F7] text-[#21C1B6] font-medium' : 'text-gray-900'
                      }`}
                    >
                      {optionLabel}
                    </button>
                  );
                })
              )
            ) : (
              <div className="px-3 py-2 text-sm text-gray-500">
                No options found
              </div>
            )}
          </div>
        )}

        {loading && (
          <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg">
            <div className="px-3 py-2 text-sm text-gray-500">Loading...</div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SearchableSelect;

