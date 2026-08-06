import React, { useState, useEffect } from 'react';
import type { CompanyProfile, Document, Customer, Service } from './types';
import { dbService, isSupabaseConfigured, supabase, SQL_SCHEMA } from './services/db';
import { startBrowserWorker, stopBrowserWorker, getQueueStatusForCompany, type SyncQueueRow } from './services/sheetsSyncQueue';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { Documents } from './components/Documents';
import { GoogleSyncDashboard } from './components/GoogleSyncDashboard';
import { Customers } from './components/Customers';
import { Services } from './components/Services';
import { Settings } from './components/Settings';
import { DocumentEditor } from './components/DocumentEditor';
import { DocumentPreview } from './components/DocumentPreview';
import { AuthPanel } from './components/AuthPanel';
import { ComparisonEditor } from './components/comparison/ComparisonEditor';
import { ComparisonPreview } from './components/comparison/ComparisonPreview';
import { Building, Menu, Moon, Sun, Download, Cloud } from 'lucide-react';
import { getRecoverableDrafts, deleteDraft, type DraftSummary } from './utils/drafts';

const playNotificationSound = () => {
  try {
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
    
    // First chime note
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    gain1.gain.setValueAtTime(0.08, ctx.currentTime);
    gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start();
    osc1.stop(ctx.currentTime + 0.4);
    
    // Second chime note (slightly delayed)
    setTimeout(() => {
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(880, ctx.currentTime); // A5
      gain2.gain.setValueAtTime(0.08, ctx.currentTime);
      gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start();
      osc2.stop(ctx.currentTime + 0.6);
    }, 120);
  } catch (err) {
    console.error('Audio chime failed:', err);
  }
};

function App() {
  const [currentTab, setCurrentTab] = useState<string>('dashboard');
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  
  // Profiles & Loading States
  const [profiles, setProfiles] = useState<CompanyProfile[]>([]);
  const [activeProfile, setActiveProfile] = useState<CompanyProfile | null>(null);
  const [profilesLoading, setProfilesLoading] = useState(true);
  
  // Data States (Preloaded to prevent tab switching lag)
  const [documents, setDocuments] = useState<Document[]>([]);
  const documentsRef = React.useRef<Document[]>([]);
  useEffect(() => {
    documentsRef.current = documents;
  }, [documents]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [syncQueue, setSyncQueue] = useState<SyncQueueRow[]>([]);
  
  // Sub-views
  const [editorOpen, setEditorOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [documentToEdit, setDocumentToEdit] = useState<Document | null>(null);
  const [comparisonEditorActive, setComparisonEditorActive] = useState(false);
  const [documentToPreview, setDocumentToPreview] = useState<Document | null>(null);
  const [recoverableDrafts, setRecoverableDrafts] = useState<DraftSummary[]>([]);
  const [draftToRestore, setDraftToRestore] = useState<any>(null);
  
  // Modals
  const [showAddProfileModal, setShowAddProfileModal] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const [newProfileCurrency, setNewProfileCurrency] = useState('INR');

  // Supabase Auth States
  const [user, setUser] = useState<any>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showPasswordResetModal, setShowPasswordResetModal] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'info' | 'success' } | null>(null);

  // Public View States
  const [publicViewDocId, setPublicViewDocId] = useState<string | null>(null);
  const [publicViewDoc, setPublicViewDoc] = useState<Document | null>(null);
  const [publicViewLoading, setPublicViewLoading] = useState(false);

  // Saturday 5:00 PM Backup Reminder State & Checks
  const [showSaturdayBackupReminder, setShowSaturdayBackupReminder] = useState(false);

  const checkSaturdayBackupReminder = () => {
    const now = new Date();
    const day = now.getDay(); // 0 = Sun, 6 = Sat
    const hours = now.getHours();

    if (day === 6 && hours >= 17) {
      const todayDateStr = now.toISOString().split('T')[0];
      const dismissedDate = localStorage.getItem('docgen_saturday_backup_dismissed_date');
      if (dismissedDate !== todayDateStr) {
        setShowSaturdayBackupReminder(true);
        
        // Dispatch browser system notification if permitted
        if ('Notification' in window && Notification.permission === 'granted') {
          const lastNotifDate = localStorage.getItem('docgen_saturday_notif_date');
          if (lastNotifDate !== todayDateStr) {
            try {
              new Notification('B2P Portal - Saturday Backup Reminder', {
                body: "It's Saturday 5:00 PM! Please download your weekly document backup (.zip) to protect all records.",
                icon: '/billing/logo_b2p.png'
              });
              localStorage.setItem('docgen_saturday_notif_date', todayDateStr);
            } catch (e) {}
          }
        }
      }
    } else {
      setShowSaturdayBackupReminder(false);
    }
  };

  useEffect(() => {
    checkSaturdayBackupReminder();
    const interval = setInterval(checkSaturdayBackupReminder, 30000); // Re-check every 30 seconds
    return () => clearInterval(interval);
  }, []);

  const handleDismissSaturdayReminder = () => {
    const now = new Date();
    const todayDateStr = now.toISOString().split('T')[0];
    localStorage.setItem('docgen_saturday_backup_dismissed_date', todayDateStr);
    setShowSaturdayBackupReminder(false);
  };

  // Initialize Theme
  useEffect(() => {
    const savedTheme = localStorage.getItem('docgen_theme') as 'light' | 'dark' | null;
    const initialTheme = savedTheme || 'dark';
    setTheme(initialTheme);
    document.documentElement.setAttribute('data-theme', initialTheme);
  }, []);

  // Google Sheets sync worker (Phase B2) - starts on app load, resumes
  // immediately on the browser's 'online' event, and runs on a periodic
  // interval in between. No-ops entirely in offline/local mode (no
  // Supabase configured), since the sync queue lives in Postgres.
  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    startBrowserWorker();
    return () => stopBrowserWorker();
  }, []);

  // Detect Public Share URL Parameter or Path Routing
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const viewIdParam = params.get('view');
    const path = window.location.pathname;
    
    let viewId: string | null = viewIdParam;
    let docNumber: string | null = null;
    
    if (path.startsWith('/doc/') || path.startsWith('/view/')) {
      const parts = path.split('/');
      viewId = parts[2] || null;
    } else if (path.startsWith('/q/')) {
      const parts = path.split('/');
      docNumber = parts[2] || null;
    }

    // Handle /#doc=<uuid> hash-fragment links generated by
    // DocumentEditor and ComparisonEditor's WhatsApp/clipboard
    // share flows. These were being generated but never consumed
    // (location.hash was never read) — fixing that here.
    if (!viewId && !docNumber && window.location.hash) {
      const hashMatch = window.location.hash.match(/^#doc=(.+)$/);
      if (hashMatch) {
        viewId = hashMatch[1];
      }
    }
    
    if (viewId) {
      if (import.meta.env.DEV) console.log('App: Public view detected for ID:', viewId);
      setPublicViewDocId(viewId);
      setPublicViewLoading(true);
      // Uses the get_public_document RPC (Phase 1 of the RLS hardening
      // work) instead of a direct table query - returns only the
      // whitelisted fields the public preview renders.
      dbService.getPublicDocument({ id: viewId }).then((res) => {
        if (res) {
          if (import.meta.env.DEV) console.log('App: Public view document loaded successfully by ID:', res.document);
          setPublicViewDoc(res.document);
        } else {
          if (import.meta.env.DEV) console.log('App: Public view document not found');
        }
        setPublicViewLoading(false);
      }).catch((err) => {
        console.error('App: Error loading public view document by ID:', err);
        setPublicViewLoading(false);
      });
    } else if (docNumber) {
      if (import.meta.env.DEV) console.log('App: Public view detected for Document Number:', docNumber);
      setPublicViewLoading(true);
      // Uses the get_public_document RPC, same as the ID-based lookup
      // above - closes the last remaining anonymous full-table read
      // (the old getDocumentByNumber fetched every document row and
      // filtered client-side).
      dbService.getPublicDocument({ documentNumber: docNumber }).then((res) => {
        if (res) {
          if (import.meta.env.DEV) console.log('App: Public view document loaded successfully by Number:', res.document);
          setPublicViewDocId(res.document.id);
          setPublicViewDoc(res.document);
        } else {
          if (import.meta.env.DEV) console.log('App: Public view document not found by Number');
        }
        setPublicViewLoading(false);
      }).catch((err) => {
        console.error('App: Error loading public view document by number:', err);
        setPublicViewLoading(false);
      });
    }
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('docgen_theme', newTheme);
  };

  // Initialize Supabase User Session
  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    
    // Read cached user
    const cached = localStorage.getItem('supabase_user');
    if (cached) {
      setUser(JSON.parse(cached));
    }

    // Listener
    const { data: { subscription } } = supabase!.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setShowPasswordResetModal(true);
      }
      if (session?.user) {
        localStorage.setItem('supabase_user', JSON.stringify(session.user));
        setUser(session.user);
      } else {
        localStorage.removeItem('supabase_user');
        setUser(null);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const handleLogout = async () => {
    if (supabase) {
      await supabase.auth.signOut();
    }
    localStorage.removeItem('supabase_user');
    setUser(null);
    setProfiles([]);
    setActiveProfile(null);
    setDocuments([]);
  };

  // Auto-expire inactive cloud sessions: if a logged-in user leaves the
  // tab idle for 30 minutes, sign them out so a shared/unattended device
  // doesn't leave a company's billing data open indefinitely. Local
  // (non-cloud) sandbox usage is unaffected.
  useEffect(() => {
    if (!user) return;
    const IDLE_LIMIT_MS = 30 * 60 * 1000;
    let idleTimer: ReturnType<typeof setTimeout>;

    const resetIdleTimer = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        handleLogout();
      }, IDLE_LIMIT_MS);
    };

    const activityEvents = ['mousedown', 'keydown', 'touchstart', 'scroll'];
    activityEvents.forEach(evt => window.addEventListener(evt, resetIdleTimer));
    resetIdleTimer();

    return () => {
      clearTimeout(idleTimer);
      activityEvents.forEach(evt => window.removeEventListener(evt, resetIdleTimer));
    };
  }, [user]);

  // Real-time listener for document approvals and state sync
  useEffect(() => {
    if (!supabase || !activeProfile || !user) return;
    
    const channelName = `company-alerts-${activeProfile.id}`;
    console.log(`[Realtime] Subscription created for channel: ${channelName}`);
    let isInitialConnection = true;

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*', // Listen to INSERT, UPDATE, DELETE
          schema: 'public',
          table: 'documents'
        },
        (payload) => {
          const newDoc = payload.new as any;
          const oldDoc = payload.old as any;
          const targetDoc = newDoc || oldDoc;

          if (!targetDoc || targetDoc.company_id !== activeProfile.id) {
            // Event is for a different company profile, ignore
            return;
          }

          if (payload.eventType === 'INSERT') {
            console.log('[Realtime] INSERT event');
          } else if (payload.eventType === 'UPDATE') {
            console.log('[Realtime] UPDATE event');
          } else if (payload.eventType === 'DELETE') {
            console.log('[Realtime] DELETE event');
          }

          // Merge the changed row directly into local state using the
          // payload Postgres already sent us (payload.new / payload.old),
          // instead of re-fetching the whole documents list from the DB.
          // This removes a duplicate network request that used to run on
          // every event, including on the client's own save - where the
          // action that caused this event (e.g. onRefreshDocs) already
          // did a full, authoritative getDocuments() fetch a moment
          // earlier. getDocuments() is a plain `select('*')` with no
          // transformation, so the raw row shape here matches it exactly;
          // sorting is reproduced manually to match getDocuments()'s
          // `.order('date', desc).order('created_at', desc)`.
          setDocuments(prevDocs => {
            let updated: Document[];
            if (payload.eventType === 'DELETE') {
              updated = prevDocs.filter(d => d.id !== targetDoc.id);
            } else {
              const idx = prevDocs.findIndex(d => d.id === newDoc.id);
              if (idx >= 0) {
                updated = [...prevDocs];
                updated[idx] = newDoc;
              } else {
                updated = [...prevDocs, newDoc];
              }
            }
            updated.sort((a, b) => {
              const dateCompare = (b.date || '').localeCompare(a.date || '');
              if (dateCompare !== 0) return dateCompare;
              return ((b as any).created_at || '').localeCompare((a as any).created_at || '');
            });
            return updated;
          });
          console.log('[Realtime] Documents updated locally from payload (no re-fetch)');

          if (!newDoc) return; // For DELETE event, newDoc is null
          
          // Get the previous version of this document from our current React state
          const prevDoc = documentsRef.current.find(d => d.id === newDoc.id);
          const prevStatus = prevDoc ? prevDoc.status : (oldDoc ? oldDoc.status : undefined);

          // 1. Alert for approval request
          const isNewPending = payload.eventType === 'INSERT' && newDoc.status === 'pending_approval';
          const isUpdatedPending = payload.eventType === 'UPDATE' && 
                                   newDoc.status === 'pending_approval' && 
                                   prevStatus !== 'pending_approval';
                                   
          if (isNewPending || isUpdatedPending) {
            const currentEmail = (user.email || '').toLowerCase();
            const allowedToApprove = 
              !activeProfile.approver_email || 
              currentEmail === activeProfile.approver_email.toLowerCase();
              
            if (allowedToApprove) {
              console.log('[Realtime] Notification triggered');
              playNotificationSound();
              setToast({
                message: `Document ${newDoc.document_number} ${isUpdatedPending ? 'amended and ' : ''}needs approval.`,
                type: 'info'
              });
            }
          }

          // 2. Alert for document approval
          const isApproved = payload.eventType === 'UPDATE' && 
                             newDoc.status === 'approved' && 
                             prevStatus !== 'approved';

          if (isApproved) {
            console.log('[Realtime] Approval notification triggered');
            playNotificationSound();
            const docTypeStr = newDoc.document_type === 'quotation' ? 'Quotation' :
                               newDoc.document_type === 'invoice' ? 'Invoice' :
                               newDoc.document_type === 'work_order' ? 'Work Order' :
                               newDoc.document_type === 'proforma_invoice' ? 'Proforma Invoice' : 'Document';
            setToast({
              message: `${docTypeStr} ${newDoc.document_number} approved.`,
              type: 'success'
            });
          }

          // 3. Alert for document rejection
          const isRejected = payload.eventType === 'UPDATE' && 
                             newDoc.status === 'rejected' && 
                             prevStatus !== 'rejected';

          if (isRejected) {
            console.log('[Realtime] Rejection notification triggered');
            playNotificationSound();
            const docTypeStr = newDoc.document_type === 'quotation' ? 'Quotation' :
                               newDoc.document_type === 'invoice' ? 'Invoice' :
                               newDoc.document_type === 'work_order' ? 'Work Order' :
                               newDoc.document_type === 'proforma_invoice' ? 'Proforma Invoice' : 'Document';
            setToast({
              message: `${docTypeStr} ${newDoc.document_number} rejected.`,
              type: 'info'
            });
          }
        }
      )
      .subscribe((status, err) => {
        console.log(`[Realtime] Channel status: ${status}`);
        if (err) {
          console.error('[Realtime] WebSocket error:', err);
        }
        
        if (status === 'SUBSCRIBED') {
          if (isInitialConnection) {
            console.log('[Realtime] Subscription connected');
            isInitialConnection = false;
          } else {
            console.log('[Realtime] Reconnect attempt');
            console.log('[Realtime] Subscription connected');
          }
        } else if (status === 'CLOSED') {
          console.log('[Realtime] Subscription disconnected');
        }
      });
      
    return () => {
      supabase?.removeChannel(channel);
      console.log('[Realtime] Subscription disconnected');
    };
  }, [supabase, activeProfile, user]);

  // Realtime sync for google_sync_queue and google_sync_log (Phase B4) -
  // same merge-not-refetch pattern as the documents subscription above:
  // apply the event payload directly to local state instead of
  // re-querying, since Postgres already sent the full row.
  useEffect(() => {
    if (!supabase || !activeProfile || !user) return;

    const channel = supabase
      .channel(`sync-queue-${activeProfile.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'google_sync_queue' },
        (payload) => {
          const newRow = payload.new as any;
          const oldRow = payload.old as any;
          const target = newRow || oldRow;
          if (!target || target.company_id !== activeProfile.id) return;

          setSyncQueue(prev => {
            if (payload.eventType === 'DELETE') {
              return prev.filter(r => r.id !== target.id);
            }
            const idx = prev.findIndex(r => r.id === newRow.id);
            if (idx >= 0) {
              const updated = [...prev];
              updated[idx] = newRow;
              return updated;
            }
            return [...prev, newRow];
          });
        }
      )
      .subscribe();

    return () => {
      supabase?.removeChannel(channel);
    };
  }, [supabase, activeProfile, user]);

  // Auto-clear toast alert after 10 seconds
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => {
        setToast(null);
      }, 10000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setResetLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      alert('Password updated successfully!');
      setShowPasswordResetModal(false);
      setNewPassword('');
    } catch (err: any) {
      console.error('Error resetting password:', err);
      alert(err.message || 'Failed to reset password.');
    } finally {
      setResetLoading(false);
    }
  };

  // Phase 1 (data-loading consolidation): single source of truth for
  // fetching documents, customers, and services for a given company
  // profile, plus the previewDocId deep-link handling that used to live
  // only inside the [activeProfile] effect below. loadData() and the
  // [activeProfile] effect both now call this instead of each keeping
  // their own copy of the same fetch logic. Behavior is intentionally
  // unchanged in this phase, including the pre-existing getServices()
  // call with no company id (kept as-is; scoping this is a later phase).
  const refreshCompanyData = async (profileId: string) => {
    const [docs, custs, servs, queue] = await Promise.all([
      dbService.getDocuments(profileId),
      dbService.getCustomers(profileId),
      dbService.getServices(),
      getQueueStatusForCompany(profileId)
    ]);
    setDocuments(docs);
    setCustomers(custs);
    setServices(servs);
    setSyncQueue(queue);

    // Handle deep-linking from push notifications (previewDocId)
    const params = new URLSearchParams(window.location.search);
    const previewId = params.get('previewDocId');
    if (previewId) {
      const docToPreview = docs.find(d => d.id === previewId);
      if (docToPreview) {
        setDocumentToPreview(docToPreview);
        setPreviewOpen(true);
        // Clean up the URL parameter
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    }

    return { docs, custs, servs };
  };

  // Load Company Profiles, Documents, Customers, and Services in parallel
  const loadData = async (selectNewId?: string) => {
    setProfilesLoading(true);
    try {
      const rawProfiles = await dbService.getProfiles();
      const profileList = rawProfiles.map(p => {
        const lowerName = p.name.toLowerCase();
        let logo_url = p.logo_url;
        if (lowerName.includes('international')) {
          logo_url = '/billing/logo_b2p_international.png?v=5';
        } else if (lowerName.includes('inter media') || lowerName.includes('inter-media')) {
          logo_url = '/billing/logo_b2p_intermedia.png?v=5';
        } else if (lowerName.includes('b2p')) {
          logo_url = '/billing/logo_b2p_international.png?v=5';
        }

        if (lowerName.includes('international')) {
          return { ...p, logo_url, gstin: undefined, pan: undefined };
        }
        return { ...p, logo_url };
      });
      setProfiles(profileList);

      if (profileList.length > 0) {
        // If a new profile ID was passed, set it active. Else find in localStorage or default to first
        let active = profileList[0];
        if (selectNewId) {
          const found = profileList.find(p => p.id === selectNewId);
          if (found) active = found;
        } else {
          const lastActiveId = localStorage.getItem('docgen_active_profile_id');
          const found = profileList.find(p => p.id === lastActiveId);
          if (found) active = found;
        }

        setActiveProfile(active);
        localStorage.setItem('docgen_active_profile_id', active.id);
        
        // Fetch docs, customers, and services via the shared loader
        await refreshCompanyData(active.id);
      } else {
        setActiveProfile(null);
        setDocuments([]);
        setCustomers([]);
        setServices([]);
      }
    } catch (err) {
      console.error('Error loading application data:', err);
    } finally {
      setProfilesLoading(false);
    }
  };

  useEffect(() => {
    // Load data if either Cloud connection is logged in or Sandbox is active
    if (!isSupabaseConfigured() || user) {
      loadData();
    }
  }, [user]);

  // Check for recoverable drafts on startup (Phase A3: multi-draft registry;
  // Phase A4: now includes ComparisonEditor drafts too).
  useEffect(() => {
    setRecoverableDrafts(getRecoverableDrafts());
  }, []);

  const refreshRecoverableDrafts = () => {
    setRecoverableDrafts(getRecoverableDrafts());
  };

  const handleRestoreDraft = (summary: DraftSummary) => {
    // Both editors restore their own draft content on mount (Phase A2/A4) -
    // App.tsx only needs to open the right editor with the matching
    // documentToEdit (or null for a new-document draft) so it computes
    // the same draftKey.
    if (summary.editorType === 'comparison') {
      if (summary.documentId) {
        const matchingDoc = documents.find(d => d.id === summary.documentId)
          || ({ id: summary.documentId, document_type: summary.docType } as Document);
        setDocumentToEdit(matchingDoc);
        setComparisonEditorActive(false); // render branch already picks ComparisonEditor via document_type
      } else {
        setDocumentToEdit(null);
        setComparisonEditorType(summary.docType as 'comparison_quotation' | 'comparison_invoice');
        setComparisonEditorActive(true);
      }
    } else {
      const matchingDoc = summary.documentId
        ? (documents.find(d => d.id === summary.documentId) || ({ id: summary.documentId } as Document))
        : null;
      setDocumentToEdit(matchingDoc);
    }
    setCurrentTab('documents');
    setEditorOpen(true);
    setRecoverableDrafts(prev => prev.filter(d => d.draftKey !== summary.draftKey));
  };

  const handleDiscardDraftEntry = (draftKey: string) => {
    deleteDraft(draftKey);
    setRecoverableDrafts(prev => prev.filter(d => d.draftKey !== draftKey));
  };

  const handleCloseEditor = () => {
    setEditorOpen(false);
    setComparisonEditorActive(false);
    setDraftToRestore(null);
    // Drafts are NOT deleted on close (Phase A2/A4) - just refresh the
    // registry in case a new draft was created during this session.
    refreshRecoverableDrafts();
  };

  // Phase 2 (data-loading consolidation): the useEffect that used to live
  // here (firing on every `activeProfile` change) has been removed.
  // It was a redundant second trigger for exactly the same fetch that
  // loadData() already performs directly via refreshCompanyData() -
  // whenever loadData() sets a new active profile object, this effect
  // fired again immediately afterward and re-fetched the same data a
  // second time. The one case where this effect was the ONLY loader -
  // a manual profile switch from the Sidebar - now calls
  // refreshCompanyData() directly at that call site instead (see the
  // Sidebar's setActiveProfile prop below). refreshCompanyData() is now
  // the sole function that ever loads documents/customers/services, and
  // it is invoked explicitly at every place activeProfile changes to a
  // real profile, rather than implicitly via a reactive effect.

  // Document management actions
  const handleEditDocument = (doc: Document) => {
    setDocumentToEdit(doc);
    setCurrentTab('documents');
    setEditorOpen(true);
  };

  const handleCreateDocument = () => {
    setDocumentToEdit(null);
    setCurrentTab('documents');
    setEditorOpen(true);
  };

  const [comparisonEditorType, setComparisonEditorType] = useState<'comparison_quotation' | 'comparison_invoice'>('comparison_quotation');

  const handleCreateComparison = (type: 'comparison_quotation' | 'comparison_invoice') => {
    setDocumentToEdit(null);
    setComparisonEditorType(type);
    setComparisonEditorActive(true);
    setCurrentTab('documents');
    setEditorOpen(true);
  };

  const handleViewDocument = (doc: Document) => {
    setDocumentToPreview(doc);
    setPreviewOpen(true);
  };

  const handleDeleteDocument = async (id: string) => {
    const docToDelete = documents.find(d => d.id === id);
    try {
      // Enqueue Google Sheets delete-sync BEFORE the actual delete below -
      // the queue row's document_id FK must reference a still-existing
      // document at insert time (ON DELETE SET NULL only governs what
      // happens to this row once the document is later removed, not
      // whether a new row can reference an already-gone one). Must be
      // awaited (not fire-and-forget) so it's guaranteed to complete
      // before the delete runs - unlike the old direct-fetch call, this
      // one has a real data dependency on the document still existing.
      if (activeProfile && activeProfile.google_sheets_url && docToDelete?.document_number) {
        await dbService.deleteDocumentFromGoogleSheets(
          activeProfile.google_sheets_url,
          activeProfile.id,
          id,
          docToDelete.document_number
        ).catch(err => console.error('Failed to enqueue Google Sheet deletion sync:', err));
      }

      await dbService.deleteDocument(id);
      if (activeProfile) {
        const docs = await dbService.getDocuments(activeProfile.id);
        setDocuments(docs);
      }
    } catch (err) {
      console.error('Error deleting document:', err);
      alert('Failed to delete document.');
    }
  };

  // Add Company profile action
  const handleAddProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProfileName.trim()) return;

    try {
      const newId = crypto.randomUUID();
      const newProf: CompanyProfile = {
        id: newId,
        name: newProfileName,
        currency: newProfileCurrency,
        col_name_description: 'Description',
        col_name_quantity: 'Quantity',
        col_name_unit: 'Unit',
        col_name_rate: 'Rate',
        col_name_amount: 'Amount',
        invoice_prefix: 'INV/',
        invoice_start_number: 1001,
        proforma_prefix: 'PI/',
        proforma_start_number: 1001,
        quotation_prefix: 'QTN/',
        quotation_start_number: 1001,
        work_order_prefix: 'WO/',
        work_order_start_number: 1001
      };

      await dbService.saveProfile(newProf);
      setNewProfileName('');
      setShowAddProfileModal(false);
      
      // Reload and set this new profile as active
      await loadData(newId);
    } catch (err) {
      console.error('Error creating company profile:', err);
      alert('Failed to create company profile.');
    }
  };

  // Render Public Share Document View if parameter is present
  if (publicViewDocId) {
    if (publicViewLoading) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          backgroundColor: '#030712',
          color: '#ffffff',
          fontFamily: "'Outfit', sans-serif"
        }}>
          <p style={{ fontSize: '1rem', fontWeight: 500 }}>Loading shared document...</p>
        </div>
      );
    }
    if (!publicViewDoc) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          backgroundColor: '#030712',
          color: '#ffffff',
          fontFamily: "'Outfit', sans-serif",
          padding: '2rem',
          textAlign: 'center'
        }}>
          <h3 style={{ fontSize: '1.25rem', marginBottom: '0.5rem', color: 'var(--accent-danger)' }}>Document Not Found</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>The requested document does not exist or has been deleted.</p>
        </div>
      );
    }
    return (
      <div style={{
        backgroundColor: '#030712',
        minHeight: '100vh',
        padding: '2rem 1rem',
        display: 'flex',
        justifyContent: 'center'
      }}>
        <div style={{ width: '100%', maxWidth: '800px' }}>
          <DocumentPreview 
            activeProfile={null}
            document={publicViewDoc}
            onClose={() => {}}
            isPublicShare={true}
          />
        </div>
      </div>
    );
  }

  // If Supabase credentials exist and user is not authenticated: Show AuthPanel (forced)
  if (isSupabaseConfigured() && !user) {
    return (
      <AuthPanel 
        onAuthSuccess={(usr) => setUser(usr)}
      />
    );
  }

  // Show a clean loading block if still fetching profiles on startup
  if (profilesLoading) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        backgroundColor: '#050914',
        color: '#ffffff',
        fontFamily: "'Outfit', sans-serif"
      }}>
        <div style={{
          width: '40px',
          height: '40px',
          borderRadius: '50%',
          border: '3px solid rgba(255,255,255,0.1)',
          borderTopColor: '#2563eb',
          animation: 'spin 1s linear infinite',
          marginBottom: '1rem'
        }} />
        <style>{`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
        <p style={{ fontSize: '0.9rem', fontWeight: 500, color: '#94a3b8' }}>Loading your workspace...</p>
      </div>
    );
  }

  // Welcome Screen for Fresh setup (Zero profiles)
  if (profiles.length === 0) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        backgroundColor: 'var(--bg-canvas)',
        padding: '2rem'
      }}>
        <div className="card text-center animate-fade-in" style={{
          maxWidth: '520px',
          width: '100%',
          padding: '3rem',
          textAlign: 'center',
          boxShadow: 'var(--shadow-lg)'
        }}>
          <div style={{
            width: '64px',
            height: '64px',
            borderRadius: '16px',
            background: 'rgba(37,99,235,0.1)',
            color: 'var(--accent-primary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 1.5rem auto'
          }}>
            <Building size={32} />
          </div>
          
          <h2 style={{ fontSize: '1.75rem', marginBottom: '0.75rem', fontWeight: 700 }}>
            Set Up Your Business
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '2rem', lineHeight: '1.6' }}>
            Welcome! To generate quotations, work orders, and invoices, please create your first company profile.
          </p>

          <form onSubmit={handleAddProfile} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', textAlign: 'left' }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label" htmlFor="w-name">Company / Business Name *</label>
              <input
                id="w-name"
                type="text"
                required
                placeholder="e.g. Acme Software Solutions"
                value={newProfileName}
                onChange={(e) => setNewProfileName(e.target.value)}
              />
            </div>

            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label" htmlFor="w-currency">Billing Currency</label>
              <select
                id="w-currency"
                value={newProfileCurrency}
                onChange={(e) => setNewProfileCurrency(e.target.value)}
              >
                <option value="INR">INR (₹) - Indian Rupee</option>
                <option value="USD">USD ($) - US Dollar</option>
              </select>
            </div>

            <button type="submit" className="btn-primary" style={{ width: '100%', padding: '0.75rem', marginTop: '0.5rem' }}>
              Create Company Profile
            </button>
          </form>

          {isSupabaseConfigured() && (
            <div style={{
              marginTop: '1.5rem',
              padding: '1rem',
              borderRadius: 'var(--radius-sm)',
              background: 'rgba(37, 99, 235, 0.05)',
              border: '1px solid rgba(37, 99, 235, 0.2)',
              fontSize: '0.8rem',
              color: 'var(--text-secondary)',
              textAlign: 'left'
            }}>
              <p style={{ marginBottom: '0.5rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                Database Setup Required (Supabase Cloud)
              </p>
              <p style={{ marginBottom: '0.75rem', lineHeight: '1.4' }}>
                Before creating your first profile, please copy this SQL Setup script and run it inside your Supabase project's SQL Editor to initialize the tables.
              </p>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  navigator.clipboard.writeText(SQL_SCHEMA);
                  alert('SQL database schema copied to clipboard! Paste and Run it in your Supabase SQL Editor.');
                }}
                style={{ width: '100%', padding: '0.4rem', fontSize: '0.75rem' }}
              >
                Copy SQL Setup Schema
              </button>
            </div>
          )}

          {/* Simple toggle theme button for welcome screen */}
          <button
            onClick={toggleTheme}
            className="btn-secondary"
            style={{ marginTop: '1.5rem', width: '100%', padding: '0.5rem', border: 'none', background: 'transparent' }}
          >
            {theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      <style>{`
        @keyframes slideIn {
          from { transform: translateY(100px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>

      {toast && (
        <div style={{
          position: 'fixed',
          bottom: '20px',
          right: '20px',
          backgroundColor: 'var(--bg-card)',
          border: '1px solid var(--border-color)',
          borderLeft: toast.type === 'success' ? '4px solid #22c55e' : '4px solid var(--accent-orange, #f97316)',
          color: 'var(--text-primary)',
          padding: '1rem',
          borderRadius: 'var(--radius-md, 8px)',
          boxShadow: 'var(--shadow-lg, 0 10px 15px -3px rgba(0, 0, 0, 0.3))',
          zIndex: 99999,
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          animation: 'slideIn 0.3s ease forwards',
          maxWidth: '350px'
        }}>
          <span style={{ fontSize: '1.25rem' }}>{toast.type === 'success' ? '🎉' : '🔔'}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>
              {toast.type === 'success' ? 'Document Approved' : 'Awaiting Approval'}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.15rem', lineHeight: '1.3' }}>{toast.message}</div>
          </div>
          <button 
            onClick={() => setToast(null)} 
            style={{ 
              background: 'transparent', 
              border: 'none', 
              color: 'var(--text-secondary)', 
              cursor: 'pointer',
              fontSize: '0.9rem',
              padding: '0.2rem'
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Saturday 5:00 PM Backup Reminder Banner */}
      {showSaturdayBackupReminder && (
        <div style={{
          position: 'fixed',
          bottom: '24px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 999999,
          width: '90%',
          maxWidth: '580px',
          background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
          border: '2px solid #2563eb',
          borderRadius: '12px',
          padding: '1.25rem',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(37, 99, 235, 0.3)',
          color: '#ffffff',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem',
          animation: 'slideIn 0.3s ease forwards'
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
            <div style={{
              background: 'rgba(16, 185, 129, 0.2)',
              padding: '0.6rem',
              borderRadius: '10px',
              color: '#34d399',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}>
              <Cloud size={24} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: '1.05rem', color: '#ffffff', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span>📅 Saturday Backup Reminder (5:00 PM)</span>
              </div>
              <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.85rem', color: '#cbd5e1', lineHeight: '1.4' }}>
                It's Saturday 5:00 PM! Back up your weekly documents to Google Drive (<strong>info.b2pinternational@gmail.com</strong>) or download a local ZIP file.
              </p>
            </div>
            <button 
              onClick={handleDismissSaturdayReminder}
              style={{
                background: 'none',
                border: 'none',
                color: '#94a3b8',
                cursor: 'pointer',
                padding: '0.2rem',
                fontSize: '1.1rem',
                lineHeight: 1
              }}
              title="Dismiss for today"
            >
              ✕
            </button>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', flexWrap: 'wrap', marginTop: '0.25rem' }}>
            <button
              onClick={handleDismissSaturdayReminder}
              className="btn-secondary"
              style={{
                fontSize: '0.8rem',
                padding: '0.45rem 0.75rem',
                background: 'rgba(255,255,255,0.1)',
                color: '#e2e8f0',
                border: '1px solid rgba(255,255,255,0.2)'
              }}
            >
              Remind Me Later
            </button>

            <button
              onClick={async () => {
                await dbService.downloadFullBackupFile();
                handleDismissSaturdayReminder();
              }}
              className="btn-secondary"
              style={{
                fontSize: '0.8rem',
                padding: '0.45rem 0.85rem',
                background: 'rgba(255,255,255,0.15)',
                color: '#ffffff',
                border: '1px solid rgba(255,255,255,0.3)',
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem'
              }}
            >
              <Download size={14} />
              <span>Download ZIP</span>
            </button>

            <button
              onClick={async () => {
                if (activeProfile?.google_sheets_url) {
                  const res = await dbService.syncBackupToGoogleDrive(activeProfile.google_sheets_url);
                  if (res.success) {
                    alert('Weekly backup successfully saved to info.b2pinternational@gmail.com Google Drive ("B2P Document Backups" folder)!');
                    handleDismissSaturdayReminder();
                  } else {
                    alert('Failed to sync to Google Drive: ' + (res.error || 'Unknown error.'));
                  }
                } else {
                  alert('Google Drive / Sheets URL is not configured. Downloading local ZIP backup instead.');
                  await dbService.downloadFullBackupFile();
                  handleDismissSaturdayReminder();
                }
              }}
              className="btn-primary"
              style={{
                fontSize: '0.8rem',
                padding: '0.45rem 1rem',
                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                color: '#ffffff',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                border: 'none'
              }}
            >
              <Cloud size={14} />
              <span>Backup to Google Drive</span>
            </button>
          </div>
        </div>
      )}
      
      {/* Mobile top-bar header */}
      <header className="mobile-header">
        <button 
          onClick={() => setMobileMenuOpen(true)}
          className="btn-secondary"
          style={{ padding: '0.5rem', borderRadius: 'var(--radius-sm)' }}
          title="Open Menu"
        >
          <Menu size={20} />
        </button>
        <span style={{ fontWeight: 700, fontSize: '0.95rem', letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: '0.5rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {activeProfile?.name || 'Document Gen'}
        </span>
        <button
          onClick={toggleTheme}
          className="btn-secondary"
          style={{ padding: '0.5rem', borderRadius: 'var(--radius-sm)', border: 'none', background: 'transparent' }}
          title="Theme Toggle"
        >
          {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
        </button>
      </header>

      {/* Backdrop overlay for mobile menu */}
      {mobileMenuOpen && (
        <div className="sidebar-overlay" onClick={() => setMobileMenuOpen(false)} />
      )}

      {/* Navigation Sidebar */}
      <Sidebar 
        currentTab={currentTab}
        setCurrentTab={(tab) => {
          setCurrentTab(tab);
          setMobileMenuOpen(false);
        }}
        profiles={profiles}
        activeProfile={activeProfile}
        setActiveProfile={(prof) => {
          setActiveProfile(prof);
          localStorage.setItem('docgen_active_profile_id', prof.id);
          // Manual profile switch is the one case where activeProfile
          // changes outside of loadData(), so it must trigger the
          // shared loader itself now that the [activeProfile] effect
          // has been removed (see note above loadData's definition).
          refreshCompanyData(prof.id);
        }}
        onAddProfileClick={() => setShowAddProfileModal(true)}
        theme={theme}
        toggleTheme={toggleTheme}
        user={user}
        onLogout={handleLogout}
        isOpen={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
      />

      {/* Main Content viewport */}
      <main className="main-content">
        
        {recoverableDrafts.length > 0 && !editorOpen && !previewOpen && (
          <div className="draft-banner-list" style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
            margin: '0 0 1rem 0'
          }}>
            {recoverableDrafts.length > 1 && (
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
                You have {recoverableDrafts.length} unsaved document drafts:
              </span>
            )}
            {recoverableDrafts.map(draft => (
              <div key={draft.draftKey} className="draft-banner" style={{
                background: 'var(--accent-primary)',
                color: '#fff',
                padding: '0.85rem 1.25rem',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '0.75rem',
                fontSize: '0.85rem',
                borderRadius: 'var(--radius-sm)',
                boxShadow: 'var(--shadow-sm)',
                border: '1px solid rgba(255,255,255,0.1)'
              }}>
                <span style={{ fontWeight: 500 }}>
                  Unsaved {(draft.docType || 'document').replace('_', ' ')}
                  {draft.customerName ? ` for ${draft.customerName}` : ''}
                  {draft.documentNumber ? ` (${draft.documentNumber})` : ''}
                  {draft.lastSaved && (
                    <span style={{ fontWeight: 400, opacity: 0.85 }}>
                      {' '}— last saved {new Date(draft.lastSaved).toLocaleString()}
                    </span>
                  )}
                </span>
                <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                  <button
                    onClick={() => handleRestoreDraft(draft)}
                    className="btn-primary"
                    style={{
                      background: '#fff',
                      color: 'var(--accent-primary)',
                      border: 'none',
                      padding: '0.35rem 0.75rem',
                      borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer',
                      fontWeight: 700,
                      fontSize: '0.75rem'
                    }}
                  >
                    Resume
                  </button>
                  <button
                    onClick={() => {
                      if (!confirm('Discard this draft? This cannot be undone.')) return;
                      handleDiscardDraftEntry(draft.draftKey);
                    }}
                    className="btn-secondary"
                    style={{
                      background: 'rgba(255,255,255,0.15)',
                      color: '#fff',
                      border: '1px solid rgba(255,255,255,0.25)',
                      padding: '0.35rem 0.75rem',
                      borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer',
                      fontWeight: 500,
                      fontSize: '0.75rem'
                    }}
                  >
                    Discard
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {previewOpen && documentToPreview ? (
          documentToPreview.document_type === 'comparison_quotation' || documentToPreview.document_type === 'comparison_invoice' ? (
            <ComparisonPreview
              activeProfile={profiles.find(p => p.id === documentToPreview.company_id) || activeProfile!}
              document={documentToPreview}
              onClose={() => setPreviewOpen(false)}
            />
          ) : (
            <DocumentPreview 
              activeProfile={profiles.find(p => p.id === documentToPreview.company_id) || activeProfile!}
              document={documentToPreview}
              onClose={() => setPreviewOpen(false)}
            />
          )
        ) : (
          /* Normal Tab routing rendering */
          <>
             {currentTab === 'dashboard' && (
              <Dashboard 
                role={user?.user_metadata?.role || 'admin'}
                activeProfile={activeProfile}
                profiles={profiles}
                documents={documents}
                onEditDocument={handleEditDocument}
                onViewDocument={handleViewDocument}
                onDeleteDocument={handleDeleteDocument}
                setCurrentTab={setCurrentTab}
              />
            )}
            
            {editorOpen && (
              <div style={{ display: currentTab === 'documents' ? 'block' : 'none' }}>
                {documentToEdit?.document_type === 'comparison_quotation' || documentToEdit?.document_type === 'comparison_invoice' || comparisonEditorActive ? (
                  <ComparisonEditor
                    activeProfile={activeProfile!}
                    customers={customers}
                    documents={documents}
                    documentToEdit={documentToEdit}
                    documentType={documentToEdit ? (documentToEdit.document_type as any) : comparisonEditorType}
                    onClose={handleCloseEditor}
                    onSaveSuccess={() => {
                      handleCloseEditor();
                      if (activeProfile) {
                        dbService.getDocuments(activeProfile.id).then(setDocuments);
                      }
                    }}
                  />
                ) : (
                  <DocumentEditor 
                    activeProfile={activeProfile}
                    documentToEdit={documentToEdit}
                    onClose={handleCloseEditor}
                    onRefreshDocs={() => {
                      if (activeProfile) dbService.getDocuments(activeProfile.id).then(setDocuments);
                    }}
                    draftToRestore={draftToRestore}
                  />
                )}
              </div>
            )}

            {currentTab === 'documents' && !editorOpen && (
              <Documents 
                role={user?.user_metadata?.role || 'admin'}
                activeProfile={activeProfile}
                documents={documents}
                syncQueue={syncQueue}
                onAddDocument={handleCreateDocument}
                onAddComparison={handleCreateComparison}
                onEditDocument={handleEditDocument}
                onViewDocument={handleViewDocument}
                onDeleteDocument={handleDeleteDocument}
                onRefreshDocs={() => loadData(activeProfile?.id)}
              />
            )}

            {currentTab === 'sync-dashboard' && (
              <GoogleSyncDashboard
                role={user?.user_metadata?.role || 'admin'}
                activeProfile={activeProfile}
                syncQueue={syncQueue}
                onRefreshQueue={() => activeProfile && getQueueStatusForCompany(activeProfile.id).then(setSyncQueue)}
              />
            )}

            {currentTab === 'customers' && (
              <Customers 
                role={user?.user_metadata?.role || 'admin'}
                activeProfile={activeProfile}
                onRefreshStats={() => loadData(activeProfile?.id)}
                preloadedCustomers={customers}
                onRefreshCustomers={() => {
                  if (activeProfile) dbService.getCustomers(activeProfile.id).then(setCustomers);
                }}
              />
            )}

            {currentTab === 'services' && (
              <Services 
                role={user?.user_metadata?.role || 'admin'}
                activeProfile={activeProfile}
                onRefreshStats={() => loadData(activeProfile?.id)}
                preloadedServices={services}
                onRefreshServices={() => {
                  if (activeProfile) {
                    dbService.getServices(activeProfile.id).then(setServices);
                  } else {
                    dbService.getServices().then(setServices);
                  }
                }}
              />
            )}

            {currentTab === 'settings' && (
              <Settings 
                role={user?.user_metadata?.role || 'admin'}
                profiles={profiles}
                activeProfile={activeProfile}
                onRefreshProfiles={loadData}
                user={user}
                onTestSaturdayReminder={() => setShowSaturdayBackupReminder(true)}
              />
            )}
          </>
        )}
      </main>

      {/* Add Profile modal triggered from Sidebar */}
      {showAddProfileModal && (
        <div className="modal-overlay">
          <div className="modal-content animate-fade-in">
            <h3 style={{ fontSize: '1.25rem', marginBottom: '1.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem' }}>
              Add Company Profile
            </h3>
            <form onSubmit={handleAddProfile} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div className="form-group">
                <label className="form-label" htmlFor="m-name">Company Name *</label>
                <input
                  id="m-name"
                  type="text"
                  required
                  placeholder="e.g. Acme Services Ltd"
                  value={newProfileName}
                  onChange={(e) => setNewProfileName(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="m-curr">Billing Currency</label>
                <select
                  id="m-curr"
                  value={newProfileCurrency}
                  onChange={(e) => setNewProfileCurrency(e.target.value)}
                >
                  <option value="INR">INR (₹) - Indian Rupee</option>
                  <option value="USD">USD ($) - US Dollar</option>
                </select>
              </div>

              <div className="btn-row" style={{ marginTop: '1rem' }}>
                <button type="button" onClick={() => setShowAddProfileModal(false)} className="btn-secondary">
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  Create Profile
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Password Reset Modal triggered on recovery link landing */}
      {showPasswordResetModal && (
        <div className="modal-overlay" style={{ zIndex: 1000 }}>
          <div className="modal-content animate-fade-in" style={{ maxWidth: '400px' }}>
            <h3 style={{ fontSize: '1.25rem', marginBottom: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem' }}>
              Update Password
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
              Your email recovery link has been verified. Please enter a new password below to update your account.
            </p>
            <form onSubmit={handlePasswordReset} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div className="form-group">
                <label className="form-label" htmlFor="new-password">New Password</label>
                <input
                  id="new-password"
                  type="password"
                  required
                  placeholder="Minimum 6 characters"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>
              <div className="btn-row" style={{ marginTop: '1rem' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowPasswordResetModal(false)}
                  disabled={resetLoading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={resetLoading}
                >
                  {resetLoading ? 'Saving...' : 'Update Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}

export default App;
