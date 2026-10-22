import React, { useState, useEffect } from 'react';
import {
  updateUserPermissions,
  fetchAssignableCases,
  fetchUserCaseAssignments,
  updateUserCaseAssignments,
} from '../api/rbacApi';
import { toast } from 'react-toastify';

export const permissionCategories = {
  ACCOUNT: [{ id: 'view_account_settings', label: 'View account settings' }],
  CASE: [
    { id: 'create_new_cases', label: 'Create new cases' },
    { id: 'delete_cases', label: 'Delete cases' },
    { id: 'edit_case_information', label: 'Edit case information' },
    { id: 'view_case_information', label: 'View case information' }
  ],
  CHAT: [
    { id: 'read_chat_messages', label: 'Read chat messages' },
    { id: 'send_chat_messages', label: 'Send chat messages' },
    { id: 'upload_documents_in_chat', label: 'Upload documents in chat' }
  ],
  DASHBOARD: [{ id: 'view_dashboard', label: 'View dashboard' }],
  DOCUMENT: [
    { id: 'delete_documents', label: 'Delete documents' },
    { id: 'edit_documents', label: 'Edit documents' },
    { id: 'share_documents', label: 'Share documents' },
    { id: 'upload_documents', label: 'Upload documents' },
    { id: 'view_documents', label: 'View documents' }
  ],
  ROLE: [
    { id: 'create_custom_roles', label: 'Create custom roles' },
    { id: 'delete_roles', label: 'Delete roles' },
    { id: 'view_roles', label: 'View roles' },
    { id: 'update_roles', label: 'Update roles' }
  ],
  TENANT: [
    { id: 'view_tenant_information', label: 'View tenant information' },
    { id: 'update_tenant_settings', label: 'Update tenant settings' },
    { id: 'manage_tenant_users', label: 'Manage tenant users' }
  ],
  USER: [
    { id: 'create_new_users', label: 'Create new users' },
    { id: 'view_user_information', label: 'View user information' },
    { id: 'update_user_information', label: 'Update user information' },
    { id: 'delete_users', label: 'Delete users' },
    { id: 'assign_remove_roles_from_users', label: 'Assign/remove roles from users' },
    { id: 'manage_user_permissions', label: 'Manage user permissions' }
  ],
  FIRM_USER: [
    { id: 'delete_firm_users', label: 'Delete firm users' },
    { id: 'resend_password_setup_email', label: 'Resend create password email' }
  ]
};

const PermissionsModal = ({
  isOpen,
  onClose,
  user,
  onSaveSuccess,
  readOnly = false,
  canManageCaseAssignments = true,
}) => {
  const [permissions, setPermissions] = useState({});
  const [saving, setSaving] = useState(false);
  const [assignableCases, setAssignableCases] = useState([]);
  const [selectedCaseIds, setSelectedCaseIds] = useState([]);
  const [loadingAssignments, setLoadingAssignments] = useState(false);
  const defaultFirmUserLifecyclePermissions = {
    delete_firm_users: 'Disabled',
    resend_password_setup_email: 'Disabled',
  };

  useEffect(() => {
    if (user && user.permissions) {
      setPermissions({
        ...defaultFirmUserLifecyclePermissions,
        ...user.permissions,
      });
    } else {
      setPermissions(defaultFirmUserLifecyclePermissions);
    }
  }, [user]);

  useEffect(() => {
    const loadCaseAssignments = async () => {
      if (!isOpen || !user?.id || readOnly || !canManageCaseAssignments) {
        setAssignableCases([]);
        setSelectedCaseIds([]);
        setLoadingAssignments(false);
        return;
      }

      setLoadingAssignments(true);
      try {
        const [casesResponse, assignmentsResponse] = await Promise.all([
          fetchAssignableCases(),
          fetchUserCaseAssignments(user.id),
        ]);

        setAssignableCases(casesResponse.cases || []);
        setSelectedCaseIds((assignmentsResponse.caseIds || []).map((caseId) => String(caseId)));
      } catch (error) {
        console.error('[PermissionsModal] Failed to load case assignments:', {
          userId: user.id,
          status: error.response?.status,
          data: error.response?.data,
          message: error.message,
          stack: error.stack,
        });
        toast.error(
          error.response?.data?.message ||
          error.response?.data?.details ||
          error.response?.data?.error ||
          'Failed to load assignable cases.'
        );
      } finally {
        setLoadingAssignments(false);
      }
    };

    loadCaseAssignments();
  }, [canManageCaseAssignments, isOpen, user, readOnly]);

  if (!isOpen || !user) return null;

  const allPermissionItems = Object.values(permissionCategories).flat();
  const allowedPermissionsCount = allPermissionItems.filter(
    ({ id }) => (permissions[id] || 'Allowed') === 'Allowed'
  ).length;
  const selectedCaseCount = selectedCaseIds.length;
  const displayName = user.username || user.fullName || user.email || 'User';
  const displayInitials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('') || 'U';
  const summaryBadges = [
    user.is_firm_admin ? 'Firm Admin' : null,
    user.is_self ? 'You' : null,
    user.first_login ? 'Invite Pending' : null,
    readOnly ? 'View Only' : 'Editable',
  ].filter(Boolean);

  const handlePermissionChange = (featureId, value) => {
    if (readOnly) return;
    setPermissions(prev => ({ ...prev, [featureId]: value }));
  };

  const handleSave = async () => {
    if (readOnly) {
      onClose();
      return;
    }

    setSaving(true);
    try {
      const saveRequests = [updateUserPermissions(user.id, permissions)];

      if (canManageCaseAssignments) {
        saveRequests.push(updateUserCaseAssignments(user.id, selectedCaseIds));
      }

      await Promise.all(saveRequests);
      toast.success(
        canManageCaseAssignments
          ? 'Permissions and case assignments updated successfully!'
          : 'Permissions updated successfully!'
      );
      onSaveSuccess?.({
        permissions,
        caseIds: canManageCaseAssignments ? selectedCaseIds : [],
      });
      onClose();
    } catch (err) {
      console.error('[PermissionsModal] Failed to save permissions/case assignments:', {
        userId: user.id,
        permissions,
        selectedCaseIds,
        status: err.response?.status,
        data: err.response?.data,
        message: err.message,
        stack: err.stack,
      });
      const message =
        err.response?.data?.message ||
        err.response?.data?.details ||
        err.response?.data?.error ||
        'Failed to update permissions.';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const toggleCaseSelection = (caseId) => {
    if (readOnly) return;
    const normalizedCaseId = String(caseId);
    setSelectedCaseIds((prev) =>
      prev.includes(normalizedCaseId)
        ? prev.filter((value) => value !== normalizedCaseId)
        : [...prev, normalizedCaseId]
    );
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/20 px-4 py-8 backdrop-blur-sm">
      <div className="relative mx-auto w-full max-w-6xl overflow-hidden rounded-[30px] border border-white/70 bg-white/95 shadow-[0_36px_110px_rgba(15,23,42,0.22)] ring-1 ring-slate-200/80">
        <div className="absolute inset-x-0 top-0 h-32 bg-[linear-gradient(135deg,rgba(33,193,182,0.14),rgba(255,255,255,0.96),rgba(225,29,72,0.08))]" />

        <div className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/90 backdrop-blur-xl">
          <div className="flex items-start justify-between gap-4 px-6 py-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#1AA49B]">
                User Permissions
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-slate-900">
                {readOnly ? 'View permissions for ' : 'Edit permissions for '}
                {displayName}
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Review access module by module and keep the working permissions flow exactly as configured.
              </p>
            </div>
            <button
              onClick={onClose}
              className="rounded-full border border-slate-200 bg-white/90 p-2 text-slate-400 transition hover:border-slate-300 hover:text-slate-700"
              aria-label="Close permissions modal"
            >
              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
              </svg>
            </button>
          </div>

          <div className="grid gap-4 border-t border-slate-200/80 bg-white/80 px-6 py-5 md:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
            <div className="flex items-start gap-4 rounded-2xl border border-[#D9F5F2] bg-[#F5FCFB] px-4 py-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#21C1B6] text-base font-semibold text-white shadow-[0_18px_34px_rgba(33,193,182,0.24)]">
                {displayInitials}
              </div>
              <div className="min-w-0">
                <div className="truncate text-base font-semibold text-slate-900">{displayName}</div>
                <div className="mt-1 truncate text-sm text-slate-500">{user.email}</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {summaryBadges.map((badge) => (
                    <span
                      key={badge}
                      className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600"
                    >
                      {badge}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 md:grid-cols-1 xl:grid-cols-3">
              <div className="rounded-2xl border border-slate-200/80 bg-white px-4 py-3 shadow-sm">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Allowed</div>
                <div className="mt-2 text-2xl font-semibold text-slate-900">
                  {allowedPermissionsCount}
                  <span className="ml-1 text-sm font-medium text-slate-400">/ {allPermissionItems.length}</span>
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200/80 bg-white px-4 py-3 shadow-sm">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Case Access</div>
                <div className="mt-2 text-2xl font-semibold text-slate-900">{selectedCaseCount}</div>
              </div>
              <div className="rounded-2xl border border-slate-200/80 bg-white px-4 py-3 shadow-sm">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Mode</div>
                <div className="mt-2 text-sm font-semibold text-slate-900">
                  {readOnly ? 'Read only preview' : 'Editable access'}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="overflow-y-auto px-6 py-6" style={{ maxHeight: 'calc(100vh - 240px)' }}>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {Object.entries(permissionCategories).map(([category, features]) => (
              <div
                key={category}
                className="overflow-hidden rounded-[24px] border border-slate-200/80 bg-white shadow-[0_10px_35px_rgba(15,23,42,0.06)]"
              >
                <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/80 px-4 py-3.5">
                  <h3 className="text-sm font-semibold tracking-wide text-slate-700">{category}</h3>
                  <span className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Visibility</span>
                </div>
                <div>
                  {features.map((feature, idx) => (
                    <div
                      key={feature.id}
                      className={`flex items-center justify-between gap-4 px-4 py-3.5 ${idx !== features.length - 1 ? 'border-b border-slate-100' : ''}`}
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-slate-700">{feature.label}</div>
                      </div>
                      <div className="relative shrink-0">
                        <span
                          className={`pointer-events-none absolute left-3 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full ${(permissions[feature.id] || 'Allowed') === 'Allowed' ? 'bg-green-500' : 'bg-amber-500'}`}
                        />
                        <select
                          className={`appearance-none rounded-xl border border-slate-200 bg-white py-2 pl-7 pr-9 text-sm font-medium shadow-sm outline-none transition focus:border-[#21C1B6] focus:ring-4 focus:ring-[#21C1B6]/15 ${permissions[feature.id] === 'Disabled' ? 'text-slate-600' : 'text-slate-800'} ${readOnly ? 'cursor-default bg-slate-50' : ''}`}
                          value={permissions[feature.id] || 'Allowed'}
                          disabled={readOnly}
                          onChange={(e) => handlePermissionChange(feature.id, e.target.value)}
                        >
                          <option value="Allowed">Allowed</option>
                          <option value="Disabled">Disabled</option>
                        </select>
                        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-slate-400">
                          <svg className="h-4 w-4 fill-current" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                            <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/>
                          </svg>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {!readOnly && canManageCaseAssignments && (
            <div className="mt-8 overflow-hidden rounded-[24px] border border-slate-200/80 bg-white shadow-[0_10px_35px_rgba(15,23,42,0.06)]">
              <div className="flex items-center justify-between gap-4 border-b border-slate-100 bg-slate-50/80 px-4 py-3.5">
                <div>
                  <h3 className="text-sm font-semibold tracking-wide text-slate-700">CASE ASSIGNMENTS</h3>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    Assign multiple firm cases to this user. Assigned users will be able to see those cases in their dashboard.
                  </p>
                </div>
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  {selectedCaseIds.length} selected
                </span>
              </div>

              <div className="p-4">
                {loadingAssignments ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                    Loading cases...
                  </div>
                ) : assignableCases.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                    No firm cases available to assign yet.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {assignableCases.map((caseItem) => {
                      const caseId = String(caseItem.id);
                      const checked = selectedCaseIds.includes(caseId);
                      return (
                        <label
                          key={caseId}
                          className={`cursor-pointer rounded-2xl border px-4 py-4 transition-all ${checked ? 'border-[#21C1B6] bg-[#EAF9F8] shadow-[0_12px_28px_rgba(33,193,182,0.14)]' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/70'}`}
                        >
                          <div className="flex items-start gap-3">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleCaseSelection(caseId)}
                              className="mt-1 h-4 w-4 rounded border-gray-300 text-[#21C1B6] focus:ring-[#21C1B6]"
                            />
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-slate-900">
                                {caseItem.case_title || 'Untitled Case'}
                              </div>
                              <div className="mt-1 text-xs text-slate-500">
                                {caseItem.case_number ? `Case No: ${caseItem.case_number}` : 'Case number not assigned'}
                              </div>
                              <div className="mt-2 inline-flex rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                                Status: {caseItem.status || 'Unknown'}
                              </div>
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="sticky bottom-0 z-20 flex justify-end gap-3 border-t border-slate-200/80 bg-white/90 px-6 py-5 backdrop-blur-xl">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
          >
            Close
          </button>
          {!readOnly && (
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="rounded-xl bg-[#E11D48] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_14px_30px_rgba(225,29,72,0.24)] transition hover:bg-[#BE123C] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save changes'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default PermissionsModal;
