import React from 'react';
import { Home, Clock, FileText, Users, Briefcase } from 'lucide-react';

type OwnerTab = 'home' | 'pending' | 'documents' | 'customers' | 'services';

interface BottomNavProps {
  currentTab: OwnerTab;
  onChangeTab: (tab: OwnerTab) => void;
}

const items: { id: OwnerTab; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'pending', label: 'Pending', icon: Clock },
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'customers', label: 'Customers', icon: Users },
  { id: 'services', label: 'Services', icon: Briefcase }
];

export const BottomNav: React.FC<BottomNavProps> = ({ currentTab, onChangeTab }) => {
  return (
    <nav className="owner-bottom-nav">
      {items.map(item => {
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            onClick={() => onChangeTab(item.id)}
            className={`owner-nav-item ${currentTab === item.id ? 'active' : ''}`}
          >
            <Icon size={20} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
};
