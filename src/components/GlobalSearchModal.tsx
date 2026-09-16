import React, { useState } from 'react';
import { officeService } from '../services/officeService';
import { Search, X, ArrowRight, Users, FileText, Calendar, MessageSquare } from 'lucide-react';

interface GlobalSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectLead: (leadId: string) => void;
  onSelectTab: (tab: string) => void;
}

export const GlobalSearchModal: React.FC<GlobalSearchModalProps> = ({
  isOpen,
  onClose,
  onSelectLead,
  onSelectTab
}) => {
  const [query, setQuery] = useState('');

  if (!isOpen) return null;

  const results = officeService.globalSearch(query);
  const totalCount = results.leads.length + results.quotations.length + results.bookings.length + results.followUps.length + results.conversations.length;

  return (
    <div className="modal-backdrop" style={{ zIndex: 1300, alignItems: 'flex-start', paddingTop: '10vh' }}>
      <div 
        className="modal-content animate-fade-in"
        style={{ 
          maxWidth: '680px', 
          width: '95%', 
          padding: '1.25rem 1.5rem',
          boxShadow: 'var(--shadow-floating)',
          background: 'rgba(255, 255, 255, 0.95)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: '1px solid rgba(255, 255, 255, 0.9)'
        }}
      >
        {/* Search input header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem' }}>
          <Search size={20} color="var(--brand-blue)" />
          <input
            type="text"
            autoFocus
            placeholder="Search leads (B2P-LD-1001), customers, quotations (QTN-1001), bookings, phone..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ flex: 1, border: 'none', background: 'transparent', fontSize: '1rem', outline: 'none' }}
          />
          <button onClick={onClose} className="btn-ghost" style={{ padding: '0.35rem' }}>
            <X size={18} />
          </button>
        </div>

        {/* Results Body */}
        <div style={{ maxHeight: '420px', overflowY: 'auto', marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {query.trim() ? (
            totalCount > 0 ? (
              <>
                {/* Leads Results */}
                {results.leads.length > 0 && (
                  <div>
                    <h5 style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-secondary)', margin: '0 0 0.4rem 0', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <Users size={14} color="var(--brand-blue)" />
                      <span>Leads ({results.leads.length})</span>
                    </h5>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                      {results.leads.map(l => (
                        <div
                          key={l.id}
                          onClick={() => {
                            onSelectLead(l.id);
                            onClose();
                          }}
                          style={{ padding: '0.5rem 0.75rem', background: '#f8fafc', borderRadius: '6px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #f1f5f9' }}
                        >
                          <div>
                            <span className="mono" style={{ color: 'var(--brand-blue)', fontWeight: 700, marginRight: '0.5rem' }}>{l.lead_number}</span>
                            <strong>{l.customer_name}</strong> {l.company_name ? `(${l.company_name})` : ''} · {l.service_required}
                          </div>
                          <ArrowRight size={14} color="var(--text-secondary)" />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Quotations Results */}
                {results.quotations.length > 0 && (
                  <div>
                    <h5 style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-secondary)', margin: '0 0 0.4rem 0', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <FileText size={14} color="#d97706" />
                      <span>Quotations ({results.quotations.length})</span>
                    </h5>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                      {results.quotations.map(q => (
                        <div
                          key={q.id}
                          onClick={() => {
                            onSelectTab('documents');
                            onClose();
                          }}
                          style={{ padding: '0.5rem 0.75rem', background: '#f8fafc', borderRadius: '6px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #f1f5f9' }}
                        >
                          <div>
                            <span className="mono" style={{ color: '#d97706', fontWeight: 700, marginRight: '0.5rem' }}>{q.quotation_number}</span>
                            <strong>{q.customer_name}</strong> — ₹{q.total.toLocaleString('en-IN')} ({q.approval_status})
                          </div>
                          <ArrowRight size={14} color="var(--text-secondary)" />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Bookings Results */}
                {results.bookings.length > 0 && (
                  <div>
                    <h5 style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-secondary)', margin: '0 0 0.4rem 0', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <Calendar size={14} color="#10b981" />
                      <span>Fleet Bookings ({results.bookings.length})</span>
                    </h5>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                      {results.bookings.map(b => (
                        <div
                          key={b.id}
                          onClick={() => {
                            onSelectTab('calendar');
                            onClose();
                          }}
                          style={{ padding: '0.5rem 0.75rem', background: '#f8fafc', borderRadius: '6px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #f1f5f9' }}
                        >
                          <div>
                            <span className="mono" style={{ color: '#10b981', fontWeight: 700, marginRight: '0.5rem' }}>{b.booking_number}</span>
                            <strong>{b.customer_name}</strong> · {b.resource_name} ({b.start_date} to {b.end_date})
                          </div>
                          <ArrowRight size={14} color="var(--text-secondary)" />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* WhatsApp Conversations */}
                {results.conversations.length > 0 && (
                  <div>
                    <h5 style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-secondary)', margin: '0 0 0.4rem 0', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <MessageSquare size={14} color="#25D366" />
                      <span>WhatsApp Chats ({results.conversations.length})</span>
                    </h5>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                      {results.conversations.map(c => (
                        <div
                          key={c.id}
                          onClick={() => {
                            onSelectTab('whatsapp');
                            onClose();
                          }}
                          style={{ padding: '0.5rem 0.75rem', background: '#f8fafc', borderRadius: '6px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #f1f5f9' }}
                        >
                          <div>
                            <strong>{c.customer_name}</strong> ({c.phone}) — <em>{c.last_message.substring(0, 50)}...</em>
                          </div>
                          <ArrowRight size={14} color="var(--text-secondary)" />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                No records found matching "{query}"
              </div>
            )
          ) : (
            <div style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              Type a customer name, phone, lead ID, quote number, or keyword to search across the whole system.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
