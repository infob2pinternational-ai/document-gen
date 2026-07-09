import React, { useState, useEffect } from 'react';
import type { CompanyProfile, Document, Customer, Service } from './types';
import { dbService, isSupabaseConfigured, supabase, SQL_SCHEMA } from './services/db';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { Documents } from './components/Documents';
import { Customers } from './components/Customers';
import { Services } from './components/Services';
import { Settings } from './components/Settings';
import { DocumentEditor } from './components/DocumentEditor';
import { DocumentPreview } from './components/DocumentPreview';
import { AuthPanel } from './components/AuthPanel';
import { Building, Menu, Moon, Sun } from 'lucide-react';

function App() {
  const [currentTab, setCurrentTab] = useState<string>('dashboard');
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  
  // Profiles & Loading States
  const [profiles, setProfiles] = useState<CompanyProfile[]>([]);
  const [activeProfile, setActiveProfile] = useState<CompanyProfile | null>(null);
  const [profilesLoading, setProfilesLoading] = useState(true);
  
  // Data States (Preloaded to prevent tab switching lag)
  const [documents, setDocuments] = useState<Document[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  
  // Sub-views
  const [editorOpen, setEditorOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [documentToEdit, setDocumentToEdit] = useState<Document | null>(null);
  const [documentToPreview, setDocumentToPreview] = useState<Document | null>(null);
  const [hasDraft, setHasDraft] = useState(false);
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

  // Public View States
  const [publicViewDocId, setPublicViewDocId] = useState<string | null>(null);
  const [publicViewDoc, setPublicViewDoc] = useState<Document | null>(null);
  const [publicViewLoading, setPublicViewLoading] = useState(false);

  // Initialize Theme
  useEffect(() => {
    const savedTheme = localStorage.getItem('docgen_theme') as 'light' | 'dark' | null;
    const initialTheme = savedTheme || 'dark';
    setTheme(initialTheme);
    document.documentElement.setAttribute('data-theme', initialTheme);
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
    
    if (viewId) {
      console.log('App: Public view detected for ID:', viewId);
      setPublicViewDocId(viewId);
      setPublicViewLoading(true);
      dbService.getDocumentById(viewId).then((res) => {
        if (res) {
          console.log('App: Public view document loaded successfully by ID:', res.document);
          setPublicViewDoc(res.document);
        } else {
          console.log('App: Public view document not found');
        }
        setPublicViewLoading(false);
      }).catch((err) => {
        console.error('App: Error loading public view document by ID:', err);
        setPublicViewLoading(false);
      });
    } else if (docNumber) {
      console.log('App: Public view detected for Document Number:', docNumber);
      setPublicViewLoading(true);
      dbService.getDocumentByNumber(docNumber).then((res) => {
        if (res) {
          console.log('App: Public view document loaded successfully by Number:', res.document);
          setPublicViewDocId(res.document.id);
          setPublicViewDoc(res.document);
        } else {
          console.log('App: Public view document not found by Number');
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

  // Load Company Profiles, Documents, Customers, and Services in parallel
  const loadData = async (selectNewId?: string) => {
    setProfilesLoading(true);
    try {
      const rawProfiles = await dbService.getProfiles();
      const profileList = rawProfiles.map(p => {
        if (p.name.toLowerCase().includes('b2p')) {
          return { ...p, logo_url: '/logo_b2p.png' };
        }
        return p;
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
        
        // Fetch docs, customers, and services in parallel to avoid load lag
        const [docs, custs, servs] = await Promise.all([
          dbService.getDocuments(active.id),
          dbService.getCustomers(active.id),
          dbService.getServices(active.id)
        ]);
        setDocuments(docs);
        setCustomers(custs);
        setServices(servs);
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

  // Check for unsaved drafts on startup
  useEffect(() => {
    const draft = localStorage.getItem('docgen_draft_document');
    if (draft) {
      setHasDraft(true);
    }
  }, []);

  const handleRestoreDraft = () => {
    const draftStr = localStorage.getItem('docgen_draft_document');
    if (draftStr) {
      try {
        const draft = JSON.parse(draftStr);
        setDraftToRestore(draft);
        setDocumentToEdit(draft.documentToEdit || null);
        setCurrentTab('documents');
        setEditorOpen(true);
      } catch (err) {
        console.error('Failed to parse draft:', err);
      }
    }
    setHasDraft(false);
  };

  const handleDiscardDraft = () => {
    localStorage.removeItem('docgen_draft_document');
    setHasDraft(false);
    setDraftToRestore(null);
  };

  const handleCloseEditor = () => {
    setEditorOpen(false);
    setDraftToRestore(null);
    setTimeout(() => {
      localStorage.removeItem('docgen_draft_document');
      setHasDraft(false);
    }, 100);
  };

  // Load documents, customers, and services when active company profile switches
  useEffect(() => {
    if (activeProfile) {
      Promise.all([
        dbService.getDocuments(activeProfile.id),
        dbService.getCustomers(activeProfile.id),
        dbService.getServices(activeProfile.id)
      ]).then(([docs, custs, servs]) => {
        setDocuments(docs);
        setCustomers(custs);
        setServices(servs);
      });
    }
  }, [activeProfile]);

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

  const handleViewDocument = (doc: Document) => {
    setDocumentToPreview(doc);
    setPreviewOpen(true);
  };

  const handleDeleteDocument = async (id: string) => {
    const docToDelete = documents.find(d => d.id === id);
    try {
      // Trigger Google Sheets auto-delete notification
      if (activeProfile && activeProfile.google_sheets_url && docToDelete?.document_number) {
        const deletePayload = {
          action: 'delete',
          document_number: docToDelete.document_number
        };
        fetch(activeProfile.google_sheets_url, {
          method: 'POST',
          mode: 'no-cors',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(deletePayload)
        }).catch(err => console.error('Failed to notify Google Sheet of deletion:', err));
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
        
        {hasDraft && !editorOpen && !previewOpen && (
          <div style={{
            background: 'var(--accent-primary)',
            color: '#fff',
            padding: '0.85rem 1.25rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '0.85rem',
            borderRadius: 'var(--radius-sm)',
            margin: '0 0 1rem 0',
            boxShadow: 'var(--shadow-sm)',
            border: '1px solid rgba(255,255,255,0.1)'
          }}>
            <span style={{ fontWeight: 500 }}>You have an unsaved document draft from your last session.</span>
            <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
              <button 
                onClick={handleRestoreDraft}
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
                onClick={handleDiscardDraft}
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
        )}

        {previewOpen && documentToPreview ? (
          /* Preview Screen view (Global Overlay) */
          <DocumentPreview 
            activeProfile={profiles.find(p => p.id === documentToPreview.company_id) || activeProfile!}
            document={documentToPreview}
            onClose={() => setPreviewOpen(false)}
          />
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
                <DocumentEditor 
                  activeProfile={activeProfile}
                  documentToEdit={documentToEdit}
                  onClose={handleCloseEditor}
                  onRefreshDocs={() => {
                    if (activeProfile) dbService.getDocuments(activeProfile.id).then(setDocuments);
                  }}
                  draftToRestore={draftToRestore}
                />
              </div>
            )}

            {currentTab === 'documents' && !editorOpen && (
              <Documents 
                role={user?.user_metadata?.role || 'admin'}
                activeProfile={activeProfile}
                documents={documents}
                onAddDocument={handleCreateDocument}
                onEditDocument={handleEditDocument}
                onViewDocument={handleViewDocument}
                onDeleteDocument={handleDeleteDocument}
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
                  if (activeProfile) dbService.getServices(activeProfile.id).then(setServices);
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

              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
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
              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
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
