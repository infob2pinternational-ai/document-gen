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
  CheckCircle2,
  ArrowLeft,
  Info,
  X,
  Plus
} from 'lucide-react';

interface WhatsAppInboxProps {
  userRole?: string;
  userEmail?: string;
  companyId?: string;
  initialConversationId?: string | null;
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
  initialConversationId,
  onOpenLead
}) => {
  const [conversations, setConversations] = useState<WhatsAppConversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(initialConversationId || null);
  const [messages, setMessages] = useState<WhatsAppMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageFeedRef = useRef<HTMLDivElement>(null);

  // Responsive state
  const [windowWidth, setWindowWidth] = useState<number>(typeof window !== 'undefined' ? window.innerWidth : 1200);
  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list');
  const [showClientContext, setShowClientContext] = useState<boolean>(true);

  // Modals
  const [followUpModalOpen, setFollowUpModalOpen] = useState(false);
  const [saveLeadModalOpen, setSaveLeadModalOpen] = useState(false);
  const [newChatModalOpen, setNewChatModalOpen] = useState(false);
  const [newChatPhone, setNewChatPhone] = useState('');
  const [newChatName, setNewChatName] = useState('');
  const [newChatCompany, setNewChatCompany] = useState('');
  const [statusFeedback, setStatusFeedback] = useState<string | null>(null);

  const isMobile = windowWidth < 768;
  const isTablet = windowWidth >= 768 && windowWidth < 1150;

  useEffect(() => {
    const handleResize = () => {
      const w = window.innerWidth;
      setWindowWidth(w);
      if (w < 1150) {
        setShowClientContext(false);
      } else {
        setShowClientContext(true);
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Sync initial conversation ID when opened from notification
  useEffect(() => {
    if (initialConversationId) {
      setActiveConvId(initialConversationId);
      setMobileView('chat');
    }
  }, [initialConversationId]);

  const refreshConversations = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const list = await whatsappService.getConversations(companyId);
      setConversations(list);
      if (!activeConvId && !initialConversationId && list.length > 0 && !isMobile) {
        setActiveConvId(list[0].id);
      }
    } finally {
      setIsRefreshing(false);
    }
  }, [activeConvId, companyId, initialConversationId, isMobile]);

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

  // Scroll internal message feed to bottom when messages change without moving outer parent containers
  useEffect(() => {
    if (messageFeedRef.current) {
      messageFeedRef.current.scrollTop = messageFeedRef.current.scrollHeight;
    }
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

  const handleStartNewChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChatPhone.trim()) return;

    try {
      const conv = await whatsappService.getOrCreateConversationByPhone(
        newChatPhone.trim(),
        newChatName.trim() || undefined,
        newChatCompany.trim() || undefined,
        companyId
      );
      setNewChatModalOpen(false);
      setNewChatPhone('');
      setNewChatName('');
      setNewChatCompany('');
      await refreshConversations();
      setActiveConvId(conv.id);
      setMobileView('chat');
      setStatusFeedback(`Chat opened with ${conv.customer_name}`);
      setTimeout(() => setStatusFeedback(null), 4000);
    } catch (err) {
      console.error('[WhatsAppInbox] Failed to start new chat:', err);
      setStatusFeedback('Failed to start conversation. Please check phone number.');
      setTimeout(() => setStatusFeedback(null), 4000);
    }
  };

  const filteredConversations = conversations.filter(c =>
    c.customer_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (c.company_name && c.company_name.toLowerCase().includes(searchQuery.toLowerCase())) ||
    c.phone.includes(searchQuery) ||
    c.last_message.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Compute grid template columns dynamically
  const getGridTemplateColumns = () => {
    if (isMobile) return '1fr';
    if (isTablet) {
      return showClientContext ? '280px 1fr 260px' : '300px 1fr';
    }
    return showClientContext ? '300px 1fr 280px' : '340px 1fr';
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      
      {/* Header Bar */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: '#ffffff',
        border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-md)',
        padding: '0.875rem 1.25rem',
        boxShadow: 'var(--shadow-sm)',
        flexWrap: 'wrap',
        gap: '0.75rem'
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
              WhatsApp Business Workspace
            </h1>
            <span className="badge badge-success" style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem' }}>
              Connected: +91 81390 09034
            </span>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', margin: '0.2rem 0 0 0' }}>
            Multi-staff shared messaging inbox for quick quotations, route coordinates, and customer chats.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <button
            type="button"
            onClick={() => setNewChatModalOpen(true)}
            className="btn btn-primary"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
              fontSize: '0.8rem',
              padding: '0.45rem 0.8rem',
              background: '#16a34a',
              borderColor: '#16a34a'
            }}
          >
            <Plus size={15} />
            <span>New Chat</span>
          </button>

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
              fontSize: '0.8rem',
              padding: '0.45rem 0.8rem'
            }}
            title="Refresh conversations and messages"
          >
            <RotateCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
            <span>{isRefreshing ? 'Refreshing...' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {statusFeedback && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          background: '#f0fdf4',
          border: '1px solid #bbf7d0',
          borderRadius: 'var(--radius-sm)',
          padding: '0.55rem 0.85rem',
          color: '#15803d',
          fontSize: '0.8125rem'
        }}>
          <CheckCircle2 size={16} style={{ flexShrink: 0 }} />
          <span>{statusFeedback}</span>
        </div>
      )}

      {/* Main Workspace Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: getGridTemplateColumns(),
        background: 'var(--border-color)',
        border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
        height: 'min(calc(100vh - 170px), 820px)',
        minHeight: '560px',
        boxShadow: 'var(--shadow-sm)'
      }}>
        
        {/* Left Column: Conversations List (hidden on mobile when chat is active) */}
        {(!isMobile || mobileView === 'list') && (
          <div style={{
            background: '#ffffff',
            display: 'flex',
            flexDirection: 'column',
            borderRight: '1px solid var(--border-color)',
            minWidth: 0,
            height: '100%'
          }}>
            {/* Search Box */}
            <div style={{ padding: '0.65rem 0.75rem', borderBottom: '1px solid var(--border-color)', flexShrink: 0 }}>
              <div style={{ position: 'relative', width: '100%' }}>
                <Search size={14} style={{ position: 'absolute', left: '0.65rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  type="text"
                  placeholder="Search conversations..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{
                    width: '100%',
                    paddingLeft: '2rem',
                    paddingRight: '0.5rem',
                    paddingTop: '0.45rem',
                    paddingBottom: '0.45rem',
                    fontSize: '0.78rem',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-color)'
                  }}
                />
              </div>
            </div>

            {/* Conversations List */}
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
              {filteredConversations.length === 0 ? (
                <div style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                  No conversations found.
                </div>
              ) : (
                filteredConversations.map(c => {
                  const isSelected = c.id === activeConvId;

                  return (
                    <div
                      key={c.id}
                      onClick={() => {
                        setActiveConvId(c.id);
                        if (isMobile) setMobileView('chat');
                      }}
                      style={{
                        padding: '0.65rem 0.85rem',
                        borderBottom: '1px solid var(--border-color)',
                        background: isSelected ? '#f0fdf4' : 'transparent',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.2rem',
                        borderLeft: isSelected ? '3px solid #16a34a' : '3px solid transparent',
                        transition: 'background 0.15s ease'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.4rem' }}>
                        <strong style={{
                          fontSize: '0.8125rem',
                          color: isSelected ? '#15803d' : 'var(--text-primary)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          minWidth: 0,
                          flex: 1
                        }}>
                          {c.customer_name}
                        </strong>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexShrink: 0 }}>
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
                        <span style={{
                          fontSize: '0.72rem',
                          color: 'var(--text-muted)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis'
                        }}>
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
                })
              )}
            </div>
          </div>
        )}

        {/* Center Column: Active Chat Thread (hidden on mobile when list is active) */}
        {(!isMobile || mobileView === 'chat') && (
          activeConv ? (
            <div style={{
              background: '#f8fafc',
              display: 'flex',
              flexDirection: 'column',
              minWidth: 0,
              height: '100%'
            }}>
              
              {/* Chat Top Header */}
              <div style={{
                padding: '0.65rem 1rem',
                borderBottom: '1px solid var(--border-color)',
                background: '#ffffff',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '0.5rem',
                minWidth: 0,
                flexShrink: 0
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0, flex: '1 1 200px' }}>
                  {isMobile && (
                    <button
                      type="button"
                      onClick={() => setMobileView('list')}
                      className="btn-secondary"
                      style={{ padding: '0.35rem 0.5rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                      title="Back to conversation list"
                    >
                      <ArrowLeft size={14} />
                      <span>Back</span>
                    </button>
                  )}

                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 0 }}>
                      <h3 style={{
                        margin: 0,
                        fontSize: '0.9375rem',
                        fontWeight: 700,
                        color: 'var(--text-primary)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}>
                        {activeConv.customer_name}
                      </h3>
                      {activeConv.company_name && (
                        <span style={{
                          fontSize: '0.75rem',
                          color: 'var(--text-muted)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis'
                        }}>
                          · {activeConv.company_name}
                        </span>
                      )}
                    </div>
                    <span className="mono" style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                      {activeConv.phone}
                    </span>
                  </div>
                </div>

                {/* Header Action Buttons */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
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
                        padding: '0.3rem 0.55rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.3rem',
                        background: '#2563eb',
                        borderColor: '#2563eb'
                      }}
                      title="Save this WhatsApp contact as a CRM lead"
                    >
                      <UserPlus size={12} />
                      <span>Save Lead</span>
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
                    <span>WhatsApp</span>
                  </a>

                  <button
                    type="button"
                    onClick={() => setFollowUpModalOpen(true)}
                    className="btn-secondary"
                    style={{ fontSize: '0.72rem', padding: '0.3rem 0.55rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                    title="Schedule follow-up"
                  >
                    <Clock size={12} />
                    <span>Follow-up</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowClientContext(prev => !prev)}
                    className="btn-secondary"
                    style={{
                      fontSize: '0.72rem',
                      padding: '0.3rem 0.55rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.3rem',
                      background: showClientContext ? '#eff6ff' : undefined,
                      borderColor: showClientContext ? '#93c5fd' : undefined
                    }}
                    title={showClientContext ? 'Hide Client Context' : 'Show Client Context'}
                  >
                    <Info size={12} />
                    <span>Context</span>
                  </button>
                </div>
              </div>

              {/* Message Feed */}
              <div
                ref={messageFeedRef}
                style={{
                  flex: 1,
                  padding: '0.85rem 1rem',
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.65rem'
                }}
              >
                {messages.length === 0 ? (
                  <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem', margin: 'auto' }}>
                    No messages yet in this conversation.
                  </div>
                ) : (
                  messages.map(msg => {
                    const isStaff = msg.sender_type === 'staff';

                    return (
                      <div
                        key={msg.id}
                        style={{
                          alignSelf: isStaff ? 'flex-end' : 'flex-start',
                          maxWidth: isMobile ? '90%' : '75%',
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

                        <p style={{
                          margin: 0,
                          fontSize: '0.8125rem',
                          lineHeight: 1.4,
                          whiteSpace: 'pre-wrap',
                          color: 'var(--text-primary)',
                          wordBreak: 'break-word',
                          overflowWrap: 'anywhere'
                        }}>
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
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Quick Templates Selector */}
              <div style={{
                padding: '0.35rem 0.75rem',
                background: '#ffffff',
                borderTop: '1px solid var(--border-color)',
                display: 'flex',
                gap: '0.35rem',
                overflowX: 'auto',
                alignItems: 'center',
                flexShrink: 0
              }}>
                <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', fontWeight: 600, flexShrink: 0 }}>
                  Templates:
                </span>
                {QUICK_TEMPLATES.map((tmpl, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleSelectTemplate(tmpl.text)}
                    className="btn-secondary"
                    style={{ fontSize: '0.6875rem', padding: '0.2rem 0.45rem', whiteSpace: 'nowrap', flexShrink: 0 }}
                  >
                    {tmpl.title}
                  </button>
                ))}
              </div>

              {/* Chat Input Bar */}
              <form onSubmit={handleSendMessage} style={{
                padding: '0.55rem 0.75rem',
                borderTop: '1px solid var(--border-color)',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                background: '#ffffff',
                flexShrink: 0
              }}>
                <button
                  type="button"
                  onClick={handleSendSimulatedAttachment}
                  className="btn-secondary"
                  style={{ padding: '0.45rem', borderRadius: 'var(--radius-sm)', flexShrink: 0 }}
                  title="Attach Quotation PDF"
                >
                  <Paperclip size={15} />
                </button>

                <input
                  type="text"
                  placeholder="Type message or select response template..."
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  style={{
                    flex: 1,
                    fontSize: '0.8125rem',
                    padding: '0.45rem 0.65rem',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-color)',
                    minWidth: 0
                  }}
                />

                <button
                  type="submit"
                  disabled={isSending || !inputText.trim()}
                  className="btn-primary"
                  style={{
                    background: '#16a34a',
                    borderColor: '#16a34a',
                    padding: '0.45rem 0.85rem',
                    fontSize: '0.78rem',
                    flexShrink: 0,
                    opacity: (isSending || !inputText.trim()) ? 0.6 : 1
                  }}
                >
                  <Send size={13} />
                  <span>Send</span>
                </button>
              </form>

            </div>
          ) : (
            <div style={{
              background: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-secondary)',
              fontSize: '0.85rem',
              padding: '2rem'
            }}>
              Select a conversation to view chat history.
            </div>
          )
        )}

        {/* Right Column: Customer Context & Lead Summary (Toggleable) */}
        {showClientContext && (!isMobile || mobileView === 'chat') && activeConv && (
          <div style={{
            background: '#ffffff',
            borderLeft: '1px solid var(--border-color)',
            padding: '0.85rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem',
            overflowY: 'auto',
            minWidth: 0,
            height: '100%'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
              <span style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                Client Context
              </span>
              <button
                type="button"
                onClick={() => setShowClientContext(false)}
                className="btn-secondary"
                style={{ padding: '0.2rem', borderRadius: '4px', border: 'none' }}
                title="Close Context Drawer"
              >
                <X size={14} />
              </button>
            </div>

            {activeConv ? (
              <>
                <div className="card" style={{ padding: '0.75rem' }}>
                  <strong style={{ fontSize: '0.875rem', display: 'block', wordBreak: 'break-word' }}>
                    {activeConv.customer_name}
                  </strong>
                  {activeConv.company_name && (
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginTop: '0.15rem' }}>
                      {activeConv.company_name}
                    </span>
                  )}
                  <span className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginTop: '0.25rem' }}>
                    {activeConv.phone}
                  </span>

                  <div style={{ marginTop: '0.65rem', display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                    <a
                      href={`tel:${activeConv.phone}`}
                      className="btn-secondary"
                      style={{ fontSize: '0.72rem', padding: '0.25rem 0.5rem', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '3px' }}
                    >
                      <Phone size={11} /> Call
                    </a>
                    <a
                      href={`https://wa.me/${normalizeIndianPhone(activeConv.phone)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-secondary"
                      style={{ fontSize: '0.72rem', padding: '0.25rem 0.5rem', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '3px', color: '#15803d' }}
                    >
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
                        style={{ width: '100%', marginTop: '0.65rem', fontSize: '0.72rem', padding: '0.35rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem' }}
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
        )}

      </div>

      {/* New Chat Modal */}
      {newChatModalOpen && (
        <div className="modal-backdrop" style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '1rem'
        }}>
          <div className="card" style={{
            background: '#ffffff',
            maxWidth: '420px',
            width: '100%',
            padding: '1.25rem',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-lg)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>Start WhatsApp Chat</h3>
              <button
                type="button"
                onClick={() => setNewChatModalOpen(false)}
                className="btn-secondary"
                style={{ padding: '0.25rem', border: 'none' }}
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleStartNewChat} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.3rem' }}>
                  Mobile / WhatsApp Number *
                </label>
                <input
                  type="text"
                  placeholder="e.g. 9846012345 or +919846012345"
                  value={newChatPhone}
                  onChange={(e) => setNewChatPhone(e.target.value)}
                  required
                  style={{ width: '100%', fontSize: '0.8125rem', padding: '0.5rem' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.3rem' }}>
                  Customer Name (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Rahul Sharma"
                  value={newChatName}
                  onChange={(e) => setNewChatName(e.target.value)}
                  style={{ width: '100%', fontSize: '0.8125rem', padding: '0.5rem' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.3rem' }}>
                  Company Name (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Kerala Builders"
                  value={newChatCompany}
                  onChange={(e) => setNewChatCompany(e.target.value)}
                  style={{ width: '100%', fontSize: '0.8125rem', padding: '0.5rem' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => setNewChatModalOpen(false)}
                  className="btn btn-secondary"
                  style={{ fontSize: '0.8rem', padding: '0.45rem 0.85rem' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newChatPhone.trim()}
                  className="btn btn-primary"
                  style={{
                    fontSize: '0.8rem',
                    padding: '0.45rem 0.85rem',
                    background: '#16a34a',
                    borderColor: '#16a34a'
                  }}
                >
                  Open Chat
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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
