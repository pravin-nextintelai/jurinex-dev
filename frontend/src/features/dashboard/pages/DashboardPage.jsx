import React, { useState, useEffect } from 'react';
import { Calendar, Lightbulb, FileEdit, FolderOpen, Brain } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import DashboardHeader from '../components/DashboardHeader';
import DashboardInsights from '../components/DashboardInsights';
import DashboardCasesTable from '../components/DashboardCasesTable';
import { useSidebar } from '@/shared/context/SidebarContext';

const DashboardPage = () => {
  const navigate = useNavigate();
  const { setIsSidebarHidden } = useSidebar();

  // Ensure sidebar is visible on dashboard
  useEffect(() => {
    setIsSidebarHidden(false);
  }, [setIsSidebarHidden]);

  const insights = [
    {
      icon: <FolderOpen className="w-5 h-5" />,
      title: "Case Management",
      description: "Organize and manage your case documents efficiently. Access all case files, evidence, and documentation in one place.",
      action: "Manage Cases",
      color: "#21C1B6",
      onClick: () => navigate('/documents')
    },
    {
      icon: <Brain className="w-5 h-5" />,
      title: "Document Analysis ",
      description: "AI-powered legal analysis ready for your cases. Get intelligent insights and recommendations for better case preparation.",
      action: "View Analysis",
      color: "#21C1B6",
      onClick: () => navigate('/analysis')
    },
    {
      icon: <FileEdit className="w-5 h-5" />,
      title: "Drafting Enhancement",
      description: "Consider incorporating latest amendments for TAX/789/2022 draft based on recent circulars.",
      action: "Review Draft",
      color: "#21C1B6",
      onClick: () => {}
    }
  ];

  const cases = [
    {
      caseNo: "CRL/567/2024",
      court: "Delhi HC - Bench 3",
      type: "Criminal/Trial",
      client: "Raj Kumar Singh vs State",
      advocate: "A. Sharma",
      nextHearing: "12-Oct-2025",
      status: "Active",
      docs: "23"
    },
    {
      caseNo: "CIV/234/2024",
      court: "Bombay HC - Bench 1",
      type: "Civil/Appeal",
      client: "Tech Solutions Ltd vs ABC Corp",
      advocate: "P. Mehta",
      nextHearing: "15-Oct-2025",
      status: "Active",
      docs: "42"
    },
    {
      caseNo: "CON/789/2024",
      court: "Supreme Court - Bench 2",
      type: "Constitutional/Review",
      client: "Citizens Forum vs Union of India",
      advocate: "S. Verma",
      nextHearing: "18-Oct-2025",
      status: "Active",
      docs: "15"
    },
    {
      caseNo: "CIV/456/2024",
      court: "Karnataka HC - Bench",
      type: "Civil/Trial",
      client: "Priya Enterprises vs Bank Ltd",
      advocate: "R. Nair",
      nextHearing: "22-Oct-2025",
      status: "Pending",
      docs: "22"
    }
  ];

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">
      <div className="p-8">
        <DashboardHeader />
      </div>
      <div className="flex-grow overflow-y-auto p-8 pt-0">
        <DashboardInsights insights={insights} />
        <DashboardCasesTable cases={cases} />
      </div>
    </div>
  );
};

export default DashboardPage;