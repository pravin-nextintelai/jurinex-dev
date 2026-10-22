import React, { useState, useEffect } from 'react';
import { deleteFirmUser, fetchFirmUsers, resendFirmUserPasswordSetupEmail, updateFirmUserActiveStatus } from '../api/rbacApi';
import AddUserModal from './AddUserModal';
import PermissionsModal from './PermissionsModal';
import { useAuth } from '@/shared/context';
import { canUsePermission, PERMISSION_KEYS } from '@/shared/utils/permissions';
import { toast } from 'react-toastify';

// Features we want to display as columns in the main table based on the reference design
const tableColumns = [
  { id: 'create_new_users', label: 'Create new users' },
  { id: 'view_user_information', label: 'View user information' },
  { id: 'update_user_information', label: 'Update user information' },
  { id: 'delete_users', label: 'Delete users' },
  { id: 'assign_remove_roles_from_users', label: 'Assign/remove roles from users' },
  { id: 'manage_user_permissions', label: 'Manage user permissions' },
  { id: 'view_account_settings', label: 'View account settings' },
  { id: 'upload_documents', label: 'Upload documents' },
  { id: 'view_documents', label: 'View documents' }
];

const UserManagementTable = () => {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [capabilities, setCapabilities] = useState({});
  const [viewerMode, setViewerMode] = useState('admin');
  
  const [isAddUserOpen, setIsAddUserOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);

  const loadUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchFirmUsers();
      setUsers(data.users || []);
      setCapabilities(data.capabilities || {});
      setViewerMode(data.viewerMode || 'admin');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const filteredUsers = users.filter(u => 
    (u.username && u.username.toLowerCase().includes(search.toLowerCase())) ||
    (u.email && u.email.toLowerCase().includes(search.toLowerCase()))
  );
  const currentAccountType = String(currentUser?.account_type || '').toUpperCase();
  const isFirmAdminActor = currentAccountType === 'FIRM_ADMIN';
  const canCreateUsers = capabilities.canCreateUsers ?? canUsePermission(currentUser, PERMISSION_KEYS.CREATE_USERS);
  const canManagePermissions = capabilities.canManageUserPermissions ?? canUsePermission(currentUser, PERMISSION_KEYS.MANAGE_USER_PERMISSIONS);
  const canViewUsers = capabilities.canViewUserInformation ?? canUsePermission(currentUser, PERMISSION_KEYS.VIEW_USER_INFORMATION);
  const canViewRoles = capabilities.canViewRoles ?? canUsePermission(currentUser, PERMISSION_KEYS.VIEW_ROLES);
  const canDeleteFirmUsers = capabilities.canDeleteFirmUsers ?? false;
  const canResendPasswordSetupEmail = capabilities.canResendPasswordSetupEmail ?? false;
  const canUpdateUserInformation = capabilities.canUpdateUserInformation ?? canUsePermission(currentUser, PERMISSION_KEYS.UPDATE_USER_INFORMATION);
  const canManageCaseAssignments =
    capabilities.canManageCaseAssignments
    ?? (
      canManagePermissions
      && (capabilities.canViewCaseInformation ?? canUsePermission(currentUser, PERMISSION_KEYS.VIEW_CASE))
    );
  const canOpenUserManagement =
    canViewUsers
    || canCreateUsers
    || canManagePermissions
    || canViewRoles
    || canDeleteFirmUsers
    || canResendPasswordSetupEmail
    || canUpdateUserInformation;
  const hasMutatingUserActions =
    canCreateUsers
    || canManagePermissions
    || canDeleteFirmUsers
    || canResendPasswordSetupEmail
    || canUpdateUserInformation;
  const isReadOnly = !hasMutatingUserActions || viewerMode === 'read_only';
  const modalReadOnly = !canManagePermissions || (!!selectedUser?.is_firm_admin && !isFirmAdminActor);
  const totalUsersCount = users.length;
  const pendingInvitesCount = users.filter((user) => user.first_login && !user.is_firm_admin).length;
  const editableUsersCount = users.filter((user) => !user.is_firm_admin).length;

  const handleResendCreatePasswordEmail = async (user) => {
    try {
      const response = await resendFirmUserPasswordSetupEmail(user.id);
      toast.success(response.message || 'Create-password email resent successfully.');
      loadUsers();
    } catch (err) {
      console.error('[UserManagementTable] Failed to resend create-password email:', err);
      toast.error(err.response?.data?.message || 'Failed to resend create-password email.');
    }
  };

  const handleDeleteFirmUser = async (user) => {
    const confirmed = window.confirm(`Delete ${user.username || user.email} from this firm? This action cannot be undone.`);
    if (!confirmed) return;

    try {
      const response = await deleteFirmUser(user.id);
      toast.success(response.message || 'Firm user deleted successfully.');
      if (selectedUser?.id === user.id) {
        setSelectedUser(null);
      }
      loadUsers();
    } catch (err) {
      console.error('[UserManagementTable] Failed to delete firm user:', err);
      toast.error(err.response?.data?.message || 'Failed to delete firm user.');
    }
  };

  const handleToggleUserActive = async (user) => {
    const currentlyActive = user.is_active !== false;
    const nextActive = !currentlyActive;
    const actionLabel = nextActive ? 'enable' : 'disable';
    const confirmed = window.confirm(
      nextActive
        ? `Enable ${user.username || user.email}? They will be able to log in again.`
        : `Disable ${user.username || user.email}? They will not be able to log in.`
    );
    if (!confirmed) return;

    try {
      const response = await updateFirmUserActiveStatus(user.id, nextActive);
      toast.success(response.message || `User ${actionLabel}d successfully.`);
      loadUsers();
    } catch (err) {
      console.error('[UserManagementTable] Failed to update user status:', err);
      toast.error(err.response?.data?.message || `Failed to ${actionLabel} user.`);
    }
  };

  const StatusDot = ({ status }) => {
    const isAllowed = status === 'Allowed' || !status; // default Allowed or explicit Allowed
    return (
      <div className="flex justify-center">
        <div className={`h-2.5 w-2.5 rounded-full shadow-sm ${isAllowed ? 'bg-green-500' : 'bg-yellow-500'}`}></div>
      </div>
    );
  };

  return (
    <div className="w-full">
      <div className="mb-6 overflow-hidden rounded-[28px] border border-white/70 bg-white/80 shadow-[0_24px_70px_rgba(15,23,42,0.08)] backdrop-blur-sm">
        <div className="flex flex-col gap-4 border-b border-slate-200/80 px-5 py-5 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#1AA49B]">
              Access Control
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-900">Manage firm access with confidence</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              Review user permissions, invitations, and firm-user actions from one clean workspace without changing the underlying flow.
            </p>
          </div>

          {canCreateUsers && (
            <button
              onClick={() => setIsAddUserOpen(true)}
              className="inline-flex items-center justify-center rounded-xl bg-[#E11D48] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_14px_30px_rgba(225,29,72,0.22)] transition hover:bg-[#BE123C]"
            >
              <span className="mr-2 text-base leading-none">+</span> Add User
            </button>
          )}
        </div>

        <div className="grid gap-3 px-5 py-5 md:grid-cols-[minmax(0,1.5fr)_repeat(3,minmax(0,0.55fr))]">
          <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <div className="text-slate-400">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-4.35-4.35m1.85-5.15a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <input
              type="text"
              placeholder="Search by name or email"
              className="w-full bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-2 text-slate-400">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"></path>
              </svg>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Total users</div>
            <div className="mt-2 text-2xl font-semibold text-slate-900">{totalUsersCount}</div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Pending invites</div>
            <div className="mt-2 text-2xl font-semibold text-slate-900">{pendingInvitesCount}</div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Firm users</div>
            <div className="mt-2 text-2xl font-semibold text-slate-900">{editableUsersCount}</div>
          </div>
        </div>
      </div>

      {isReadOnly && (
        <div className="mb-4 rounded-2xl border border-[#B7ECE8] bg-[#F3FCFB] px-4 py-3 text-sm text-[#275B59] shadow-sm">
          This is a read-only permissions overview. You can see your firm admin&apos;s full permissions and the access currently assigned to your account.
        </div>
      )}

      {!canOpenUserManagement && (
        <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 shadow-sm">
          You do not currently have any enabled User or Role permissions from your firm admin.
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-sm">
          {error}
        </div>
      )}

      {/* Main Table */}
      <div className="overflow-hidden rounded-[28px] border border-slate-200/80 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.08)]">
        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/90 text-center text-xs text-slate-600">
                <th className="w-72 px-6 py-4 text-left font-semibold">User / Email</th>
                {tableColumns.map(col => (
                  <th key={col.id} className="w-24 px-4 py-4 font-semibold leading-tight text-wrap">
                    {col.label}
                  </th>
                ))}
                <th className="px-6 py-4 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {loading ? (
                <tr><td colSpan={tableColumns.length + 2} className="px-6 py-10 text-center text-slate-500">Loading users...</td></tr>
              ) : filteredUsers.length === 0 ? (
                <tr><td colSpan={tableColumns.length + 2} className="px-6 py-10 text-center text-slate-500">No users found</td></tr>
              ) : (
                filteredUsers.map(user => (
                  <tr key={user.id} className="transition hover:bg-slate-50/70">
                    <td className="px-6 py-4 text-left">
                      <div className="flex items-start gap-3">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-sm font-semibold text-slate-600">
                          {(user.username || user.email || 'U')
                            .split(/\s+/)
                            .filter(Boolean)
                            .slice(0, 2)
                            .map((part) => part.charAt(0).toUpperCase())
                            .join('')}
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="text-sm font-semibold text-slate-900">{user.username}</div>
                            {user.is_firm_admin && (
                              <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-blue-700">
                                Firm Admin
                              </span>
                            )}
                            {user.is_self && (
                              <span className="rounded-full bg-[#EAF9F8] px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-[#1B7C75]">
                                You
                              </span>
                            )}
                            {user.first_login && !user.is_firm_admin && (
                              <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                                Invite Pending
                              </span>
                            )}
                            {user.is_active === false && (
                              <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-red-700">
                                Disabled
                              </span>
                            )}
                          </div>
                          <div className="mt-1 text-xs text-slate-500">{user.email}</div>
                        </div>
                      </div>
                    </td>
                    
                    {tableColumns.map(col => (
                      <td key={col.id} className="px-4 py-4 align-middle">
                        <StatusDot status={user.permissions?.[col.id]} />
                      </td>
                    ))}
                    
                    <td className="px-6 py-4 text-center">
                      <div className="flex items-center justify-center gap-2">
                        {(canManagePermissions || canViewUsers || canViewRoles) && (
                          <button 
                            onClick={() => setSelectedUser(user)}
                            className="rounded-xl border border-slate-200 bg-white p-2 text-slate-400 transition hover:border-slate-300 hover:text-slate-700"
                            title={canManagePermissions ? 'Edit Permissions' : 'View Permissions'}
                          >
                            {canManagePermissions ? (
                              <svg className="w-5 h-5 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
                            ) : (
                              <svg className="w-5 h-5 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg>
                            )}
                          </button>
                        )}

                        {canResendPasswordSetupEmail && user.first_login && !user.is_firm_admin && !user.is_self && (
                          <button
                            onClick={() => handleResendCreatePasswordEmail(user)}
                            className="rounded-xl border border-slate-200 bg-white p-2 text-slate-400 transition hover:border-[#A8E8E3] hover:text-[#1AA49B]"
                            title="Resend create password email"
                          >
                            <svg className="w-5 h-5 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8m-2 10H5a2 2 0 01-2-2V8a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2z" />
                            </svg>
                          </button>
                        )}

                        {canUpdateUserInformation && !user.is_firm_admin && !user.is_self && (
                          <button
                            onClick={() => handleToggleUserActive(user)}
                            className={`rounded-xl border bg-white px-3 py-1.5 text-xs font-semibold transition ${
                              user.is_active === false
                                ? 'border-emerald-200 text-emerald-700 hover:border-emerald-300 hover:bg-emerald-50'
                                : 'border-amber-200 text-amber-700 hover:border-amber-300 hover:bg-amber-50'
                            }`}
                            title={user.is_active === false ? 'Enable user (allow login)' : 'Disable user (block login)'}
                          >
                            {user.is_active === false ? 'Enable' : 'Disable'}
                          </button>
                        )}

                        {canDeleteFirmUsers && !user.is_firm_admin && !user.is_self && (
                          <button
                            onClick={() => handleDeleteFirmUser(user)}
                            className="rounded-xl border border-slate-200 bg-white p-2 text-slate-400 transition hover:border-red-200 hover:text-red-600"
                            title="Delete firm user"
                          >
                            <svg className="w-5 h-5 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7h6m-7 0V5a1 1 0 011-1h4a1 1 0 011 1v2m-7 0h8" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Legend */}
      <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-slate-600">
        <div className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-2 shadow-sm">
          <div className="mr-2 h-2.5 w-2.5 rounded-full bg-green-500"></div> Allowed
        </div>
        <div className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-2 shadow-sm">
          <div className="mr-2 h-2.5 w-2.5 rounded-full bg-yellow-500"></div> Disabled
        </div>
      </div>

      {/* Modals */}
      {canCreateUsers && (
        <AddUserModal 
          isOpen={isAddUserOpen} 
          onClose={() => setIsAddUserOpen(false)} 
          onUserCreated={loadUsers} 
        />
      )}
      
      <PermissionsModal 
        isOpen={!!selectedUser} 
        onClose={() => setSelectedUser(null)} 
        user={selectedUser}
        readOnly={modalReadOnly}
        canManageCaseAssignments={canManageCaseAssignments}
        onSaveSuccess={() => {
          loadUsers();
        }}
      />
    </div>
  );
};

export default UserManagementTable;
