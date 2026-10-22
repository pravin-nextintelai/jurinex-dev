import React, { useMemo, useState } from 'react';
import UserManagementTable from '../components/UserManagementTable';
import FirmAnalyticsTab from '../components/FirmAnalyticsTab';
import SupportTicketsTab from '../components/SupportTicketsTab';
import { useAuth } from '@/shared/context';

const UserManagementPage = () => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('Manage Permissions');
  const accountType = String(user?.account_type || '').toUpperCase();
  const role = String(user?.role || '').toUpperCase();
  const isFirmUser = accountType === 'FIRM_USER';
  const isFirmAdmin = accountType === 'FIRM_ADMIN';
  const canManageSupport = isFirmAdmin || role === 'ADMIN' || role === 'SUPER_ADMIN';
  const todayLabel = useMemo(
    () =>
      new Intl.DateTimeFormat('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      }).format(new Date()),
    []
  );

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(33,193,182,0.08),_transparent_30%),linear-gradient(180deg,_#F8FAFC_0%,_#F5F7FB_100%)]">
      <div className="w-full px-3 py-3 lg:px-4 lg:py-4">
        <div className="overflow-hidden rounded-[32px] border border-white/70 bg-white/85 shadow-[0_28px_80px_rgba(15,23,42,0.08)] backdrop-blur-sm">
          <div className="border-b border-slate-200/80 bg-[linear-gradient(135deg,rgba(33,193,182,0.1),rgba(255,255,255,0.92),rgba(15,23,42,0.02))] px-5 py-6 lg:px-6 lg:py-7">
            <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
              <div className="max-w-3xl">
              
                {/* <h1 className="mt-3 text-4xl font-semibold text-[#0F172A]">User Management</h1> */}
                <p className="mt-3 text-lg leading-8 text-slate-600">
                  {isFirmUser
                    ? 'Review your firm admin permissions and the access assigned to your account.'
                    : 'Manage all users, roles, permissions, and firm invites from one polished control center.'}
                </p>
              </div>
              <div className="self-start rounded-full border border-slate-200 bg-white/90 px-4 py-2 text-sm font-medium text-slate-500 shadow-sm">
                {todayLabel}
              </div>
            </div>
          </div>

          <div className="px-4 py-4 lg:px-5 lg:py-5">
            <div className="mb-6 border-b border-slate-200">
              <nav className="-mb-px flex space-x-8">
                <button
                  className={`whitespace-nowrap border-b-2 px-1 py-4 text-sm font-semibold transition ${
                    activeTab === 'Manage Permissions'
                      ? 'border-[#0F172A] text-[#0F172A]'
                      : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'
                  }`}
                  onClick={() => setActiveTab('Manage Permissions')}
                >
                  Manage Permissions
                </button>
                {isFirmAdmin && (
                  <button
                    className={`whitespace-nowrap border-b-2 px-1 py-4 text-sm font-semibold transition ${
                      activeTab === 'Analytics'
                        ? 'border-[#0F172A] text-[#0F172A]'
                        : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'
                    }`}
                    onClick={() => setActiveTab('Analytics')}
                  >
                    Analytics
                  </button>
                )}
                {canManageSupport && (
                  <button
                    className={`whitespace-nowrap border-b-2 px-1 py-4 text-sm font-semibold transition ${
                      activeTab === 'Support Tickets'
                        ? 'border-[#0F172A] text-[#0F172A]'
                        : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'
                    }`}
                    onClick={() => setActiveTab('Support Tickets')}
                  >
                    
                  </button>
                )}
              </nav>
            </div>

            {activeTab === 'Analytics' && isFirmAdmin ? (
              <FirmAnalyticsTab />
            ) : activeTab === 'Support Tickets' && canManageSupport ? (
              <SupportTicketsTab />
            ) : (
              <UserManagementTable />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default UserManagementPage;
