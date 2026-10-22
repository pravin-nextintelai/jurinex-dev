import React, { useEffect, useState } from 'react';
import { Calendar } from 'lucide-react';

const DashboardHeader = ({ user }) => {
  const [userName, setUserName] = useState('User');
  const [greeting, setGreeting] = useState('');
  const [dateStr, setDateStr] = useState('');

  useEffect(() => {
    const hour = new Date().getHours();
    if (hour < 12) setGreeting('Good Morning');
    else if (hour < 17) setGreeting('Good Afternoon');
    else setGreeting('Good Evening');
    const now = new Date();
    setDateStr(
      now.toLocaleDateString('en-IN', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    );
  }, []);

  useEffect(() => {
    if (user) {
      const name = user.username || user.displayName || user.firstName || 'User';
      setUserName(name);
      return;
    }

    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      try {
        const parsedUser = JSON.parse(storedUser);
        let name = 'User';
        if (parsedUser.username) name = parsedUser.username;
        else if (parsedUser.displayName) name = parsedUser.displayName;
        else if (parsedUser.firstName) name = parsedUser.firstName;
        setUserName(name);
      } catch {
        setUserName('User');
      }
    }
  }, [user]);

  return (
    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
      <div>
        <p className="text-sm font-medium" style={{ color: '#21C1B6' }}>{greeting}</p>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mt-0.5">
          Welcome back,{' '}
          <span style={{ color: '#21C1B6' }}>{userName}</span>
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Here's an overview of your active legal cases.
        </p>
      </div>
      <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-4 py-2.5 shadow-sm flex-shrink-0">
        <Calendar size={14} style={{ color: '#21C1B6' }} />
        <span className="text-sm text-gray-600 whitespace-nowrap">{dateStr}</span>
      </div>
    </div>
  );
};

export default DashboardHeader;
