import React, { useState, useEffect } from 'react';
import type { CompanyProfile, Document, Customer, Service } from '../types';
import { dbService, supabase, isSupabaseConfigured } from '../services/db';
import { Login } from './screens/Login';
import { Home } from './screens/Home';
import { DocumentsList } from './screens/DocumentsList';
import { DocumentView } from './screens/DocumentView';
import { CustomersScreen } from './screens/CustomersScreen';
import { ServicesScreen } from './screens/ServicesScreen';
import { BottomNav } from './components/BottomNav';

type OwnerTab = 'home' | 'pending' | 'documents' | 'customers' | 'services';

/**
 * Owner-only mobile shell (Capacitor). Deliberately NOT the staff web
 * app's App.tsx - this is a new, simplified UI purpose-built for the
 * owner's approval workflow. It reuses the exact same service layer as
 * the web app (dbService, supabase auth, RLS, calculations, WhatsApp
 * share) - no business logic is duplicated, only the presentation is
 * new. See conversation for the architecture decision.
 */
export const OwnerApp: React.FC = () => {
  const [user, setUser] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [activeProfile, setActiveProfile] = useState<CompanyProfile | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [dataLoading, setDataLoading] = useState(false);

  const [tab, setTab] = useState<OwnerTab>('home');
  const [viewingDoc, setViewingDoc] = useState<Document | null>(null);

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

  // Data loading - reuses dbService exactly as the web app does.
  const loadOwnerData = async () => {
    setDataLoading(true);
    try {
      const rawProfiles = await dbService.getProfiles();
      if (rawProfiles.length === 0) {
        setActiveProfile(null);
        setDataLoading(false);
        return;
      }
      const savedId = localStorage.getItem('docgen_active_profile_id');
      const profile = rawProfiles.find(p => p.id === savedId) || rawProfiles[0];
      setActiveProfile(profile);

      const [docs, custs, servs] = await Promise.all([
        dbService.getDocuments(profile.id),
        dbService.getCustomers(profile.id),
        dbService.getServices(profile.id)
      ]);
      setDocuments(docs);
      setCustomers(custs);
      setServices(servs);
    } finally {
      setDataLoading(false);
    }
  };

  useEffect(() => {
    if (user) loadOwnerData();
  }, [user]);

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

  if (viewingDoc) {
    return (
      <DocumentView
        document={viewingDoc}
        activeProfile={activeProfile}
        onClose={() => setViewingDoc(null)}
      />
    );
  }

  return (
    <div className="owner-shell">
      <div className="owner-screen">
        {tab === 'home' && (
          <Home
            userName={user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Owner'}
            documents={documents}
            loading={dataLoading}
            onViewDocument={handleViewDocument}
            onGoToPending={() => setTab('pending')}
          />
        )}
        {tab === 'pending' && (
          <DocumentsList
            title="Pending Approval"
            documents={documents.filter(d => d.status === 'pending_approval' || !d.status)}
            loading={dataLoading}
            onViewDocument={handleViewDocument}
          />
        )}
        {tab === 'documents' && (
          <DocumentsList
            title="Documents"
            documents={documents}
            loading={dataLoading}
            onViewDocument={handleViewDocument}
            showFilters
          />
        )}
        {tab === 'customers' && (
          <CustomersScreen
            activeProfile={activeProfile}
            customers={customers}
            onRefresh={loadOwnerData}
          />
        )}
        {tab === 'services' && (
          <ServicesScreen
            activeProfile={activeProfile}
            services={services}
            onRefresh={loadOwnerData}
          />
        )}
      </div>
      <BottomNav currentTab={tab} onChangeTab={setTab} />
    </div>
  );
};
