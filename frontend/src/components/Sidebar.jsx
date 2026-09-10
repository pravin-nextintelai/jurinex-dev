// import React, { useState, useEffect, useRef } from 'react';
// import {
//   ChevronLeftIcon,
//   ChevronRightIcon,
//   PlusIcon,
//   ChartBarIcon,
//   DocumentTextIcon,
//   MagnifyingGlassCircleIcon,
//   PencilSquareIcon,
//   ScaleIcon,
//   BookOpenIcon,
//   ClockIcon,
//   UserGroupIcon,
//   Cog6ToothIcon,
//   Bars3Icon,
//   XMarkIcon,
//   CreditCardIcon,
//   BellIcon,
//   QuestionMarkCircleIcon,
//   ChatBubbleLeftRightIcon,
// } from '@heroicons/react/24/outline';
// import {
//   FolderPlus,
//   FileUp,
//   Home,
//   Folder,
//   Upload,
//   ChevronDown,
//   ChevronRight,
//   MessageSquare,
//   LogOut,
//   User,
//   Settings,
// } from 'lucide-react';
// import { Link, useLocation, useNavigate } from 'react-router-dom';
// import UserProfileMenu from './UserProfileMenu';
// import QuickTools from './QuickTools';
// import { useFileManager } from '../context/FileManagerContext';
// import { useAuth } from '../context';
// import { useSidebar } from '../context/SidebarContext';
// import { createPortal } from 'react-dom';
// import JuriNexLogoImg from '/src/assets/JuriNex_gavel_logo.png';

// const Sidebar = () => {
//   const { isSidebarHidden, setIsSidebarHidden, isSidebarCollapsed, setIsSidebarCollapsed, forceSidebarCollapsed, setForceSidebarCollapsed } = useSidebar();
//   const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
//   const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
//   const [currentFileId, setCurrentFileId] = useState(null);
//   const [isMobile, setIsMobile] = useState(false);
//   const [isDocumentUploadOpen, setIsDocumentUploadOpen] = useState(false);
//   const [userData, setUserData] = useState(null);
//   const [profileMenuPosition, setProfileMenuPosition] = useState({ top: 0, left: 0 });

//   const location = useLocation();
//   const navigate = useNavigate();

//   const { createFolder } = useFileManager();

//   const fileInputRef = useRef(null);
//   const folderInputRef = useRef(null);
//   const [showNewFolderInput, setShowNewFolderInput] = useState(false);
//   const [newFolderName, setNewFolderName] = useState('');
//   const [creatingFolder, setCreatingFolder] = useState(false);
//   const profileButtonRef = useRef(null);
//   const profileMenuRef = useRef(null);
//   const userCollapsedPreferenceRef = useRef(isSidebarCollapsed);

//   const handleFileChange = (e) => {
//     console.log('File(s) selected:', e.target.files);
//   };

//   const handleFolderChange = (e) => {
//     console.log('Folder(s) selected:', e.target.files);
//   };

//   const { user } = useAuth();

//   useEffect(() => {
//     const loadUserData = () => {
//       try {
//         const storedUserData = localStorage.getItem('user');
//         if (storedUserData) {
//           const parsedUserData = JSON.parse(storedUserData);
//           setUserData(parsedUserData);
//         }
//       } catch (error) {
//         console.error('Error parsing user data from localStorage:', error);
//       }
//     };

//     loadUserData();

//     const handleStorageChange = (e) => {
//       if (e.key === 'user') {
//         loadUserData();
//       }
//     };

//     window.addEventListener('storage', handleStorageChange);

//     return () => {
//       window.removeEventListener('storage', handleStorageChange);
//     };
//   }, []);

//   const getDisplayName = (userInfo) => {
//     if (userData?.username) return userData.username;
//     if (userInfo?.username) return userInfo.username;
//     if (userData?.email) {
//       const emailPart = userData.email.split('@')[0];
//       return emailPart.replace(/[._-]/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
//     }
//     if (userInfo?.email) {
//       const emailPart = userInfo.email.split('@')[0];
//       return emailPart.replace(/[._-]/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
//     }
//     return 'User';
//   };

//   const getInitials = (userInfo) => {
//     if (userData?.username) {
//       const username = userData.username.trim();
//       if (username.includes(' ')) {
//         const parts = username.split(' ').filter((part) => part.length > 0);
//         return parts.length >= 2 ? parts[0].charAt(0).toUpperCase() + parts[parts.length - 1].charAt(0).toUpperCase() : username.charAt(0).toUpperCase();
//       }
//       return username.charAt(0).toUpperCase();
//     }
//     if (userInfo?.username) {
//       const username = userInfo.username.trim();
//       if (username.includes(' ')) {
//         const parts = username.split(' ').filter((part) => part.length > 0);
//         return parts.length >= 2 ? parts[0].charAt(0).toUpperCase() + parts[parts.length - 1].charAt(0).toUpperCase() : username.charAt(0).toUpperCase();
//       }
//       return username.charAt(0).toUpperCase();
//     }
//     if (userData?.email) {
//       const emailPart = userData.email.split('@')[0];
//       if (emailPart.includes('.')) return emailPart.split('.')[0].charAt(0).toUpperCase() + emailPart.split('.')[emailPart.split('.').length - 1].charAt(0).toUpperCase();
//       if (emailPart.includes('_')) return emailPart.split('_')[0].charAt(0).toUpperCase() + emailPart.split('_')[emailPart.split('_').length - 1].charAt(0).toUpperCase();
//       return emailPart.charAt(0).toUpperCase();
//     }
//     if (userInfo?.email) {
//       const emailPart = userInfo.email.split('@')[0];
//       if (emailPart.includes('.')) return emailPart.split('.')[0].charAt(0).toUpperCase() + emailPart.split('.')[emailPart.split('.').length - 1].charAt(0).toUpperCase();
//       if (emailPart.includes('_')) return emailPart.split('_')[0].charAt(0).toUpperCase() + emailPart.split('_')[emailPart.split('_').length - 1].charAt(0).toUpperCase();
//       return emailPart.charAt(0).toUpperCase();
//     }
//     return 'U';
//   };

//   const displayName = getDisplayName(user);
//   const userInitials = getInitials(user);

//   // Debug logging - after all state declarations
//   useEffect(() => {
//     console.log('Sidebar render:', { isSidebarHidden, isSidebarCollapsed, isMobile });
//   }, [isSidebarHidden, isSidebarCollapsed, isMobile]);

//   useEffect(() => {
//     const checkDevice = () => {
//       setIsMobile(window.innerWidth < 1024);
//       if (window.innerWidth < 1024) setIsMobileMenuOpen(false);
//     };
//     checkDevice();
//     window.addEventListener('resize', checkDevice);
//     return () => window.removeEventListener('resize', checkDevice);
//   }, []);

//   useEffect(() => {
//     setIsMobileMenuOpen(false);
//   }, [location.pathname]);

//   useEffect(() => {
//     const loadCurrentFileId = () => {
//       const fileId = localStorage.getItem('currentFileId');
//       setCurrentFileId(fileId);
//     };
//     loadCurrentFileId();
//     window.addEventListener('storage', (e) => e.key === 'currentFileId' && setCurrentFileId(e.newValue));
//     window.addEventListener('currentFileIdChanged', (e) => setCurrentFileId(e.detail.fileId));
//     return () => {
//       window.removeEventListener('storage', () => { });
//       window.removeEventListener('currentFileIdChanged', () => { });
//     };
//   }, []);

//   useEffect(() => {
//     if (isMobileMenuOpen) document.body.style.overflow = 'hidden';
//     else document.body.style.overflow = 'unset';
//     return () => (document.body.style.overflow = 'unset');
//   }, [isMobileMenuOpen]);

//   useEffect(() => {
//     const handleClickOutside = (event) => {
//       if (profileButtonRef.current && !profileButtonRef.current.contains(event.target) && profileMenuRef.current && !profileMenuRef.current.contains(event.target) && isProfileMenuOpen) {
//         setIsProfileMenuOpen(false);
//       }
//     };
//     if (isProfileMenuOpen) document.addEventListener('mousedown', handleClickOutside);
//     return () => document.removeEventListener('mousedown', handleClickOutside);
//   }, [isProfileMenuOpen]);

//   useEffect(() => {
//     if (!forceSidebarCollapsed) {
//       userCollapsedPreferenceRef.current = isSidebarCollapsed;
//     }
//   }, [isSidebarCollapsed, forceSidebarCollapsed]);

//   useEffect(() => {
//     if (forceSidebarCollapsed) {
//       if (!isSidebarCollapsed) {
//         setIsSidebarCollapsed(true);
//       }
//     } else if (isSidebarCollapsed !== (userCollapsedPreferenceRef.current ?? false)) {
//       setIsSidebarCollapsed(userCollapsedPreferenceRef.current ?? false);
//     }
//   }, [forceSidebarCollapsed, isSidebarCollapsed, setIsSidebarCollapsed]);

//   const toggleSidebar = () => {
//     if (isMobile) {
//       setIsMobileMenuOpen(!isMobileMenuOpen);
//       return;
//     }

//     if (forceSidebarCollapsed) {
//       setForceSidebarCollapsed(false);
//       userCollapsedPreferenceRef.current = false;
//       setIsSidebarCollapsed(false);
//       return;
//     }

//     setIsSidebarCollapsed((prev) => {
//       const next = !prev;
//       userCollapsedPreferenceRef.current = next;
//       return next;
//     });
//   };

//   const toggleProfileMenu = () => {
//     if (!isProfileMenuOpen && isSidebarCollapsed && !isMobile) calculatePopupPosition();
//     setIsProfileMenuOpen(!isProfileMenuOpen);
//   };

//   const isActive = (path) => location.pathname === path || location.pathname.startsWith(path + '/');

//   const handleChatNavigation = () => {
//     if (currentFileId) navigate(`/chats/${currentFileId}`);
//     else navigate('/chats');
//   };

//   const navigationItems = [
//     { name: 'Dashboard', path: '/dashboard', icon: ChartBarIcon },
//     { name: 'Projects', path: '/documents', icon: DocumentTextIcon },
//     { name: 'ICOM', path: '/analysis', icon: MagnifyingGlassCircleIcon },
//     { name: 'ChatModel', path: '/chatmodel', icon: ChatBubbleLeftRightIcon },
//     { name: 'Chats', path: '/chats', icon: MessageSquare, isSpecial: true },
//     { name: 'Tools', path: '/tools', icon: Cog6ToothIcon },
//     { name: 'Document Drafting', path: '/draft-selection', icon: PencilSquareIcon },
//     { name: 'Billing & Usage', path: '/billing-usage', icon: CreditCardIcon },
//   ];

//   const JuriNexLogo = ({ collapsed = false }) => (
//     <div className="flex items-center space-x-3">
//       <img
//         src={JuriNexLogoImg}
//         alt="JuriNex Logo"
//         className="h-12 w-12 object-contain flex-shrink-0"
//       />
//       {!collapsed && (
//         <div className="flex items-baseline">
//           <span className="text-xl font-bold text-[#21C1B6]">Juri</span>
//           <span className="text-xl font-bold text-white">Nex</span>
//         </div>
//       )}
//     </div>
//   );

//   const MobileHeader = () => (
//     <div className="lg:hidden fixed top-0 left-0 right-0 z-40 bg-[#0d1117] border-b border-gray-900 px-4 py-3 flex items-center justify-between">
//       <JuriNexLogo />
//       <button onClick={() => setIsMobileMenuOpen(true)} className="p-2 rounded-lg hover:bg-gray-900 transition-colors duration-200">
//         <Bars3Icon className="h-6 w-6 text-gray-400" />
//       </button>
//     </div>
//   );

//   const SidebarContent = ({ isMobileView = false, toggleProfileMenu, isProfileMenuOpen }) => (
//     <div className="flex flex-col h-full bg-[#0d1117]">
//       <div className={`py-5 border-b border-gray-900 relative ${isSidebarCollapsed && !isMobileView ? 'px-2' : 'px-6'} transition-all duration-300`}>
//         {isMobileView ? (
//           <div className="flex items-center justify-between">
//             <JuriNexLogo />
//             <button onClick={() => setIsMobileMenuOpen(false)} className="p-2 rounded-lg hover:bg-gray-900 transition-colors duration-200">
//               <XMarkIcon className="h-6 w-6 text-gray-400" />
//             </button>
//           </div>
//         ) : (
//           <div className="relative flex items-center">
//             <div className={`flex ${isSidebarCollapsed ? 'justify-center flex-1' : 'flex-1'}`}>
//               <JuriNexLogo collapsed={isSidebarCollapsed} />
//             </div>
//             <button
//               onClick={toggleSidebar}
//               className="absolute top-1/2 -translate-y-1/2 -right-4 bg-[#1a1d23] hover:bg-gray-700 rounded-full p-1.5 transition-all duration-200 group border border-gray-700 shadow-lg z-50"
//               title={isSidebarCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
//             >
//               {isSidebarCollapsed ? (
//                 <ChevronRightIcon className="h-4 w-4 text-gray-400 group-hover:text-white transition-colors" />
//               ) : (
//                 <ChevronLeftIcon className="h-4 w-4 text-gray-400 group-hover:text-white transition-colors" />
//               )}
//             </button>
//           </div>
//         )}
//       </div>

//       <div className="px-4 pt-6 pb-4">
//         <button
//           onClick={() => navigate('/analysis', { state: { newChat: true } })}
//           className={`w-full text-white rounded-xl py-3 text-sm font-bold flex items-center justify-center transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 ${isSidebarCollapsed && !isMobileView ? 'px-2' : ''
//             }`}
//           style={{ backgroundColor: '#21C1B6' }}
//           onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1AA49B')}
//           onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#21C1B6')}
//           title={isSidebarCollapsed && !isMobileView ? 'New Case Analysis' : undefined}
//         >
//           <PlusIcon className={`h-5 w-5 ${isSidebarCollapsed && !isMobileView ? '' : ''}`} />
//           <span className={`${isSidebarCollapsed && !isMobileView ? 'hidden' : 'inline ml-2'}`}>New Case Analysis</span>
//         </button>
//       </div>

//       <div className="flex-1 overflow-y-auto px-3 pb-4">
//         <div className="mb-6">
//           <nav className="space-y-1">
//             {navigationItems.map((item) => {
//               const Icon = item.icon;
//               const active = isActive(item.path);
//               const isChats = item.name === 'Chats';
//               const isCollapsed = isSidebarCollapsed && !isMobileView;
//               return (
//                 <div key={item.name}>
//                   {isChats ? (
//                     <Link
//                       to={currentFileId ? `/chats/${currentFileId}` : '/chats'}
//                       className={`group flex items-center w-full ${isCollapsed ? 'justify-center px-3' : 'px-4'} py-3 text-base rounded-xl transition-all duration-200 relative ${active ? 'bg-[#1c2128] text-white font-bold' : 'text-gray-400 hover:bg-[#1c2128]/60 hover:text-gray-200 font-medium'
//                         }`}
//                       title={isCollapsed ? item.name : undefined}
//                     >
//                       <Icon
//                         className={`h-5 w-5 ${isCollapsed ? '' : 'mr-3'} transition-colors duration-200 flex-shrink-0 ${active ? 'text-white' : 'text-gray-500 group-hover:text-gray-300'
//                           }`}
//                       />
//                       <span className={`${isCollapsed ? 'hidden' : 'inline'} transition-all duration-200 truncate`}>{item.name}</span>
//                     </Link>
//                   ) : (
//                     <Link
//                       to={item.path}
//                       className={`group flex items-center w-full ${isCollapsed ? 'justify-center px-3' : 'px-4'} py-3 text-base rounded-xl transition-all duration-200 relative ${active ? 'bg-[#1c2128] text-white font-bold' : 'text-gray-400 hover:bg-[#1c2128]/60 hover:text-gray-200 font-medium'
//                         }`}
//                       title={isCollapsed ? item.name : undefined}
//                     >
//                       <Icon
//                         className={`h-5 w-5 ${isCollapsed ? '' : 'mr-3'} transition-colors duration-200 flex-shrink-0 ${active ? 'text-white' : 'text-gray-500 group-hover:text-gray-300'
//                           }`}
//                       />
//                       <span className={`${isCollapsed ? 'hidden' : 'inline'} transition-all duration-200 truncate`}>{item.name}</span>
//                     </Link>
//                   )}
//                 </div>
//               );
//             })}
//           </nav>
//         </div>
//       </div>

//       <div className="px-3 pb-4 border-t border-gray-900 pt-4 bg-[#0d1117] relative">
//         <button
//           ref={profileButtonRef}
//           onClick={toggleProfileMenu}
//           className={`w-full flex items-center text-gray-400 hover:bg-[#1c2128]/60 rounded-xl py-3 text-sm font-medium transition-all duration-200 ${isSidebarCollapsed && !isMobileView ? 'justify-center px-2' : 'justify-between px-4 space-x-3'
//             }`}
//           title={isSidebarCollapsed && !isMobileView ? displayName : undefined}
//         >
//           <div className={`flex items-center min-w-0 flex-1 ${isSidebarCollapsed && !isMobileView ? 'justify-center' : 'space-x-3'}`}>
//             <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0 shadow-lg" style={{ backgroundColor: '#21C1B6' }}>
//               {userInitials}
//             </div>
//             {(!isSidebarCollapsed || isMobileView) && (
//               <div className="text-left min-w-0 flex-1">
//                 <div className="text-sm font-semibold text-gray-200 truncate">{displayName}</div>
//                 {userData?.email && <div className="text-xs text-gray-500 truncate">{userData.email}</div>}
//               </div>
//             )}
//           </div>
//           {(!isSidebarCollapsed || isMobileView) && <ChevronDown className="h-4 w-4 text-gray-500 flex-shrink-0" />}
//         </button>
//         {isProfileMenuOpen && !isSidebarCollapsed && (
//           <div
//             ref={profileMenuRef}
//             className={`absolute bottom-full ${isSidebarCollapsed && !isMobileView ? 'left-0 w-64 ml-[-50%]' : 'left-0 w-full'} mb-2 bg-[#161b22] border border-gray-800 rounded-xl shadow-2xl z-50 overflow-hidden max-w-xs`}
//             style={{ transform: isSidebarCollapsed && !isMobileView ? 'translateX(-50%)' : 'none' }}
//           >
//             <UserProfileMenu userData={userData || user} navigate={navigate} />
//           </div>
//         )}
//       </div>
//     </div>
//   );

//   const calculatePopupPosition = () => {
//     if (profileButtonRef.current) {
//       const rect = profileButtonRef.current.getBoundingClientRect();
//       const isCollapsed = isSidebarCollapsed && !isMobile;
//       if (isCollapsed) {
//         setProfileMenuPosition({
//           top: Math.max(10, window.innerHeight - 350),
//           left: rect.right + 8,
//         });
//       }
//     }
//   };

//   const ProfileMenuPopup = () => {
//     if (!isProfileMenuOpen || !isSidebarCollapsed || isMobile) return null;
//     return createPortal(
//       <div
//         ref={profileMenuRef}
//         className="bg-[#161b22] border border-gray-800 rounded-xl shadow-2xl z-50 overflow-hidden max-w-xs"
//         style={{
//           position: 'fixed',
//           top: `${profileMenuPosition.top}px`,
//           left: `${profileMenuPosition.left}px`,
//           width: '256px',
//         }}
//       >
//         <UserProfileMenu userData={userData || user} navigate={navigate} />
//       </div>,
//       document.body
//     );
//   };

//   useEffect(() => {
//     if (isProfileMenuOpen && isSidebarCollapsed && !isMobile) calculatePopupPosition();
//   }, [isSidebarCollapsed, isProfileMenuOpen, isMobile]);

//   return (
//     <>
//       <MobileHeader />
//       {!isSidebarHidden && (
//         <div
//           className={`hidden lg:flex bg-[#0d1117] border-r border-gray-900 flex-col transition-all duration-300 ease-in-out shadow-2xl ${isSidebarCollapsed ? 'w-20' : 'w-72'
//             } relative h-screen overflow-visible`}
//           data-sidebar-root
//           style={{ display: 'flex' }}
//         >
//           <SidebarContent toggleProfileMenu={toggleProfileMenu} isProfileMenuOpen={isProfileMenuOpen} />
//         </div>
//       )}
//       {isMobileMenuOpen && (
//         <div className="lg:hidden fixed inset-0 z-50 flex">
//           <div
//             className="fixed inset-0 bg-black bg-opacity-70 transition-opacity duration-300 backdrop-blur-sm"
//             onClick={() => setIsMobileMenuOpen(false)}
//           />
//           <div className="relative flex flex-col w-80 max-w-xs bg-[#0d1117] shadow-2xl transform transition-transform duration-300 ease-in-out">
//             <SidebarContent isMobileView={true} toggleProfileMenu={toggleProfileMenu} isProfileMenuOpen={isProfileMenuOpen} />
//           </div>
//         </div>
//       )}
//       <ProfileMenuPopup />
//       <input
//         ref={fileInputRef}
//         type="file"
//         multiple
//         onChange={handleFileChange}
//         className="hidden"
//         accept=".pdf,.doc,.docx,.txt,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.gif"
//       />
//       <input
//         ref={folderInputRef}
//         type="file"
//         multiple
//         onChange={handleFolderChange}
//         className="hidden"
//         webkitdirectory=""
//         directory=""
//       />
//     </>
//   );
// };

// const FolderTreeComponent = ({ items, level = 0, parentPath = '', expandedFolders, toggleFolder, selectFolder, selectedFolder, searchQuery = '' }) => {
//   return items
//     .filter((item) => item.name.toLowerCase().includes(searchQuery.toLowerCase()))
//     .map((item, index) => {
//       const itemPath = parentPath ? `${parentPath}/${item.name}` : item.name;
//       const isExpanded = expandedFolders.has(itemPath);
//       const hasChildren = item.children && item.children.length > 0;
//       const isSelected = selectedFolder?.id === item.id;
//       return (
//         <div key={`${itemPath}-${index}`} className="select-none">
//           <button
//             onClick={() => selectFolder(item)}
//             className={`group flex items-center w-full py-2 px-3 mx-1 rounded-lg cursor-pointer hover:bg-[#1c2128]/60 transition-colors ${isSelected ? 'bg-[#1c2128] text-white font-bold' : 'text-gray-400 font-medium'
//               }`}
//             style={{ paddingLeft: `${(level * 16) + 12}px` }}
//           >
//             {hasChildren && (
//               <span
//                 onClick={(e) => {
//                   e.stopPropagation();
//                   toggleFolder(itemPath);
//                 }}
//                 className="mr-2 p-0.5 rounded hover:bg-gray-800 transition-colors"
//               >
//                 {isExpanded ? <ChevronDown className="w-4 h-4 text-gray-500" /> : <ChevronRight className="w-4 h-4 text-gray-500" />}
//               </span>
//             )}
//             {!hasChildren && <span className="w-4 h-4 mr-2" />}
//             <Folder className={`h-4 w-4 mr-2 flex-shrink-0 ${isSelected ? 'text-white' : 'text-gray-500'}`} />
//             <span className="text-sm truncate">{item.name}</span>
//           </button>
//           {hasChildren && isExpanded && (
//             <div className="mt-0.5">
//               <FolderTreeComponent
//                 items={item.children}
//                 level={level + 1}
//                 parentPath={itemPath}
//                 expandedFolders={expandedFolders}
//                 toggleFolder={toggleFolder}
//                 selectFolder={selectFolder}
//                 selectedFolder={selectedFolder}
//                 searchQuery={searchQuery}
//               />
//             </div>
//           )}
//         </div>
//       );
//     });
// };

// export default Sidebar;


import React, { useState, useEffect, useRef } from 'react';
import DeepSeekSidebarChat from './DeepSeekSidebarChat';
import '../styles/DeepSeekSidebarChat.css';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
  ChartBarIcon,
  DocumentTextIcon,
  MagnifyingGlassCircleIcon,
  PencilSquareIcon,
  ScaleIcon,
  ClockIcon,
  UserGroupIcon,
  Bars3Icon,
  XMarkIcon,
  CreditCardIcon,
  BellIcon,
  QuestionMarkCircleIcon,
  ChatBubbleLeftRightIcon,
  GlobeAltIcon,
  ArchiveBoxIcon,
} from '@heroicons/react/24/outline';
import {
  FolderPlus,
  FileUp,
  Home,
  Folder,
  Upload,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  LogOut,
  User,
  Settings,
  Zap,
} from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import UserProfileMenu from './UserProfileMenu';
import QuickTools from './QuickTools';
import { useFileManager } from '../context/FileManagerContext';
import { useAuth } from '../context';
import { useSidebar } from '../context/SidebarContext';
import { canUsePermission, PERMISSION_KEYS } from '../utils/permissions';
import { createPortal } from 'react-dom';
import JuriNexWordmarkImg from '/src/assets/jurinex-wordmark-light.png';
import JuriNexMarkImg from '/src/assets/jurinex-mark.png';

const Sidebar = () => {
  const { isSidebarHidden, setIsSidebarHidden, isSidebarCollapsed, setIsSidebarCollapsed, forceSidebarCollapsed, setForceSidebarCollapsed } = useSidebar();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isDeepSeekOpen, setIsDeepSeekOpen] = useState(false);
  const [currentFileId, setCurrentFileId] = useState(null);
  const [isMobile, setIsMobile] = useState(false);
  const [isDocumentUploadOpen, setIsDocumentUploadOpen] = useState(false);
  const [userData, setUserData] = useState(null);
  const [profileMenuPosition, setProfileMenuPosition] = useState({ top: 0, left: 0 });

  const location = useLocation();
  const navigate = useNavigate();

  const { createFolder } = useFileManager();

  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const profileButtonRef = useRef(null);
  const profileMenuRef = useRef(null);
  const userCollapsedPreferenceRef = useRef(isSidebarCollapsed);

  const handleFileChange = (e) => {
    console.log('File(s) selected:', e.target.files);
  };

  const handleFolderChange = (e) => {
    console.log('Folder(s) selected:', e.target.files);
  };

  const { user } = useAuth();

  useEffect(() => {
    const loadUserData = () => {
      try {
        const storedUserData = localStorage.getItem('user');
        if (storedUserData) {
          const parsedUserData = JSON.parse(storedUserData);
          setUserData(parsedUserData);
        }
      } catch (error) {
        console.error('Error parsing user data from localStorage:', error);
      }
    };

    loadUserData();

    const handleStorageChange = (e) => {
      if (e.key === 'user') {
        loadUserData();
      }
    };

    window.addEventListener('storage', handleStorageChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  const getDisplayName = (userInfo) => {
    if (userData?.username) return userData.username;
    if (userInfo?.username) return userInfo.username;
    if (userData?.email) {
      const emailPart = userData.email.split('@')[0];
      return emailPart.replace(/[._-]/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
    }
    if (userInfo?.email) {
      const emailPart = userInfo.email.split('@')[0];
      return emailPart.replace(/[._-]/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
    }
    return 'User';
  };

  const getInitials = (userInfo) => {
    if (userData?.username) {
      const username = userData.username.trim();
      if (username.includes(' ')) {
        const parts = username.split(' ').filter((part) => part.length > 0);
        return parts.length >= 2 ? parts[0].charAt(0).toUpperCase() + parts[parts.length - 1].charAt(0).toUpperCase() : username.charAt(0).toUpperCase();
      }
      return username.charAt(0).toUpperCase();
    }
    if (userInfo?.username) {
      const username = userInfo.username.trim();
      if (username.includes(' ')) {
        const parts = username.split(' ').filter((part) => part.length > 0);
        return parts.length >= 2 ? parts[0].charAt(0).toUpperCase() + parts[parts.length - 1].charAt(0).toUpperCase() : username.charAt(0).toUpperCase();
      }
      return username.charAt(0).toUpperCase();
    }
    if (userData?.email) {
      const emailPart = userData.email.split('@')[0];
      if (emailPart.includes('.')) return emailPart.split('.')[0].charAt(0).toUpperCase() + emailPart.split('.')[emailPart.split('.').length - 1].charAt(0).toUpperCase();
      if (emailPart.includes('_')) return emailPart.split('_')[0].charAt(0).toUpperCase() + emailPart.split('_')[emailPart.split('_').length - 1].charAt(0).toUpperCase();
      return emailPart.charAt(0).toUpperCase();
    }
    if (userInfo?.email) {
      const emailPart = userInfo.email.split('@')[0];
      if (emailPart.includes('.')) return emailPart.split('.')[0].charAt(0).toUpperCase() + emailPart.split('.')[emailPart.split('.').length - 1].charAt(0).toUpperCase();
      if (emailPart.includes('_')) return emailPart.split('_')[0].charAt(0).toUpperCase() + emailPart.split('_')[emailPart.split('_').length - 1].charAt(0).toUpperCase();
      return emailPart.charAt(0).toUpperCase();
    }
    return 'U';
  };

  const displayName = getDisplayName(user);
  const userInitials = getInitials(user);

  // Debug logging - after all state declarations
  useEffect(() => {
    console.log('Sidebar render:', { isSidebarHidden, isSidebarCollapsed, isMobile });
  }, [isSidebarHidden, isSidebarCollapsed, isMobile]);

  useEffect(() => {
    const checkDevice = () => {
      setIsMobile(window.innerWidth < 1024);
      if (window.innerWidth < 1024) setIsMobileMenuOpen(false);
    };
    checkDevice();
    window.addEventListener('resize', checkDevice);
    return () => window.removeEventListener('resize', checkDevice);
  }, []);

  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const loadCurrentFileId = () => {
      const fileId = localStorage.getItem('currentFileId');
      setCurrentFileId(fileId);
    };
    loadCurrentFileId();
    window.addEventListener('storage', (e) => e.key === 'currentFileId' && setCurrentFileId(e.newValue));
    window.addEventListener('currentFileIdChanged', (e) => setCurrentFileId(e.detail.fileId));
    return () => {
      window.removeEventListener('storage', () => { });
      window.removeEventListener('currentFileIdChanged', () => { });
    };
  }, []);

  useEffect(() => {
    if (isMobileMenuOpen) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = 'unset';
    return () => (document.body.style.overflow = 'unset');
  }, [isMobileMenuOpen]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (profileButtonRef.current && !profileButtonRef.current.contains(event.target) && profileMenuRef.current && !profileMenuRef.current.contains(event.target) && isProfileMenuOpen) {
        setIsProfileMenuOpen(false);
      }
    };
    if (isProfileMenuOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isProfileMenuOpen]);

  useEffect(() => {
    if (!forceSidebarCollapsed) {
      userCollapsedPreferenceRef.current = isSidebarCollapsed;
    }
  }, [isSidebarCollapsed, forceSidebarCollapsed]);

  useEffect(() => {
    if (forceSidebarCollapsed) {
      if (!isSidebarCollapsed) {
        setIsSidebarCollapsed(true);
      }
    } else if (isSidebarCollapsed !== (userCollapsedPreferenceRef.current ?? false)) {
      setIsSidebarCollapsed(userCollapsedPreferenceRef.current ?? false);
    }
  }, [forceSidebarCollapsed, isSidebarCollapsed, setIsSidebarCollapsed]);

  const toggleSidebar = () => {
    if (isMobile) {
      setIsMobileMenuOpen(!isMobileMenuOpen);
      return;
    }

    if (forceSidebarCollapsed) {
      setForceSidebarCollapsed(false);
      userCollapsedPreferenceRef.current = false;
      setIsSidebarCollapsed(false);
      return;
    }

    setIsSidebarCollapsed((prev) => {
      const next = !prev;
      userCollapsedPreferenceRef.current = next;
      return next;
    });
  };

  const toggleProfileMenu = () => {
    if (!isProfileMenuOpen && isSidebarCollapsed && !isMobile) calculatePopupPosition();
    setIsProfileMenuOpen(!isProfileMenuOpen);
  };

  const isActive = (path) => location.pathname === path || location.pathname.startsWith(path + '/');

  const handleChatNavigation = () => {
    if (currentFileId) navigate(`/chats/${currentFileId}`);
    else navigate('/chats');
  };

  const accountType = (user?.account_type || userData?.account_type || '').toUpperCase();
  const isFirmAdmin = accountType === 'FIRM_ADMIN';
  const isFirmMember = isFirmAdmin || accountType === 'FIRM_USER';
  const permissionUser = user || userData;
  const canCreateCases = canUsePermission(permissionUser, PERMISSION_KEYS.CREATE_CASE);

  const navigationItems = [
    { name: 'Dashboard', path: '/dashboard', icon: ChartBarIcon },
    { name: 'Ongoing Cases', path: '/documents', icon: DocumentTextIcon },
    { name: 'Case Storage', path: '/case-storage', icon: ArchiveBoxIcon },
    { name: 'Citation Research', path: '/citation-research', icon: ScaleIcon },
    { name: 'Quick Chat', path: '/chatmodel', icon: ChatBubbleLeftRightIcon },
    { name: 'Chats', path: '/chats', icon: MessageSquare, isSpecial: true },
    { name: 'Translation', path: '/translation', icon: GlobeAltIcon },
    // Temporarily hidden — restore by uncommenting:
    // { name: 'DeepSeek AI', icon: null, isDeepSeek: true },
    // { name: 'Document Drafting', path: '/draft-selection', icon: PencilSquareIcon },
    { name: 'User Management', path: '/user-management', icon: UserGroupIcon, firmMemberOnly: true },
  ];

  const JuriNexLogo = ({ collapsed = false }) => (
    <div className="flex items-center">
      <img
        src={collapsed ? JuriNexMarkImg : JuriNexWordmarkImg}
        alt="JURINEX"
        className={`${collapsed ? 'h-10 w-10 rounded-lg' : 'h-9 w-auto'} object-contain flex-shrink-0`}
      />
    </div>
  );

  const MobileHeader = () => (
    <div className="jnx-keep-colors lg:hidden fixed top-0 left-0 right-0 z-40 bg-[#0d1117] border-b border-gray-900 px-4 py-3 flex items-center justify-between">
      <JuriNexLogo />
      <button onClick={() => setIsMobileMenuOpen(true)} className="p-2 rounded-lg hover:bg-gray-900 transition-colors duration-200">
        <Bars3Icon className="h-6 w-6 text-gray-400" />
      </button>
    </div>
  );

  const SidebarContent = ({ isMobileView = false, toggleProfileMenu, isProfileMenuOpen }) => (
    // jnx-keep-colors: the sidebar is dark by design — exempt it from the
    // dark theme's root inversion so it keeps its own #0d1117 look.
    <div className="jnx-keep-colors flex flex-col h-full bg-[#0d1117]">
      <div className={`py-5 border-b border-gray-900 relative ${isSidebarCollapsed && !isMobileView ? 'px-2' : 'px-6'} transition-all duration-300`}>
        {isMobileView ? (
          <div className="flex items-center justify-between">
            <JuriNexLogo />
            <button onClick={() => setIsMobileMenuOpen(false)} className="p-2 rounded-lg hover:bg-gray-900 transition-colors duration-200">
              <XMarkIcon className="h-6 w-6 text-gray-400" />
            </button>
          </div>
        ) : (
          <div className="relative flex items-center">
            <div className={`flex ${isSidebarCollapsed ? 'justify-center flex-1' : 'flex-1'}`}>
              <JuriNexLogo collapsed={isSidebarCollapsed} />
            </div>
            <button
              onClick={toggleSidebar}
              className="absolute top-1/2 -translate-y-1/2 -right-4 bg-[#1a1d23] hover:bg-gray-700 rounded-full p-1.5 transition-all duration-200 group border border-gray-700 shadow-lg z-50"
              title={isSidebarCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
            >
              {isSidebarCollapsed ? (
                <ChevronRightIcon className="h-4 w-4 text-gray-400 group-hover:text-white transition-colors" />
              ) : (
                <ChevronLeftIcon className="h-4 w-4 text-gray-400 group-hover:text-white transition-colors" />
              )}
            </button>
          </div>
        )}
      </div>

      <div className="px-4 pt-6 pb-4">
        <button
          onClick={() => {
            if (!canCreateCases) return;
            navigate('/chatmodel', { state: { newChat: true } });
          }}
          disabled={!canCreateCases}
          className={`w-full text-white rounded-xl py-3 text-base font-bold flex items-center justify-center transition-all duration-200 shadow-lg ${canCreateCases ? 'hover:shadow-xl transform hover:-translate-y-0.5' : 'cursor-not-allowed opacity-50'} ${isSidebarCollapsed && !isMobileView ? 'px-2' : ''
            }`}
          style={{ backgroundColor: '#21C1B6' }}
          onMouseEnter={(e) => {
            if (canCreateCases) e.currentTarget.style.backgroundColor = '#1AA49B';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = '#21C1B6';
          }}
          title={
            !canCreateCases
              ? 'You do not have permission to create new cases'
              : isSidebarCollapsed && !isMobileView
                ? 'New Case Analysis'
                : undefined
          }
        >
          <PlusIcon className={`h-5 w-5 ${isSidebarCollapsed && !isMobileView ? '' : ''}`} />
          <span className={`${isSidebarCollapsed && !isMobileView ? 'hidden' : 'inline ml-2'}`}>New Case Analysis</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-4">
        <div className="mb-6">
          <nav className="space-y-1">
            {navigationItems.map((item) => {
              if (item.firmAdminOnly && !isFirmAdmin) return null;
              if (item.firmMemberOnly && !isFirmMember) return null;
              const Icon = item.icon;
              const active = isActive(item.path);
              const isChats = item.name === 'Chats';
              const isCollapsed = isSidebarCollapsed && !isMobileView;

              // ── DeepSeek AI button ────────────────────────────────────
              if (item.isDeepSeek) {
                return (
                  <div key="deepseek-ai">
                    <button
                      onClick={() => setIsDeepSeekOpen((v) => !v)}
                      className={`group flex items-center w-full ${isCollapsed ? 'justify-center px-3' : 'px-4'} py-3 text-base rounded-xl transition-all duration-200 relative ${isDeepSeekOpen ? 'bg-[#1c2128] text-white font-bold' : 'text-gray-400 hover:bg-[#1c2128]/60 hover:text-gray-200 font-medium'}`}
                      title={isCollapsed ? 'DeepSeek AI' : undefined}
                    >
                      <Zap
                        className={`h-5 w-5 ${isCollapsed ? '' : 'mr-3'} transition-colors duration-200 flex-shrink-0 ${isDeepSeekOpen ? 'text-[#21C1B6]' : 'text-gray-500 group-hover:text-gray-300'}`}
                      />
                      <span className={`${isCollapsed ? 'hidden' : 'inline'} transition-all duration-200 truncate`}>DeepSeek AI</span>
                      {isDeepSeekOpen && !isCollapsed && (
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 w-2 h-2 bg-[#21C1B6] rounded-full" />
                      )}
                    </button>
                  </div>
                );
              }

              return (
                <div key={item.name}>
                  {isChats ? (
                    <Link
                      to={currentFileId ? `/chats/${currentFileId}` : '/chats'}
                      className={`group flex items-center w-full ${isCollapsed ? 'justify-center px-3' : 'px-4'} py-3 text-base rounded-xl transition-all duration-200 relative ${active ? 'bg-[#1c2128] text-white font-bold' : 'text-gray-400 hover:bg-[#1c2128]/60 hover:text-gray-200 font-medium'
                        }`}
                      title={isCollapsed ? item.name : undefined}
                    >
                      <Icon
                        className={`h-5 w-5 ${isCollapsed ? '' : 'mr-3'} transition-colors duration-200 flex-shrink-0 ${active ? 'text-white' : 'text-gray-500 group-hover:text-gray-300'
                          }`}
                      />
                      <span className={`${isCollapsed ? 'hidden' : 'inline'} transition-all duration-200 truncate`}>{item.name}</span>
                    </Link>
                  ) : (
                    <Link
                      to={item.path}
                      className={`group flex items-center w-full ${isCollapsed ? 'justify-center px-3' : 'px-4'} py-3 text-base rounded-xl transition-all duration-200 relative ${active ? 'bg-[#1c2128] text-white font-bold' : 'text-gray-400 hover:bg-[#1c2128]/60 hover:text-gray-200 font-medium'
                        }`}
                      title={isCollapsed ? item.name : undefined}
                    >
                      <Icon
                        className={`h-5 w-5 ${isCollapsed ? '' : 'mr-3'} transition-colors duration-200 flex-shrink-0 ${active ? 'text-white' : 'text-gray-500 group-hover:text-gray-300'
                          }`}
                      />
                      <span className={`${isCollapsed ? 'hidden' : 'inline'} transition-all duration-200 truncate`}>{item.name}</span>
                    </Link>
                  )}
                </div>
              );
            })}
          </nav>
        </div>
      </div>

      <div className="px-3 pb-4 border-t border-gray-900 pt-4 bg-[#0d1117] relative">
        <button
          ref={profileButtonRef}
          onClick={toggleProfileMenu}
          className={`w-full flex items-center text-gray-400 hover:bg-[#1c2128]/60 rounded-xl py-3 text-sm font-medium transition-all duration-200 ${isSidebarCollapsed && !isMobileView ? 'justify-center px-2' : 'justify-between px-4 space-x-3'
            }`}
          title={isSidebarCollapsed && !isMobileView ? displayName : undefined}
        >
          <div className={`flex items-center min-w-0 flex-1 ${isSidebarCollapsed && !isMobileView ? 'justify-center' : 'space-x-3'}`}>
            <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0 shadow-lg" style={{ backgroundColor: '#21C1B6' }}>
              {userInitials}
            </div>
            {(!isSidebarCollapsed || isMobileView) && (
              <div className="text-left min-w-0 flex-1">
                <div className="text-base font-semibold text-gray-200 truncate">{displayName}</div>
                {userData?.email && <div className="text-xs text-gray-500 truncate">{userData.email}</div>}
              </div>
            )}
          </div>
          {(!isSidebarCollapsed || isMobileView) && <ChevronDown className="h-4 w-4 text-gray-500 flex-shrink-0" />}
        </button>
        {isProfileMenuOpen && !isSidebarCollapsed && (
          <div
            ref={profileMenuRef}
            className="absolute bottom-full left-0 w-full mb-2 z-50"
          >
            <UserProfileMenu
              userData={userData || user}
              navigate={navigate}
              onClose={() => setIsProfileMenuOpen(false)}
            />
          </div>
        )}
      </div>
    </div>
  );

  const calculatePopupPosition = () => {
    if (profileButtonRef.current) {
      const rect = profileButtonRef.current.getBoundingClientRect();
      const menuHeight = 420;
      const top = Math.max(8, Math.min(rect.top, window.innerHeight - menuHeight - 8));
      setProfileMenuPosition({
        top,
        left: rect.right + 8,
      });
    }
  };

  const ProfileMenuPopup = () => {
    if (!isProfileMenuOpen || !isSidebarCollapsed || isMobile) return null;
    return createPortal(
      <div
        ref={profileMenuRef}
        style={{
          position: 'fixed',
          top: `${profileMenuPosition.top}px`,
          left: `${profileMenuPosition.left}px`,
          width: '272px',
          zIndex: 9999,
        }}
      >
        <UserProfileMenu
          userData={userData || user}
          navigate={navigate}
          onClose={() => setIsProfileMenuOpen(false)}
        />
      </div>,
      document.body
    );
  };

  useEffect(() => {
    if (isProfileMenuOpen && isSidebarCollapsed && !isMobile) calculatePopupPosition();
  }, [isSidebarCollapsed, isProfileMenuOpen, isMobile]);

  return (
    <>
      <MobileHeader />
      {!isSidebarHidden && (
        <div
          className={`hidden lg:flex bg-[#0d1117] border-r border-gray-900 flex-col transition-all duration-300 ease-in-out shadow-2xl ${isSidebarCollapsed ? 'w-20' : 'w-72'
            } relative h-full overflow-visible`}
          data-sidebar-root
          style={{ display: 'flex' }}
        >
          <SidebarContent toggleProfileMenu={toggleProfileMenu} isProfileMenuOpen={isProfileMenuOpen} />
        </div>
      )}
      {isMobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-black bg-opacity-70 transition-opacity duration-300 backdrop-blur-sm"
            onClick={() => setIsMobileMenuOpen(false)}
          />
          <div className="jnx-keep-colors relative flex flex-col w-80 max-w-xs bg-[#0d1117] shadow-2xl transform transition-transform duration-300 ease-in-out">
            <SidebarContent isMobileView={true} toggleProfileMenu={toggleProfileMenu} isProfileMenuOpen={isProfileMenuOpen} />
          </div>
        </div>
      )}
      <ProfileMenuPopup />
      <DeepSeekSidebarChat
        isOpen={isDeepSeekOpen}
        onClose={() => setIsDeepSeekOpen(false)}
        sidebarCollapsed={isSidebarCollapsed}
      />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={handleFileChange}
        className="hidden"
        accept=".pdf,.doc,.docx,.txt,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.gif"
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        onChange={handleFolderChange}
        className="hidden"
        webkitdirectory=""
        directory=""
      />
    </>
  );
};

const FolderTreeComponent = ({ items, level = 0, parentPath = '', expandedFolders, toggleFolder, selectFolder, selectedFolder, searchQuery = '' }) => {
  return items
    .filter((item) => item.name.toLowerCase().includes(searchQuery.toLowerCase()))
    .map((item, index) => {
      const itemPath = parentPath ? `${parentPath}/${item.name}` : item.name;
      const isExpanded = expandedFolders.has(itemPath);
      const hasChildren = item.children && item.children.length > 0;
      const isSelected = selectedFolder?.id === item.id;
      return (
        <div key={`${itemPath}-${index}`} className="select-none">
          <button
            onClick={() => selectFolder(item)}
            className={`group flex items-center w-full py-2 px-3 mx-1 rounded-lg cursor-pointer hover:bg-[#1c2128]/60 transition-colors ${isSelected ? 'bg-[#1c2128] text-white font-bold' : 'text-gray-400 font-medium'
              }`}
            style={{ paddingLeft: `${(level * 16) + 12}px` }}
          >
            {hasChildren && (
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFolder(itemPath);
                }}
                className="mr-2 p-0.5 rounded hover:bg-gray-800 transition-colors"
              >
                {isExpanded ? <ChevronDown className="w-4 h-4 text-gray-500" /> : <ChevronRight className="w-4 h-4 text-gray-500" />}
              </span>
            )}
            {!hasChildren && <span className="w-4 h-4 mr-2" />}
            <Folder className={`h-4 w-4 mr-2 flex-shrink-0 ${isSelected ? 'text-white' : 'text-gray-500'}`} />
            <span className="text-sm truncate">{item.name}</span>
          </button>
          {hasChildren && isExpanded && (
            <div className="mt-0.5">
              <FolderTreeComponent
                items={item.children}
                level={level + 1}
                parentPath={itemPath}
                expandedFolders={expandedFolders}
                toggleFolder={toggleFolder}
                selectFolder={selectFolder}
                selectedFolder={selectedFolder}
                searchQuery={searchQuery}
              />
            </div>
          )}
        </div>
      );
    });
};

export default Sidebar;
