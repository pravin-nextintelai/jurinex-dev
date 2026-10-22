import React, { useState, useRef, useEffect } from 'react';
import { Plus, Loader2, Paperclip, HardDrive } from 'lucide-react';
import GoogleDrivePicker from './GoogleDrivePicker';

const UploadOptionsMenu = ({
  fileInputRef,
  isUploading,
  onLocalFileClick,
  onGoogleDriveUpload,
  onGoogleDriveFilesSelected, // New prop for selecting files without immediate upload
  folderName = null,
  isSplitView = false,
  disabled = false,
  /** Chat inputs sit at the bottom — open menu downward so "Upload files" is not clipped. */
  menuPlacement = 'below',
}) => {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setShowMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLocalClick = () => {
    setShowMenu(false);
    if (onLocalFileClick) {
      onLocalFileClick();
    } else if (fileInputRef?.current) {
      fileInputRef.current.click();
    }
  };

  const handleGoogleDriveComplete = (documents) => {
    setShowMenu(false);
    if (onGoogleDriveUpload) {
      onGoogleDriveUpload(documents);
    }
  };

  const handleGoogleDriveSelect = (files) => {
    setShowMenu(false);
    if (onGoogleDriveFilesSelected) {
      onGoogleDriveFilesSelected(files);
    }
  };

  // Sizes based on view type
  const buttonSize = isSplitView ? 'w-6 h-6' : 'w-8 h-8';
  const iconSize = isSplitView ? 'h-3.5 w-3.5' : 'h-5 w-5';
  const menuItemPadding = isSplitView ? 'px-3 py-2' : 'px-4 py-2.5';
  const fontSize = isSplitView ? 'text-xs' : 'text-sm';
  const menuIconSize = isSplitView ? 'h-4 w-4' : 'h-5 w-5';
  const menuPositionClass =
    menuPlacement === 'above'
      ? 'bottom-full left-0 mb-2'
      : 'top-full left-0 mt-2';

  return (
    <div className="relative" ref={menuRef}>
      {/* Plus Button */}
      <button
        type="button"
        onClick={() => setShowMenu(!showMenu)}
        disabled={isUploading || disabled}
        className={`${buttonSize} flex items-center justify-center text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-full transition-all duration-200 flex-shrink-0 border border-gray-300 hover:border-gray-400`}
        title="Add files"
      >
        {isUploading ? (
          <Loader2 className={`${iconSize} animate-spin`} />
        ) : (
          <Plus className={iconSize} strokeWidth={2} />
        )}
      </button>

      {/* Dropdown Menu */}
      {showMenu && !isUploading && (
        <div
          className={`absolute ${menuPositionClass} bg-white border border-gray-200 rounded-xl shadow-lg z-[100] min-w-[200px] overflow-visible py-1`}
        >
          {/* Upload files Option */}
          <button
            type="button"
            onClick={handleLocalClick}
            className={`w-full ${menuItemPadding} ${fontSize} text-gray-700 hover:bg-gray-50 flex items-center gap-3 transition-colors`}
          >
            <Paperclip className={`${menuIconSize} text-gray-500`} />
            <span className="font-medium">Upload files</span>
          </button>

          {/* Add from Drive Option */}
          <GoogleDrivePicker
            folderName={folderName}
            onUploadComplete={onGoogleDriveUpload ? handleGoogleDriveComplete : undefined}
            onFilesSelected={onGoogleDriveFilesSelected ? handleGoogleDriveSelect : undefined}
            buttonText="Add from Drive"
            buttonClassName={`w-full ${menuItemPadding} ${fontSize} text-gray-700 hover:bg-gray-50 flex items-center gap-3 transition-colors text-left`}
            iconClassName={menuIconSize}
            multiselect={true}
            disabled={isUploading}
            showDriveIcon={true}
          />
        </div>
      )}
    </div>
  );
};

export default UploadOptionsMenu;



