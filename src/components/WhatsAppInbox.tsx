import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { WhatsAppConversation, WhatsAppMessage } from '../types';
import { whatsappService } from '../services/whatsappService';
import { leadService } from '../services/leadService';
import { normalizeIndianPhone } from '../utils/whatsappShare';
import { FollowUpModal } from './FollowUpModal';
import { SaveAsLeadModal } from './SaveAsLeadModal';
import { 
  Search, 
  Send, 
  Paperclip, 
  Clock, 
  FileText, 
  Eye,
  Phone,
  Check,
  CheckCheck,
  AlertCircle,
  ExternalLink,
  RotateCw,
  UserPlus,
  CheckCircle2
} from 'lucide-react';

interface WhatsAppInboxProps {
  userRole?: string;
  userEmail?: string;
  companyId?: string;
  onOpenLead?: (leadId: string) => void;
}

const QUICK_TEMPLATES = [
  {
    title: 'LED Van Specs & Pricing',
    text: 'Hello! Our LED Vans feature 14ft/16ft high-brightness P3 outdoor screens, built-in hydraulic lift, silent generator, and audio sound system. Standard rates are ₹25,000/day across Thrissur and Kochi districts.'
  },
  {
    title: 'Quotation Follow-up',
    text: 'Greetings from B2P International! We wanted to check if you had a chance to review our formal quotation. Please let us know if you need any adjustments to the route or dates.'
  },
  {
    title: 'Lookwalker Promoters',
    text: 'Our Lookwalker promoters wear illuminated backlit double-sided walking billboards, perfect for mall activations and town markets. Rate: ₹2,500/promoter/day including uniform.'
  },
  {
    title: 'Bank & Advance Payment',
    text: 'Thank you for confirming your booking! Please transfer 50% advance to: B2P International Pvt Ltd, Federal Bank Thrissur Main Branch, A/C: 10020100456789, IFSC: FDRL0001002.'
  }
];

export const WhatsAppInbox: React.FC<WhatsAppInboxProps> = ({
  userRole: _userRole,
  userEmail = '',
  companyId,
  onOpenLead
}) => {
  const [conversations, setConversations] = useState<WhatsAppConversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<WhatsAppMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Modals
  const [followUpModalOpen, setFollowUpModalOpen] = useState(false);
  const [saveLeadModalOpen, setSaveLeadModalOpen] = useState(false);
  const [statusFeedback, setStatusFeedback] = useState<string | null>(null);

  const refreshConversations = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const list = await whatsappService.getConversations(companyId);
      setConversations(list);
      if (!activeConvId && list.length > 0) {
        setActiveConvId(list[0].id);
      }
    } finally {
      setIsRefreshing(false);
    }
  }, [activeConvId, companyId]);

  useEffect(() => {
    refreshConversations();
  }, [refreshConversations]);

  // Periodic background polling (every 5 seconds) to ensure inbound webhook messages appear live
  useEffect(() => {
    const timer = setInterval(async () => {
      const list = await whatsappService.getConversations(companyId);
      setConversations(list);
      if (activeConvId) {
        const msgs = await whatsappService.getMessages(activeConvId);
        setMessages(msgs);
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [activeConvId, companyId]);

  useEffect(() => {
    if (activeConvId) {
      whatsappService.getMessages(activeConvId).then(setMessages);
      whatsappService.markAsRead(activeConvId).then(() => {
        setConversations(prev => prev.map(c => c.id === activeConvId ? { ...c, unread_count: 0 } : c));
      });
    }
  }, [activeConvId]);

  // Real-time incoming messages & status updates subscription
  useEffect(() => {
    const unsubscribe = whatsappService.subscribeToLiveInbox(
      (newMsg) => {
        if (newMsg.conversation_id === activeConvId) {
          setMessages(prev => {
            if (prev.some(m => m.id === newMsg.id || (m.wa_message_id && m.wa_message_id === newMsg.wa_message_id))) {
              return prev;
            }
            return [...prev, newMsg];
          });
        }
        refreshConversations();
      },
      (statusUpdate) => {
        setMessages(prev => prev.map(m => {
          if (m.id === statusUpdate.id || m.wa_message_id === statusUpdate.id) {
            return { ...m, status: statusUpdate.status, error_message: statusUpdate.error_message };
          }
          return m;
        }));
      }
    );

    return () => {
      unsubscribe();
    };
  }, [activeConvId, refreshConversations]);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const activeConv = conversations.find(c => c.id === activeConvId);
  const linkedLead = activeConv?.lead_id ? leadService.getLeadById(activeConv.lead_id) : null;

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputText.trim() || !activeConvId || !activeConv || isSending) return;

    const textToSend = inputText.trim();
    setInputText('');
    setIsSending(true);

    try {
      const newMsg = await whatsappService.sendMessage({
        conversationId: activeConvId,
        phone: activeConv.phone,
        text: textToSend,
        senderType: 'staff',
        senderName: userEmail.split('@')[0],
        senderEmail: userEmail,
        companyId: activeConv.company_id || companyId
      });
      if (newMsg.status === 'failed') {
        setStatusFeedback(newMsg.error_message || 'Failed to dispatch message via WhatsApp.');
        setTimeout(() => setStatusFeedback(null), 6000);
      }
      setMessages(prev => [...prev.filter(m => m.id !== newMsg.id), newMsg]);
      refreshConversations();
    } catch (err) {
      console.error('[WhatsAppInbox] Failed to send message:', err);
      setStatusFeedback(err instanceof Error ? err.message : 'Unable to send message');
      setTimeout(() => setStatusFeedback(null), 6000);
    } finally {
      setIsSending(false);
    }
  };

  const handleSelectTemplate = (text: string) => {
    setInputText(text);
  };

  const handleSendSimulatedAttachment = async () => {
    if (!activeConvId || !activeConv || isSending) return;
    setIsSending(true);
    try {
      const newMsg = await whatsappService.sendMessage({
        conversationId: activeConvId,
        phone: activeConv.phone,
        text: 'Formal Quotation PDF attached for your review.',
        senderType: 'staff',
        senderName: userEmail.split('@')[0],
        senderEmail: userEmail,
        companyId: activeConv.company_id || companyId,
        attachment: {
          type: 'pdf',
          name: 'Quotation-B2P.pdf',
          url: '#'
        }
      });
      setMessages(prev => [...prev.filter(m => m.id !== newMsg.id), newMsg]);
      refreshConversations();
    } catch (err) {
      console.error('[WhatsAppInbox] Failed to send attachment:', err);
    } finally {
      setIsSending(false);
    }
  };

  const filteredConversations = conversations.filter(c =>
    c.customer_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (c.company_name && c.company_name.toLowerCase().includes(searchQuery.toLowerCase())) ||
    c.phone.includes(searchQuery) ||
    c.last_message.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: '#ffffff',
        border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-md)',
        padding: '1rem 1.25rem',
        boxShadow: 'var(--shadow-sm)',
        flexWrap: 'wrap',
        gap: '1rem'
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <h1 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
              WhatsApp Business Workspace
            </h1>
            <span className="badge badge-success">
              Connected: +91 81390 09034
            </span>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem', margin: '0.2rem 0 0 0' }}>
            Multi-staff shared messaging inbox for quick quotations, route coordinates, and customer chats.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            refreshConversations();
            if (activeConvId) {
              whatsappService.getMessages(activeConvId).then(setMessages);
            }
          }}
          disabled={isRefreshing}
          className="btn btn-secondary"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.4rem',
            fontSize: '0.8125rem',
            padding: '0.45rem 0.85rem'
          }}
          title="Refresh conversations and messages"
        >
          <RotateCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
          <span>{isRefreshing ? 'Refreshing...' : 'Refresh'}</span>
        </button>
      </div>

      {statusFeedback && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          background: '#f0fdf4',
          border: '1px solid #bbf7d0',
          borderRadius: 'var(--radius-sm)',
          padding: '0.6rem 1rem',
          color: '#15803d',
          fontSize: '0.8125rem'
        }}>
          <CheckCircle2 size={16} />
          <span>{statusFeedback}</span>
        </div>
      )}

      {/* 3-Column Enterprise Workspace */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '290px 1fr 260px',
        gap: '1px',
        background: 'var(--border-color)',
        border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
        height: '620px'
      }}>
        
        {/* Left Column: Conversations List */}
        <div style={{ background: '#ffffff', display: 'flex', flexDirection: 'column' }}>
          {/* Search Box */}
          <div style={{ padding: '0.75rem', borderBottom: '1px solid var(--border-color)' }}>
            <div style={{ position: 'relative', width: '100%' }}>
              <Search size={14} style={{ position: 'absolute', left: '0.65rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder="Search conversations..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ paddingLeft: '2rem', fontSize: '0.78rem' }}
              />
            </div>
          </div>

          {/* Conversations List */}
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
            {filteredConversations.map(c => {
              const isSelected = c.id === activeConvId;

              return (
                <div
                  key={c.id}
                  onClick={() => setActiveConvId(c.id)}
                  style={{
                    padding: '0.75rem 1rem',
                    borderBottom: '1px solid var(--border-color)',
                    background: isSelected ? '#eff6ff' : 'transparent',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.2rem',
                    borderLeft: isSelected ? '3px solid var(--brand-navy)' : '3px solid transparent',
                    transition: 'all var(--transition-fast)'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong style={{ fontSize: '0.8125rem', color: isSelected ? 'var(--brand-navy)' : 'var(--text-primary)' }}>
                      {c.customer_name}
                    </strong>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      {c.unread_count > 0 && (
                        <span style={{
                          background: '#16a34a',
                          color: '#ffffff',
                          borderRadius: '9999px',
                          padding: '0.1rem 0.4rem',
                          fontSize: '0.625rem',
                          fontWeight: 700
                        }}>
                          {c.unread_count}
                        </span>
                      )}
                      <span className="mono" style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
                        {new Date(c.last_message_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>

                  {c.company_name && (
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      {c.company_name}
                    </span>
                  )}

                  <p style={{
                    margin: '0.1rem 0 0 0',
                    fontSize: '0.75rem',
                    color: 'var(--text-secondary)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                  }}>
                    {c.last_message}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Center Column: Active Chat Thread */}
        {activeConv ? (
          <div style={{ background: '#f8fafc', display: 'flex', flexDirection: 'column' }}>
            
            {/* Chat Top Header */}
            <div style={{
              padding: '0.75rem 1.25rem',
              borderBottom: '1px solid var(--border-color)',
              background: '#ffffff',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <h3 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    {activeConv.customer_name}
                  </h3>
                  {activeConv.company_name && (
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      · {activeConv.company_name}
                    </span>
                  )}
                </div>
                <span className="mono" style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                  {activeConv.phone}
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                {activeConv.lead_id ? (
                  <span
                    className="badge badge-info"
                    style={{
                      fontSize: '0.7rem',
                      padding: '0.25rem 0.5rem',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.25rem'
                    }}
                    title="Linked to CRM Lead"
                  >
                    <span>Lead: {activeConv.lead_number || (linkedLead?.lead_number ?? 'Linked')}</span>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setSaveLeadModalOpen(true)}
                    className="btn-primary"
                    style={{
                      fontSize: '0.72rem',
                      padding: '0.3rem 0.6rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.3rem',
                      background: '#2563eb',
                      borderColor: '#2563eb'
                    }}
                    title="Save this WhatsApp contact as a CRM lead"
                  >
                    <UserPlus size={12} />
                    <span>Save as Lead</span>
                  </button>
                )}
                <a
                  href={`https://wa.me/${normalizeIndianPhone(activeConv.phone)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-secondary"
                  style={{ fontSize: '0.72rem', padding: '0.3rem 0.55rem', display: 'flex', alignItems: 'center', gap: '0.3rem', textDecoration: 'none', color: '#15803d' }}
                  title="Open in WhatsApp Web"
                >
                  <ExternalLink size={12} />
                  <span>WhatsApp Web</span>
                </a>
                <button
                  type="button"
                  onClick={() => setFollowUpModalOpen(true)}
                  className="btn-secondary"
                  style={{ fontSize: '0.72rem', padding: '0.3rem 0.55rem' }}
                >
                  <Clock size={12} />
                  <span>Follow-up</span>
                </button>
              </div>
            </div>

            {/* Message Feed */}
            <div style={{
              flex: 1,
              padding: '1rem',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.6rem'
            }}>
              {messages.map(msg => {
                const isStaff = msg.sender_type === 'staff';

                return (
                  <div
                    key={msg.id}
                    style={{
                      alignSelf: isStaff ? 'flex-end' : 'flex-start',
                      maxWidth: '75%',
                      background: isStaff ? '#dcfce7' : '#ffffff',
                      border: isStaff ? '1px solid #bbf7d0' : '1px solid var(--border-color)',
                      borderRadius: isStaff ? '8px 8px 2px 8px' : '8px 8px 8px 2px',
                      padding: '0.55rem 0.75rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.2rem',
                      boxShadow: 'var(--shadow-sm)'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
                      <strong style={{ fontSize: '0.7rem', color: isStaff ? '#15803d' : 'var(--text-primary)' }}>
                        {msg.sender_name}
                      </strong>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        <span className="mono" style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                          {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {isStaff && (
                          <span title={`Status: ${msg.status}${msg.error_message ? ` (${msg.error_message})` : ''}`}>
                            {msg.status === 'queued' && <Clock size={11} color="#6b7280" />}
                            {msg.status === 'sent' && <Check size={11} color="#6b7280" />}
                            {msg.status === 'delivered' && <CheckCheck size={11} color="#6b7280" />}
                            {msg.status === 'read' && <CheckCheck size={11} color="#2563eb" />}
                            {msg.status === 'failed' && <AlertCircle size={11} color="#dc2626" />}
                          </span>
                        )}
                      </div>
                    </div>

                    <p style={{ margin: 0, fontSize: '0.8125rem', lineHeight: 1.4, whiteSpace: 'pre-wrap', color: 'var(--text-primary)' }}>
                      {msg.text}
                    </p>

                    {msg.attachment_name && (
                      <div style={{
                        background: '#ffffff',
                        padding: '0.35rem 0.5rem',
                        borderRadius: '4px',
                        fontSize: '0.72rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.35rem',
                        marginTop: '0.2rem',
                        border: '1px solid var(--border-color)'
                      }}>
                        <FileText size={13} color="#dc2626" />
                        <span style={{ fontWeight: 600 }}>{msg.attachment_name}</span>
                      </div>
                    )}
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Quick Templates Selector */}
            <div style={{
              padding: '0.35rem 0.75rem',
              background: '#ffffff',
              borderTop: '1px solid var(--border-color)',
              display: 'flex',
              gap: '0.35rem',
              overflowX: 'auto'
            }}>
              <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', alignSelf: 'center', whiteSpace: 'nowrap', fontWeight: 600 }}>
                Templates:
              </span>
              {QUICK_TEMPLATES.map((tmpl, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleSelectTemplate(tmpl.text)}
                  className="btn-secondary"
                  style={{ fontSize: '0.6875rem', padding: '0.15rem 0.45rem', whiteSpace: 'nowrap' }}
                >
                  {tmpl.title}
                </button>
              ))}
            </div>

            {/* Chat Input Bar */}
            <form onSubmit={handleSendMessage} style={{
              padding: '0.65rem 0.75rem',
              borderTop: '1px solid var(--border-color)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              background: '#ffffff'
            }}>
              <button
                type="button"
                onClick={handleSendSimulatedAttachment}
                className="btn-secondary"
                style={{ padding: '0.45rem', borderRadius: 'var(--radius-sm)' }}
                title="Attach Quotation PDF"
              >
                <Paperclip size={15} />
              </button>

              <input
                type="text"
                placeholder="Type message or select response template..."
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                style={{ flex: 1, fontSize: '0.8125rem', padding: '0.45rem 0.65rem' }}
              />

              <button
                type="submit"
                className="btn-primary"
                style={{ background: '#16a34a', borderColor: '#16a34a', padding: '0.45rem 0.85rem', fontSize: '0.78rem' }}
              >
                <Send size={13} />
                <span>Send</span>
              </button>
            </form>

          </div>
        ) : (
          <div style={{ background: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>
            Select a conversation to view chat history.
          </div>
        )}

        {/* Right Column: Customer Context & Lead Summary */}
        <div style={{ background: '#ffffff', borderLeft: '1px solid var(--border-color)', padding: '0.85rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', overflowY: 'auto' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
            Client Context
          </div>

          {activeConv ? (
            <>
              <div className="card" style={{ padding: '0.75rem' }}>
                <strong style={{ fontSize: '0.875rem', display: 'block' }}>{activeConv.customer_name}</strong>
                {activeConv.company_name && (
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block' }}>{activeConv.company_name}</span>
                )}
                <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.4rem' }}>
                  <a href={`tel:${activeConv.phone}`} className="btn-secondary" style={{ fontSize: '0.72rem', padding: '0.25rem 0.5rem', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '3px' }}>
                    <Phone size={11} /> Call
                  </a>
                  <a href={`https://wa.me/${normalizeIndianPhone(activeConv.phone)}`} target="_blank" rel="noopener noreferrer" className="btn-secondary" style={{ fontSize: '0.72rem', padding: '0.25rem 0.5rem', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '3px', color: '#15803d' }}>
                    <ExternalLink size={11} /> WhatsApp
                  </a>
                </div>
              </div>

              {activeConv.lead_id ? (
                <div className="card" style={{ padding: '0.75rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                    <span className="mono" style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--brand-navy)' }}>
                      {linkedLead?.lead_number || activeConv.lead_number}
                    </span>
                    <span className="badge badge-info" style={{ fontSize: '0.65rem' }}>
                      {linkedLead?.status || 'Lead'}
                    </span>
                  </div>
                  {linkedLead?.service_required && (
                    <div style={{ fontSize: '0.78rem', fontWeight: 600 }}>
                      {linkedLead.service_required}
                    </div>
                  )}
                  {(linkedLead?.campaign_location || linkedLead?.location) && (
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
                      {linkedLead.campaign_location || linkedLead.location}
                    </div>
                  )}

                  {onOpenLead && (
                    <button
                      type="button"
                      onClick={() => onOpenLead(activeConv.lead_id!)}
                      className="btn-secondary"
                      style={{ width: '100%', marginTop: '0.65rem', fontSize: '0.72rem', padding: '0.3rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem' }}
                    >
                      <Eye size={12} />
                      <span>View Lead Drawer</span>
                    </button>
                  )}
                </div>
              ) : (
                <div className="card" style={{ padding: '0.75rem', background: '#f8fafc', border: '1px dashed var(--border-color)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginBottom: '0.3rem' }}>
                    <UserPlus size={13} color="var(--brand-navy)" />
                    <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-primary)' }}>Not in CRM Leads</span>
                  </div>
                  <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', margin: '0 0 0.65rem 0', lineHeight: 1.4 }}>
                    This WhatsApp contact is not connected to any CRM lead. You decide if and when to register them.
                  </p>
                  <button
                    type="button"
                    onClick={() => setSaveLeadModalOpen(true)}
                    className="btn-primary"
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.35rem',
                      fontSize: '0.75rem',
                      padding: '0.45rem',
                      background: '#2563eb',
                      borderColor: '#2563eb'
                    }}
                  >
                    <UserPlus size={13} />
                    <span>Save as CRM Lead</span>
                  </button>
                </div>
              )}
            </>
          ) : (
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>No conversation selected.</p>
          )}
        </div>

      </div>

      {/* Save as Lead Modal */}
      {saveLeadModalOpen && activeConv && (
        <SaveAsLeadModal
          isOpen={saveLeadModalOpen}
          onClose={() => setSaveLeadModalOpen(false)}
          conversation={activeConv}
          userEmail={userEmail}
          companyId={companyId}
          onSaved={(savedLead) => {
            setConversations(prev => prev.map(c => 
              c.id === activeConv.id 
                ? { ...c, lead_id: savedLead.id, lead_number: savedLead.lead_number, company_name: savedLead.company_name || c.company_name }
                : c
            ));
            setStatusFeedback(`Saved as Lead ${savedLead.lead_number}!`);
            setTimeout(() => setStatusFeedback(null), 4000);
          }}
        />
      )}

      {/* Follow-up modal from chat */}
      {followUpModalOpen && activeConv && (
        <FollowUpModal
          followUp={null}
          isOpen={followUpModalOpen}
          onClose={() => setFollowUpModalOpen(false)}
          onSaved={() => {
            setFollowUpModalOpen(false);
          }}
          userEmail={userEmail}
        />
      )}

    </div>
  );
};
