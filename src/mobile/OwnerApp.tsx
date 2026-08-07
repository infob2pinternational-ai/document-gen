import React, { useState, useEffect } from 'react';
import type { CompanyProfile, Document, Customer, Service } from '../types';
import { dbService, supabase, isSupabaseConfigured } from '../services/db';
import { Login } from './screens/Login';
import { Home } from './screens/Home';
import { DocumentsList } from './screens/DocumentsList';
import { DocumentView } from './screens/DocumentView';
import { DocumentEdit } from './screens/DocumentEdit';
import { CustomersScreen } from './screens/CustomersScreen';
import { ServicesScreen } from './screens/ServicesScreen';
import { BottomNav, type OwnerTab } from './components/BottomNav';
import { PullToRefresh } from './components/PullToRefresh';
import { ProfileSwitcher } from './components/ProfileSwitcher';
import { setupPushNotifications } from './push';
import { getRoleModules, canAccessModule, roleLabel } from './roles';
import { LogOut } from 'lucide-react';

const MODULE_TO_TAB: Record<string, OwnerTab> = {
  dashboard: 'home',
  pending_approval: 'pending',
  documents: 'documents',
  customers: 'customers',
  services: 'services'
};

/**
 * B2P ONE mobile shell (Capacitor). Deliberately NOT the staff web app's
 * App.tsx - this is a new, simplified UI. It reuses the exact same
 * service layer as the web app (dbService, supabase auth, RLS,
 * calculations, WhatsApp share, DocumentEditor) - no business logic is
 * duplicated, only the presentation is new.
 *
 * One app for every employee (Phase 8, section 3): which tabs/actions
 * are visible is driven entirely by roles.ts's role -> module mapping,
 * read from the same user.user_metadata.role field the desktop app
 * already uses for its own (simpler) admin/non-admin gating - not a
 * separate permission system, not a separate app per role.
 */
export const OwnerApp: React.FC = () => {
  const [user, setUser] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [profiles, setProfiles] = useState<CompanyProfile[]>([]);
  const [activeProfile, setActiveProfile] = useState<CompanyProfile | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [dataLoading, setDataLoading] = useState(false);

  const [tab, setTab] = useState<OwnerTab>('home');
  const [viewingDoc, setViewingDoc] = useState<Document | null>(null);
  const [editingDoc, setEditingDoc] = useState<Document | null>(null);

  // Same approver gating rule as the desktop app's Documents.tsx: if the
  // company profile has a designated approver_email, only that email can
  // approve/reject - anyone else viewing the document (e.g. office staff
  // who also have login access) sees it read-only. No approver_email
  // configured means any authenticated user can approve, same as desktop.
  // Layered on top of the role check - a role must have the
  // pending_approval module AND (if set) be the designated approver.
  // Defined once here (not inline at each call site - the push-setup
  // effect below needs the same value, and hooks must run before this
  // component's early returns, so it can't wait until after them).
  const isDesignatedApprover = (profile: CompanyProfile | null, currentUser: any): boolean =>
    canAccessModule(currentUser?.user_metadata?.role, 'pending_approval') && (
      !profile?.approver_email ||
      (currentUser?.email || '').toLowerCase() === profile.approver_email.toLowerCase()
    );

  // Auth session (reuses the same Supabase auth as the web app - same
  // account, same session mechanism, no separate login system).
  //
  // dbService's useCloud() helper (shared - not duplicated here) gates
  // every single Supabase read/write on the presence of the
  // `supabase_user` localStorage key, not on the live Supabase session
  // itself (see db.ts). The web app's App.tsx writes that key from
  // inside its own auth effect; this shell has its own independent auth
  // effect and was never writing it. Login still succeeded (that's a
  // direct supabase.auth call, unaffected by useCloud()), but every
  // dbService.getX() call afterwards silently fell through to
  // useCloud()'s empty-localStorage fallback instead of ever reaching
  // Supabase - which is why Home/Documents/Customers/Services all
  // rendered empty despite a working session and correct RLS. Mirroring
  // the same write here (not touching db.ts, which is shared with the
  // web app) is the fix.
  useEffect(() => {
    if (!isSupabaseConfigured() || !supabase) {
      setAuthLoading(false);
      return;
    }
    const syncCloudFlag = (session: { user: any } | null | undefined) => {
      if (session?.user) {
        localStorage.setItem('supabase_user', JSON.stringify(session.user));
      } else {
        localStorage.removeItem('supabase_user');
      }
    };
    supabase.auth.getSession().then(({ data }) => {
      syncCloudFlag(data.session);
      setUser(data.session?.user ?? null);
      setAuthLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      syncCloudFlag(session);
      setUser(session?.user ?? null);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  // Same two-function split as the desktop app's App.tsx
  // (refreshCompanyData() / loadData()): refreshCompanyData() re-fetches
  // just the current company's documents/customers/services - used for
  // every refresh that doesn't need to re-resolve which company is
  // active (saves, deletes, pull-to-refresh, a manual profile switch).
  // loadOwnerData() is only for startup: it also fetches the full
  // profiles list and resolves which one should be active.
  const refreshCompanyData = async (profileId: string) => {
    const [docs, custs, servs] = await Promise.all([
      dbService.getDocuments(profileId),
      dbService.getCustomers(profileId),
      dbService.getServices(profileId)
    ]);
    setDocuments(docs);
    setCustomers(custs);
    setServices(servs);
  };

  // Convenience wrapper for the many "just refresh whatever's currently
  // active" call sites below (saves, deletes, pull-to-refresh) - a no-op
  // if activeProfile isn't set yet, which shouldn't happen once past the
  // initial load but guards against a stray call during it.
  const refreshActiveCompanyData = async () => {
    if (activeProfile) await refreshCompanyData(activeProfile.id);
  };

  const loadOwnerData = async () => {
    setDataLoading(true);
    try {
      const rawProfiles = await dbService.getProfiles();
      setProfiles(rawProfiles);
      if (rawProfiles.length === 0) {
        setActiveProfile(null);
        return;
      }
      const savedId = localStorage.getItem('docgen_active_profile_id');
      const profile = rawProfiles.find(p => p.id === savedId) || rawProfiles[0];
      setActiveProfile(profile);
      await refreshCompanyData(profile.id);
    } finally {
      setDataLoading(false);
    }
  };

  // Same profile-switch contract as the desktop Sidebar's
  // setActiveProfile prop: update state, persist the same
  // docgen_active_profile_id key so reopening the app restores it, then
  // refresh this company's data - not a full reload (matches desktop's
  // manual-switch behavior exactly, not a redesign).
  const handleSwitchProfile = (profile: CompanyProfile) => {
    setActiveProfile(profile);
    localStorage.setItem('docgen_active_profile_id', profile.id);
    refreshCompanyData(profile.id);
  };

  useEffect(() => {
    if (user) loadOwnerData();
  }, [user]);

  // Phase 5: native push registration + tap-to-deep-link, once we know
  // which company profile to register the device token against.
  // setupPushNotifications() is a no-op on non-native platforms (web
  // preview) and only actually runs its setup once per app session.
  //
  // Gated to the designated approver only (isDesignatedApprover above) -
  // see push.ts's file-level comment: approver_devices has exactly one
  // device slot per company, so registering for every employee would
  // let anyone's device steal the real approver's notifications.
  useEffect(() => {
    if (!activeProfile) return;
    setupPushNotifications(activeProfile, isDesignatedApprover(activeProfile, user), (documentId) => {
      dbService.getDocumentById(documentId)
        .then(res => {
          if (res?.document) {
            setViewingDoc(res.document);
            setEditingDoc(null);
          }
        })
        .catch(err => console.error('[Mobile Push] Failed to open deep-linked document:', err));
    });
  }, [activeProfile, user]);

  // Realtime - same merge pattern as the web app, scoped to the active
  // company, so approvals/edits made from the web app (or another
  // device) appear here live too.
  useEffect(() => {
    if (!supabase || !activeProfile) return;
    const channel = supabase
      .channel(`owner-mobile-${activeProfile.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'documents' },
        (payload) => {
          const newDoc = payload.new as any;
          const oldDoc = payload.old as any;
          const target = newDoc || oldDoc;
          if (!target || target.company_id !== activeProfile.id) return;

          setDocuments(prev => {
            if (payload.eventType === 'DELETE') {
              return prev.filter(d => d.id !== target.id);
            }
            const idx = prev.findIndex(d => d.id === newDoc.id);
            if (idx >= 0) {
              const updated = [...prev];
              updated[idx] = newDoc;
              return updated;
            }
            return [...prev, newDoc];
          });
        }
      )
      .subscribe();
    return () => { supabase?.removeChannel(channel); };
  }, [activeProfile]);

  if (authLoading) {
    return <div className="owner-shell" style={{ alignItems: 'center', justifyContent: 'center' }}>Loading...</div>;
  }

  if (!user) {
    return <Login onLoggedIn={() => { /* handled by onAuthStateChange */ }} />;
  }

  const handleViewDocument = (doc: Document) => {
    setViewingDoc(doc);
  };

  // roles.ts's module map, keyed off the same user_metadata.role field
  // the desktop app already reads - see roles.ts for the full rationale.
  const role = user?.user_metadata?.role;
  const allowedModules = getRoleModules(role);
  const allowedTabs = allowedModules
    .map(m => MODULE_TO_TAB[m])
    .filter((t): t is OwnerTab => Boolean(t));
  // Fall back to the first tab this role actually has if the current
  // `tab` state isn't one of them (e.g. role changed, or 'home' - the
  // initial state - isn't in this role's allowed set).
  const effectiveTab: OwnerTab | undefined = allowedTabs.includes(tab) ? tab : allowedTabs[0];

  const canEdit = canAccessModule(role, 'edit_documents');

  const handleEditDocument = (doc: Document) => {
    if (!canEdit) return;
    setViewingDoc(null);
    setEditingDoc(doc);
  };

  const handleLogout = async () => {
    // Exact same sign-out sequence as the desktop app's App.tsx
    // handleLogout - not a separate logout implementation.
    if (supabase) {
      await supabase.auth.signOut();
    }
    localStorage.removeItem('supabase_user');
    setUser(null);
    setProfiles([]);
    setActiveProfile(null);
    setDocuments([]);
    setCustomers([]);
    setServices([]);
  };

  const canApprove = isDesignatedApprover(activeProfile, user);

  // Approve/reject call the exact same dbService methods the desktop
  // app's Documents.tsx uses - no separate approval logic here.
  const handleApprove = async (doc: Document) => {
    await dbService.approveDocument(doc.id, user?.email || 'System');
    if (activeProfile) await refreshCompanyData(activeProfile.id);
    setViewingDoc(null);
  };

  const handleReject = async (doc: Document) => {
    await dbService.rejectDocument(doc.id, user?.email || 'System');
    if (activeProfile) await refreshCompanyData(activeProfile.id);
    setViewingDoc(null);
  };

  if (editingDoc) {
    return (
      <DocumentEdit
        document={editingDoc}
        activeProfile={activeProfile}
        onClose={() => setEditingDoc(null)}
        onRefreshDocs={refreshActiveCompanyData}
      />
    );
  }

  if (viewingDoc) {
    return (
      <DocumentView
        document={viewingDoc}
        activeProfile={activeProfile}
        canApprove={canApprove}
        canEdit={canEdit}
        onClose={() => setViewingDoc(null)}
        onEdit={handleEditDocument}
        onApprove={handleApprove}
        onReject={handleReject}
      />
    );
  }

  if (!effectiveTab) {
    // No module in this role's allowed set maps to a tab - shouldn't
    // happen with the default roles.ts matrix (every role has at least
    // one), but a role misconfigured to an empty list shouldn't render
    // a blank screen.
    return (
      <div className="owner-shell" style={{ alignItems: 'center', justifyContent: 'center', padding: '2rem', textAlign: 'center' }}>
        <p>No modules are available for your role ({roleLabel(role)}).</p>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Contact your administrator.</p>
        <button onClick={handleLogout} className="btn-secondary" style={{ marginTop: '1rem' }}>Log Out</button>
      </div>
    );
  }

  return (
    <div className="owner-shell">
      <div style={{ padding: '0.6rem 1rem', borderBottom: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <ProfileSwitcher profiles={profiles} activeProfile={activeProfile} onSwitch={handleSwitchProfile} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>{roleLabel(role)}</span>
          <button
            onClick={handleLogout}
            className="btn-secondary"
            style={{ padding: '0.4rem 0.6rem', display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem' }}
            title="Log Out"
          >
            <LogOut size={14} />
            <span>Log Out</span>
          </button>
        </div>
      </div>
      <PullToRefresh onRefresh={refreshActiveCompanyData}>
        {effectiveTab === 'home' && canAccessModule(role, 'dashboard') && (
          <Home
            userName={user?.user_metadata?.full_name || user?.email?.split('@')[0] || ''}
            activeProfile={activeProfile}
            documents={documents}
            customers={customers}
            services={services}
            loading={dataLoading}
            onViewDocument={handleViewDocument}
            onGoToPending={() => setTab('pending')}
          />
        )}
        {effectiveTab === 'pending' && canAccessModule(role, 'pending_approval') && (
          <DocumentsList
            title="Pending Approval"
            documents={documents.filter(d => d.status === 'pending_approval' || !d.status)}
            loading={dataLoading}
            onViewDocument={handleViewDocument}
          />
        )}
        {effectiveTab === 'documents' && canAccessModule(role, 'documents') && (
          <DocumentsList
            title="Documents"
            documents={documents}
            loading={dataLoading}
            onViewDocument={handleViewDocument}
            showFilters
          />
        )}
        {effectiveTab === 'customers' && canAccessModule(role, 'customers') && (
          <CustomersScreen
            activeProfile={activeProfile}
            customers={customers}
            onRefresh={refreshActiveCompanyData}
          />
        )}
        {effectiveTab === 'services' && canAccessModule(role, 'services') && (
          <ServicesScreen
            activeProfile={activeProfile}
            services={services}
            onRefresh={refreshActiveCompanyData}
          />
        )}
      </PullToRefresh>
      <BottomNav currentTab={effectiveTab} onChangeTab={setTab} allowedTabs={allowedTabs} />
    </div>
  );
};
