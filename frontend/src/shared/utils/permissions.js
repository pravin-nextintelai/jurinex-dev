export const PERMISSION_KEYS = {
  CREATE_CASE: 'create_new_cases',
  VIEW_CASE: 'view_case_information',
  EDIT_CASE: 'edit_case_information',
  DELETE_CASE: 'delete_cases',
  VIEW_ACCOUNT_SETTINGS: 'view_account_settings',
  CREATE_USERS: 'create_new_users',
  VIEW_USER_INFORMATION: 'view_user_information',
  UPDATE_USER_INFORMATION: 'update_user_information',
  DELETE_USERS: 'delete_users',
  ASSIGN_REMOVE_ROLES: 'assign_remove_roles_from_users',
  MANAGE_USER_PERMISSIONS: 'manage_user_permissions',
  DELETE_FIRM_USERS: 'delete_firm_users',
  RESEND_PASSWORD_SETUP_EMAIL: 'resend_password_setup_email',
  CREATE_ROLES: 'create_custom_roles',
  DELETE_ROLES: 'delete_roles',
  VIEW_ROLES: 'view_roles',
  UPDATE_ROLES: 'update_roles',
};

export const getAccountType = (user) =>
  String(user?.account_type || user?.accountType || '').toUpperCase();

export const shouldEnforceRbac = (user) => getAccountType(user) === 'FIRM_USER';

export const isPermissionAllowed = (permissions, permissionKey) => {
  const value = permissions?.[permissionKey];

  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return value.trim().toLowerCase() !== 'disabled';
  }

  return true;
};

export const canUsePermission = (user, permissionKey) => {
  if (!user) return false;
  if (!shouldEnforceRbac(user)) return true;
  return isPermissionAllowed(user.permissions, permissionKey);
};

export const canUseAnyPermission = (user, permissionKeys = []) => {
  if (!user) return false;
  if (!shouldEnforceRbac(user)) return true;
  return permissionKeys.some((permissionKey) => isPermissionAllowed(user.permissions, permissionKey));
};
