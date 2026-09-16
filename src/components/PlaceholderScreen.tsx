import React from 'react';
import { Calendar, Clock, MessageSquare, BarChart3, CreditCard, ShoppingCart, FileCheck, ArrowRight, Zap } from 'lucide-react';

interface PlaceholderScreenProps {
  moduleKey: 'calendar' | 'follow-ups' | 'whatsapp' | 'reports' | 'finance-accounts' | 'finance-purchases' | 'finance-gst';
  onNavigateToLeads?: () => void;
}

const MODULE_DATA = {
  calendar: {
    title: 'Booking & Fleet Calendar',
    phase: 'Phase 4',
    icon: Calendar,
    color: '#0f4c81',
    description: 'Resource availability and booking calendar for LED Vans, LED Walls, and Lookwalker promoters across Kerala.',
    features: [
      'Fleet calendar for LED Van roadshow scheduling with GPS routes',
      'LED Wall inventory booking (P3 panels, truss setups, technician shifts)',
      'Lookwalker team promoter assignment with uniform kit tracking',
      'Automatic calendar hold upon Quotation confirmation'
    ]
  },
  'follow-ups': {
    title: 'Follow-ups & Reminder Alarms',
    phase: 'Phase 2',
    icon: Clock,
    color: '#b45309',
    description: 'Scheduled follow-up management and alarm system for Telecallers and Admin.',
    features: [
      'Follow-up queue sorted by urgency (due today, overdue, upcoming)',
      'Desktop & browser alarm notifications for scheduled customer calls',
      'One-click WhatsApp follow-up reminder templates',
      'Automatic activity logging upon completing a follow-up call'
    ]
  },
  whatsapp: {
    title: 'WhatsApp Business Multi-Staff Inbox',
    phase: 'Phase 6',
    icon: MessageSquare,
    color: '#15803d',
    description: 'Integrated WhatsApp conversation history and direct messaging for all office staff on the single official B2P business number.',
    features: [
      'Live incoming & outgoing customer chats linked to Customer Profiles and Leads',
      'Multi-agent support (Owner, Admin, Telecaller on same WhatsApp number)',
      'Rich media sharing (photos, PDFs, quotations, campaign route maps)',
      'Quick response templates for pricing inquiries and service specs'
    ]
  },
  reports: {
    title: 'Office Performance & Conversion Reports',
    phase: 'Phase 5',
    icon: BarChart3,
    color: '#1d4ed8',
    description: '360-degree analytics dashboard for Owner and Admin to track revenue, staff performance, and lead source ROI.',
    features: [
      'Lead source conversion comparison (Instagram vs. Facebook vs. WhatsApp vs. Website)',
      'Telecaller response speed and requirement collection velocity',
      'Quotation-to-Confirmation conversion ratios by service type',
      'Monthly revenue trends and outstanding payment forecasting'
    ]
  },
  'finance-accounts': {
    title: 'Accounts & Ledger Management',
    phase: 'Finance Module',
    icon: CreditCard,
    color: '#0f4c81',
    description: 'Track client receivables, advance campaign payments, and customer account ledgers.',
    features: [
      'Customer payment ledger linked to Tax Invoices',
      'Bank reconciliation for Kerala bank accounts (Federal Bank / SBI)',
      'Advance deposit tracking for LED Van campaign fuel & permits',
      'Automated overdue payment reminders'
    ]
  },
  'finance-purchases': {
    title: 'Vendor Purchases & Fleet Expenses',
    phase: 'Finance Module',
    icon: ShoppingCart,
    color: '#475569',
    description: 'Manage vendor purchase orders, printing fabrication bills, diesel logs, and permit charges.',
    features: [
      'Vendor purchase orders for flex printing and vinyl banners',
      'LED Van diesel logs and driver daily allowances',
      'Municipality advertising permit and tax fee logging',
      'Monthly operational expenditure breakdown'
    ]
  },
  'finance-gst': {
    title: 'GST Reports & Tax Filing',
    phase: 'Finance Module',
    icon: FileCheck,
    color: '#15803d',
    description: 'Generate GSTR-1, GSTR-3B tax summary registers and Kerala state GST reconciliation files.',
    features: [
      'GSTR-1 outward supply sales register generation',
      'HSN / SAC code summaries for advertising services (998361)',
      'Output CGST + SGST (18%) and IGST breakdown reports',
      '1-click export to CA Excel format'
    ]
  }
};

export const PlaceholderScreen: React.FC<PlaceholderScreenProps> = ({ moduleKey, onNavigateToLeads }) => {
  const data = MODULE_DATA[moduleKey];
  const Icon = data.icon;

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '2rem', maxWidth: '900px', margin: '0 auto', padding: '2rem 1rem' }}>
      
      {/* Hero Card */}
      <div 
        className="card" 
        style={{ 
          textAlign: 'center', 
          padding: '3rem 2rem', 
          background: 'linear-gradient(180deg, var(--bg-card) 0%, var(--bg-input) 100%)',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-lg)'
        }}
      >
        <div style={{
          width: '64px',
          height: '64px',
          borderRadius: '16px',
          background: `${data.color}20`,
          color: data.color,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 1.25rem auto'
        }}>
          <Icon size={32} />
        </div>

        <div style={{ display: 'inline-block', padding: '0.2rem 0.6rem', borderRadius: '999px', background: `${data.color}20`, color: data.color, fontSize: '0.75rem', fontWeight: 700, marginBottom: '0.5rem' }}>
          {data.phase} Planned Feature
        </div>

        <h1 style={{ fontSize: '1.75rem', fontWeight: 700, margin: '0.25rem 0 0.75rem 0' }}>
          {data.title}
        </h1>

        <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', maxWidth: '600px', margin: '0 auto 1.75rem auto', lineHeight: 1.5 }}>
          {data.description}
        </p>

        {onNavigateToLeads && (
          <button
            onClick={onNavigateToLeads}
            className="btn-primary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', margin: '0 auto' }}
          >
            <span>Go to Leads Pipeline</span>
            <ArrowRight size={16} />
          </button>
        )}
      </div>

      {/* Feature Highlights Grid */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
          Planned Capabilities in this Module
        </h3>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
          {data.features.map((feat, idx) => (
            <div
              key={idx}
              className="card"
              style={{
                padding: '1.25rem',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.75rem',
                border: '1px solid var(--border-color)'
              }}
            >
              <div style={{
                width: '24px',
                height: '24px',
                borderRadius: '6px',
                background: 'rgba(16, 185, 129, 0.15)',
                color: 'var(--accent-success)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                marginTop: '2px'
              }}>
                <Zap size={14} />
              </div>
              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                {feat}
              </p>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
};
