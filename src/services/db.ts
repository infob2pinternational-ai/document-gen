import type { CompanyProfile, Customer, Service, Document, DocumentItem } from '../types';
import type { ComparisonConfig } from '../components/comparison/ComparisonTypes';
import JSZip from 'jszip';
import { supabase, isSupabaseConfigured } from './supabaseClient';
import { enqueueSync } from './sheetsSyncQueue';

// Re-exported for backward compatibility - every existing call site
// (App.tsx, AuthPanel.tsx, ComparisonService.ts) imports these from
// './db' or '../services/db' and continues to work unchanged. The
// actual client now lives in supabaseClient.ts (Phase B2) so that
// sheetsSyncQueue.ts can import it without creating a circular
// dependency between db.ts and sheetsSyncQueue.ts.
export { supabase, isSupabaseConfigured };

export const SQL_SCHEMA = `DROP TABLE IF EXISTS document_items CASCADE;
DROP TABLE IF EXISTS documents CASCADE;
DROP TABLE IF EXISTS services CASCADE;
DROP TABLE IF EXISTS customers CASCADE;
DROP TABLE IF EXISTS profiles CASCADE;

-- Profiles (Company entities)
CREATE TABLE profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  logo_url TEXT, -- Base64 logo or url
  seal_url TEXT,
  gstin TEXT,
  pan TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  website TEXT,
  currency TEXT DEFAULT 'INR',
  bank_name TEXT,
  bank_account_no TEXT,
  bank_ifsc TEXT,
  bank_holder TEXT,
  bank_branch TEXT,
  default_terms TEXT,
  
  -- Column headings
  col_name_description TEXT DEFAULT 'Description',
  col_name_quantity TEXT DEFAULT 'Quantity',
  col_name_unit TEXT DEFAULT 'Unit',
  col_name_rate TEXT DEFAULT 'Rate',
  col_name_amount TEXT DEFAULT 'Amount',
  
  -- Sequencing settings
  invoice_prefix TEXT DEFAULT 'INV/',
  invoice_start_number INT DEFAULT 1001,
  proforma_prefix TEXT DEFAULT 'PI/',
  proforma_start_number INT DEFAULT 1001,
  quotation_prefix TEXT DEFAULT 'QTN/',
  quotation_start_number INT DEFAULT 1001,
  work_order_prefix TEXT DEFAULT 'WO/',
  work_order_start_number INT DEFAULT 1001,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Customers
CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  gstin TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Services
CREATE TABLE services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  default_rate NUMERIC DEFAULT 0,
  unit TEXT DEFAULT 'nos',
  hsn_sac TEXT,
  gst_percentage NUMERIC DEFAULT 18,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Documents (Invoices, Proforma Invoices, Quotations, Work Orders)
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL CHECK (document_type IN ('invoice', 'proforma_invoice', 'quotation', 'work_order')),
  document_number TEXT NOT NULL,
  sequence_number INT NOT NULL,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL,
  customer_email TEXT,
  customer_phone TEXT,
  customer_address TEXT,
  customer_gstin TEXT,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  
  -- Custom Column Headings
  col_name_description TEXT NOT NULL DEFAULT 'Description',
  col_name_quantity TEXT NOT NULL DEFAULT 'Quantity',
  col_name_unit TEXT NOT NULL DEFAULT 'Unit',
  col_name_rate TEXT NOT NULL DEFAULT 'Rate',
  col_name_amount TEXT NOT NULL DEFAULT 'Amount',
  
  -- Calculations
  subtotal NUMERIC NOT NULL DEFAULT 0,
  tax_total NUMERIC NOT NULL DEFAULT 0,
  discount_total NUMERIC NOT NULL DEFAULT 0,
  total NUMERIC NOT NULL DEFAULT 0,
  advance NUMERIC NOT NULL DEFAULT 0,
  notes TEXT,
  terms TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Document Line Items
CREATE TABLE document_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
  service_id UUID REFERENCES services(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  quantity NUMERIC NOT NULL DEFAULT 1,
  days NUMERIC NOT NULL DEFAULT 1,
  rate NUMERIC NOT NULL DEFAULT 0,
  unit TEXT DEFAULT 'nos',
  hsn_sac TEXT,
  gst_percentage NUMERIC NOT NULL DEFAULT 0,
  amount NUMERIC NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0
);

-- =====================================================================
-- Row Level Security (RLS)
-- Every table is tenant-scoped by the owning auth.users row (user_id).
-- Without this, the public 'anon' API key (shipped to every browser and
-- to the /api/doc share-link function) can read and write ALL
-- customers' data. Documents/document_items also get a narrow
-- "public read" policy so that shareable WhatsApp document links keep
-- working for anonymous visitors, but only SELECT, never write.
-- =====================================================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_items ENABLE ROW LEVEL SECURITY;

-- Profiles: any authenticated team member can write; anyone can read (required for public guest shared view)
CREATE POLICY profiles_select_public ON profiles
  FOR SELECT USING (true);
CREATE POLICY profiles_auth_insert ON profiles
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY profiles_auth_update ON profiles
  FOR UPDATE USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY profiles_auth_delete ON profiles
  FOR DELETE USING (auth.role() = 'authenticated');

-- Customers: shared access among all authenticated team members
CREATE POLICY customers_auth_all ON customers
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- Services: shared access among all authenticated team members
CREATE POLICY services_auth_all ON services
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- Documents: public guest read (for share links); write access shared among all authenticated team members
CREATE POLICY documents_select_public ON documents
  FOR SELECT USING (true);
CREATE POLICY documents_auth_insert ON documents
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY documents_auth_update ON documents
  FOR UPDATE USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY documents_auth_delete ON documents
  FOR DELETE USING (auth.role() = 'authenticated');

-- Document Items: public guest read (for share links); write access shared among all authenticated team members
CREATE POLICY document_items_select_public ON document_items
  FOR SELECT USING (true);
CREATE POLICY document_items_auth_insert ON document_items
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY document_items_auth_update ON document_items
  FOR UPDATE USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY document_items_auth_delete ON document_items
  FOR DELETE USING (auth.role() = 'authenticated');

-- Approver Devices: token registrations for push notifications
CREATE TABLE IF NOT EXISTS approver_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  device_name TEXT,
  last_active TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

ALTER TABLE approver_devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY approver_devices_auth_all ON approver_devices
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');`;

// Helper to check if we should write to local storage or supabase.
// Exported (REMEDIATION 2026-08-24) so financeService.ts can use the
// exact same cloud/local decision the rest of the app already uses,
// instead of inventing a second, possibly-divergent check.
export const isCloudActive = (): boolean => {
  if (!supabase) return false;
  // If supabase is initialized, only write/read if a session user exists
  const storedUser = localStorage.getItem('supabase_user');
  return !!storedUser;
};

// Local storage helpers
const getLocal = <T>(key: string, defaultValue: T): T => {
  const data = localStorage.getItem(`docgen_${key}`);
  return data ? JSON.parse(data) : defaultValue;
};

const setLocal = <T>(key: string, value: T): void => {
  localStorage.setItem(`docgen_${key}`, JSON.stringify(value));
};

// Shared payload builder for Google Sheets sync (Phase B4) - used by both
// syncDocumentToGoogleSheets (single document) and forceFullResync (every
// document for a company), so the shape is defined in exactly one place.
function buildSyncPayload(companyName: string, doc: Document, items: DocumentItem[]) {
  return {
    action: 'save_document',
    document_id: doc.id,
    company_name: companyName,
    document_number: doc.document_number,
    document_type: doc.document_type,
    customer_name: doc.customer_name,
    customer_email: doc.customer_email || '',
    customer_phone: doc.customer_phone || '',
    customer_address: doc.customer_address || '',
    customer_gstin: doc.customer_gstin || '',
    date: doc.date,
    subtotal: doc.subtotal,
    discount_total: doc.discount_total || 0,
    // Optional advance payment - 0 for documents where none was entered
    // (including every pre-existing document saved before this field
    // existed). Balance Due is deliberately NOT sent as its own column;
    // it's always derivable as total - advance, so it can't go stale.
    advance: doc.advance || 0,
    taxable_amount: (doc.subtotal || 0) - (doc.discount_total || 0),
    tax_total: doc.tax_total,
    total: doc.total,
    items: (items || []).map(it => ({
      description: it.description,
      qty: it.quantity,
      days: it.days || 1,
      unit: it.unit,
      rate: it.rate,
      amount: it.amount
    }))
  };
}

const normalizeDocTypeForCompany = (d: Document, profile?: CompanyProfile | null): boolean => {
  const profileName = (profile?.name || '').toLowerCase();
  const customerName = (d.customer_name || '').toLowerCase();
  const isInterMedia = profileName.includes('inter-media') || profileName.includes('inter media') || customerName.includes('venus');
  const isInternational = profileName.includes('international') || customerName.includes('nesto');

  if (isInterMedia && d.document_type === 'non_tax_invoice') {
    d.document_type = 'invoice';
    return true;
  }
  if (isInternational && d.document_type === 'invoice') {
    d.document_type = 'non_tax_invoice';
    return true;
  }
  return false;
};

export const dbService = {
  // Profiles
  async getProfiles(): Promise<CompanyProfile[]> {
    if (isCloudActive() && supabase) {
      const { data, error } = await supabase.from('profiles').select('*').order('created_at', { ascending: true });
      if (error) throw error;
      return data || [];
    } else {
      return getLocal<CompanyProfile[]>('profiles', []);
    }
  },

  async saveProfile(profile: CompanyProfile): Promise<CompanyProfile> {
    const isIntl = profile.name.toLowerCase().includes('international');
    const cleanProfile: CompanyProfile = {
      ...profile,
      gstin: isIntl ? undefined : profile.gstin,
      pan: isIntl ? undefined : profile.pan
    };

    if (isCloudActive() && supabase) {
      const userStr = localStorage.getItem('supabase_user');
      const userId = userStr ? JSON.parse(userStr).id : null;
      
      const payload: any = { ...cleanProfile, user_id: userId };
      if (isIntl) {
        payload.gstin = null;
        payload.pan = null;
      }
      
      // Check if it already exists in Supabase
      const { data: existing } = await supabase.from('profiles').select('id').eq('id', profile.id).maybeSingle();
      
      if (existing) {
        const { data, error } = await supabase.from('profiles').update(payload).eq('id', profile.id).select().single();
        if (error) throw error;
        return data;
      } else {
        const { data, error } = await supabase.from('profiles').insert([payload]).select().single();
        if (error) throw error;
        return data;
      }
    } else {
      const profiles = getLocal<CompanyProfile[]>('profiles', []);
      const index = profiles.findIndex(p => p.id === cleanProfile.id);
      if (index >= 0) {
        profiles[index] = cleanProfile;
      } else {
        profiles.push(cleanProfile);
      }
      setLocal('profiles', profiles);
      return cleanProfile;
    }
  },

  async deleteProfile(id: string): Promise<void> {
    if (isCloudActive() && supabase) {
      const { error } = await supabase.from('profiles').delete().eq('id', id);
      if (error) throw error;
    } else {
      const profiles = getLocal<CompanyProfile[]>('profiles', []);
      const updated = profiles.filter(p => p.id !== id);
      setLocal('profiles', updated);
      
      // Clean up other tables in LocalStorage as cascade
      const customers = getLocal<Customer[]>('customers', []);
      setLocal('customers', customers.filter(c => c.company_id !== id));
      
      const services = getLocal<Service[]>('services', []);
      setLocal('services', services.filter(s => s.company_id !== id));
      
      const docs = getLocal<Document[]>('documents', []);
      const deletedDocIds = docs.filter(d => d.company_id === id).map(d => d.id);
      setLocal('documents', docs.filter(d => d.company_id !== id));
      
      const items = getLocal<DocumentItem[]>('document_items', []);
      setLocal('document_items', items.filter(it => !deletedDocIds.includes(it.document_id)));
    }
  },

  // Customers
  async getCustomers(companyId: string): Promise<Customer[]> {
    if (isCloudActive() && supabase) {
      const { data, error } = await supabase.from('customers').select('*').eq('company_id', companyId).order('name', { ascending: true });
      if (error) throw error;
      return data || [];
    } else {
      const customers = getLocal<Customer[]>('customers', []);
      return customers.filter(c => c.company_id === companyId);
    }
  },

  async saveCustomer(customer: Customer): Promise<Customer> {
    if (isCloudActive() && supabase) {
      const userStr = localStorage.getItem('supabase_user');
      const userId = userStr ? JSON.parse(userStr).id : null;
      const payload = { ...customer, user_id: userId };
      
      const { data: existing } = await supabase.from('customers').select('id').eq('id', customer.id).maybeSingle();
      if (existing) {
        const { data, error } = await supabase.from('customers').update(payload).eq('id', customer.id).select().single();
        if (error) throw error;
        return data;
      } else {
        const { data, error } = await supabase.from('customers').insert([payload]).select().single();
        if (error) throw error;
        return data;
      }
    } else {
      const customers = getLocal<Customer[]>('customers', []);
      const index = customers.findIndex(c => c.id === customer.id);
      if (index >= 0) {
        customers[index] = customer;
      } else {
        customers.push(customer);
      }
      setLocal('customers', customers);
      return customer;
    }
  },

  async deleteCustomer(id: string): Promise<void> {
    if (isCloudActive() && supabase) {
      const { error } = await supabase.from('customers').delete().eq('id', id);
      if (error) throw error;
    } else {
      const customers = getLocal<Customer[]>('customers', []);
      setLocal('customers', customers.filter(c => c.id !== id));
    }
  },

  // Services (Shared catalog across profiles with zero duplicate entries)
  async getServices(companyId?: string): Promise<Service[]> {
    let rawServices: Service[] = [];
    if (isCloudActive() && supabase) {
      // Query all services so services created under any company profile
      // are shared across the organization.
      const { data, error } = await supabase.from('services').select('*').order('name', { ascending: true });
      if (error) throw error;
      rawServices = data || [];
    } else {
      rawServices = getLocal<Service[]>('services', []);
    }

    // Deduplicate by normalized service name to prevent duplicate entries
    const serviceMap = new Map<string, Service>();
    for (const item of rawServices) {
      const key = (item.name || '').trim().toLowerCase();
      if (!key) continue;
      const existing = serviceMap.get(key);
      if (!existing) {
        serviceMap.set(key, item);
      } else if (companyId && item.company_id === companyId && existing.company_id !== companyId) {
        // If a duplicate exists, prioritize the record matched to current company_id
        serviceMap.set(key, item);
      }
    }

    return Array.from(serviceMap.values()).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  },

  async saveService(service: Service): Promise<Service> {
    const trimmedName = (service.name || '').trim();
    const cleanService = { ...service, name: trimmedName };

    if (isCloudActive() && supabase) {
      const userStr = localStorage.getItem('supabase_user');
      const userId = userStr ? JSON.parse(userStr).id : null;
      let payload = { ...cleanService, user_id: userId };

      // Check if service already exists by ID
      let targetId = cleanService.id;
      let existingRecord: any = null;

      if (targetId) {
        const { data: byId } = await supabase.from('services').select('id, name, company_id').eq('id', targetId).maybeSingle();
        if (byId) {
          existingRecord = byId;
        }
      }

      // If not found by ID, check if a service with the same name already exists across profiles
      // to avoid creating duplicate service entries
      if (!existingRecord && trimmedName) {
        const { data: byName } = await supabase
          .from('services')
          .select('id, name, company_id')
          .ilike('name', trimmedName)
          .limit(1)
          .maybeSingle();

        if (byName) {
          existingRecord = byName;
          targetId = byName.id;
          payload.id = byName.id;
        }
      }

      if (existingRecord) {
        const { data, error } = await supabase.from('services').update(payload).eq('id', targetId).select().single();
        if (error) throw error;

        // Clean up any historical duplicate entries with the same name across profiles
        if (trimmedName) {
          await supabase.from('services').delete().ilike('name', trimmedName).neq('id', targetId);
        }
        return data;
      } else {
        const { data, error } = await supabase.from('services').insert([payload]).select().single();
        if (error) throw error;
        return data;
      }
    } else {
      const services = getLocal<Service[]>('services', []);
      const lowerName = trimmedName.toLowerCase();

      const existingIndex = services.findIndex(s => 
        (cleanService.id && s.id === cleanService.id) || 
        ((s.name || '').trim().toLowerCase() === lowerName)
      );

      if (existingIndex >= 0) {
        const existingId = services[existingIndex].id || cleanService.id;
        cleanService.id = existingId;
        services[existingIndex] = cleanService;
        const deduplicated = services.filter((s, idx) => 
          idx === existingIndex || (s.name || '').trim().toLowerCase() !== lowerName
        );
        setLocal('services', deduplicated);
      } else {
        services.push(cleanService);
        setLocal('services', services);
      }
      return cleanService;
    }
  },

  async deleteService(id: string): Promise<void> {
    if (isCloudActive() && supabase) {
      // Find service first so we can remove any duplicate rows with the exact same name
      const { data: target } = await supabase.from('services').select('id, name').eq('id', id).maybeSingle();
      if (target?.name) {
        const { error } = await supabase.from('services').delete().ilike('name', target.name.trim());
        if (error) throw error;
      } else {
        const { error } = await supabase.from('services').delete().eq('id', id);
        if (error) throw error;
      }
    } else {
      const services = getLocal<Service[]>('services', []);
      const target = services.find(s => s.id === id);
      const targetName = (target?.name || '').trim().toLowerCase();

      const filtered = services.filter(s => {
        if (s.id === id) return false;
        if (targetName && (s.name || '').trim().toLowerCase() === targetName) return false;
        return true;
      });
      setLocal('services', filtered);
    }
  },

  // Documents
  async getDocuments(companyId?: string): Promise<Document[]> {
    const profiles = getLocal<CompanyProfile[]>('profiles', []);
    const prof = companyId ? profiles.find(p => p.id === companyId) : null;
    if (isCloudActive() && supabase) {
      let query = supabase.from('documents').select('*');
      if (companyId) {
        query = query.eq('company_id', companyId);
      }
      const { data, error } = await query.order('date', { ascending: false }).order('created_at', { ascending: false });
      if (error) throw error;
      if (data) {
        data.forEach(d => {
          const docProf = prof || profiles.find(p => p.id === d.company_id);
          if (normalizeDocTypeForCompany(d, docProf)) {
            // Display normalization only; changes require a new approval.
          }
        });
      }
      return data || [];
    } else {
      const docs = getLocal<Document[]>('documents', []);
      let updatedLocal = false;
      docs.forEach(d => {
        const docProf = prof || profiles.find(p => p.id === d.company_id);
        if (normalizeDocTypeForCompany(d, docProf)) {
          updatedLocal = true;
        }
      });
      if (updatedLocal) {
        setLocal('documents', docs);
      }
      if (companyId) {
        return docs.filter(d => d.company_id === companyId);
      }
      return docs;
    }
  },

  async getProfileById(id: string): Promise<CompanyProfile | null> {
    if (supabase) {
      try {
        const { data, error } = await supabase.from('profiles').select('*').eq('id', id).single();
        if (!error && data) return data;
      } catch (err) {
        if (import.meta.env.DEV) console.log('dbService: Supabase fetch failed in getProfileById:', err);
      }
    }
    const profiles = getLocal<CompanyProfile[]>('profiles', []);
    return profiles.find(p => p.id === id) || null;
  },

  async getDocumentById(id: string): Promise<{ document: Document; items: DocumentItem[] } | null> {
    if (import.meta.env.DEV) console.log('dbService: getDocumentById called with ID:', id);
    if (supabase) {
      if (!isCloudActive()) throw new Error('Please sign in again to load this document.');
      const { data: document, error } = await supabase.from('documents').select('*').eq('id', id).maybeSingle();
      if (error) throw new Error(`Could not load document: ${error.message}`);
      if (!document) return null;
      const { data: items, error: itemError } = await supabase.from('document_items').select('*').eq('document_id', id).order('sort_order');
      if (itemError) throw new Error(`Could not load document items: ${itemError.message}`);
      return { document, items: items || [] };
    }
    const docs = getLocal<Document[]>('documents', []);
    const doc = docs.find(d => d.id === id);
    if (!doc) {
      if (import.meta.env.DEV) console.log('dbService: Local Document not found for ID:', id);
      return null;
    }
    const profiles = getLocal<CompanyProfile[]>('profiles', []);
    const docProf = profiles.find(p => p.id === doc.company_id);
    if (normalizeDocTypeForCompany(doc, docProf)) {
      setLocal('documents', docs);
    }
    const items = getLocal<DocumentItem[]>('document_items', []);
    const docItems = items.filter(it => it.document_id === id).sort((a, b) => a.sort_order - b.sort_order);
    if (import.meta.env.DEV) console.log('dbService: LocalStorage returned document:', doc);
    if (import.meta.env.DEV) console.log('dbService: LocalStorage returned items count:', docItems.length, 'items:', docItems);
    return { document: doc, items: docItems };
  },

  // Public/anonymous document lookup (share links only, both /doc/:id
  // and /q/:documentNumber). Calls the get_public_document RPC created
  // in the RLS-hardening Phase 1 work, which returns only the fields
  // the public share preview actually renders. getDocumentById above
  // is unrelated to this and remains in place unchanged - it's still
  // used by the authenticated edit flow (DocumentEditor.tsx), which
  // needs the full row and isn't affected by the anon RLS lockdown
  // this work is building toward. The old getDocumentByNumber (which
  // fetched every document row and filtered client-side) has been
  // removed - it had no remaining callers once /q/:documentNumber was
  // wired to this function instead.
  // No offline/local equivalent - public share links require Supabase.
  async getPublicDocument(params: { id?: string; documentNumber?: string }): Promise<{ document: Document; items: DocumentItem[]; profile: Partial<CompanyProfile>; comparison: ComparisonConfig | null } | null> {
    if (!supabase) return null;
    try {
      const { data, error } = await supabase.rpc('get_public_document', {
        p_id: params.id ?? null,
        p_document_number: params.documentNumber ?? null
      });
      if (error) throw new Error('Could not load the shared document. Check your connection and try again.');
      if (!data) return null;
      let comparison: ComparisonConfig | null = data.comparison ?? null;
      if (!Object.hasOwn(data, 'comparison') && (data.document.document_type === 'comparison_quotation' || data.document.document_type === 'comparison_invoice')) {
        const result = await supabase.rpc('get_public_comparison_data', { p_document_id: data.document.id });
        if (result.error) {
          console.error('Unable to load shared comparison:', result.error);
        } else {
          comparison = (result.data?.comparison ?? null) as ComparisonConfig | null;
          if (result.data?.currency) {
            data.profile = { ...data.profile, currency: result.data.currency };
          }
        }
      }
      return {
        comparison,
        // The RPC's whitelist (see get_public_document's SQL) only
        // returns the subset of fields the public preview renders -
        // asserted here since DocumentPreview.tsx's public-share path
        // only ever reads that same subset.
        document: data.document as Document,
        items: (data.items || []) as DocumentItem[],
        profile: (data.profile || {}) as Partial<CompanyProfile>
      };
    } catch (err) {
      throw err;
    }
  },

  async saveDocument(doc: Document, items: DocumentItem[], comparison?: ComparisonConfig): Promise<Document> {
    const profiles = getLocal<CompanyProfile[]>('profiles', []);
    const payload = { ...doc };
    normalizeDocTypeForCompany(payload, profiles.find(p => p.id === doc.company_id));
    const savedItems = items.map(it => ({ ...it, document_id: doc.id,
      gst_percentage: payload.document_type === 'non_tax_invoice' ? 0 : it.gst_percentage }));
    let saved: Document = { ...payload, status: 'pending_approval', approved_at: undefined, approved_by_email: undefined };
    if (supabase) {
      if (!isCloudActive()) throw new Error('Please sign in again. The document was not saved.');
      const { data, error } = await supabase.rpc('save_document_bundle', {
        p_document: payload, p_items: savedItems, p_comparison: comparison ?? null
      });
      if (error) throw new Error(`Document was not saved: ${error.message}`);
      if (data?.id !== doc.id) throw new Error('The server did not confirm the document save.');
      saved = data as Document;
    }
    // Update callers and browser backup only after the whole transaction succeeds.
    Object.assign(doc, saved);
    try {
      const docs = getLocal<Document[]>('documents', []).filter(d => d.id !== doc.id);
      setLocal('documents', [...docs, saved]);
      const others = getLocal<DocumentItem[]>('document_items', []).filter(it => it.document_id !== doc.id);
      setLocal('document_items', [...others, ...savedItems]);
      if (comparison) localStorage.setItem(`docgen_comparison_doc_${doc.id}`, JSON.stringify(comparison));
    } catch (error) {
      if (!supabase) throw error;
      window.alert('Saved to the server, but the browser backup could not be updated. Refresh before editing again.');
    }
    return saved;
  },

  async deleteDocument(id: string): Promise<void> {
    if (supabase) {
      if (!isCloudActive()) throw new Error('Please sign in again. Nothing was deleted.');
      const { data, error } = await supabase.rpc('delete_document_bundle', { p_id: id });
      if (error) throw new Error(error.message);
      if (data !== id) throw new Error('The server did not confirm deletion.');
    }
    setLocal('documents', getLocal<Document[]>('documents', []).filter(d => d.id !== id));
    setLocal('document_items', getLocal<DocumentItem[]>('document_items', []).filter(it => it.document_id !== id));
    localStorage.removeItem(`docgen_comparison_doc_${id}`);
  },

  async logWhatsAppSend(docId: string, email: string): Promise<void> {
    if (supabase) {
      if (!isCloudActive()) throw new Error('Please sign in again to record this send.');
      const { error } = await supabase.rpc('log_document_send', { p_id: docId });
      if (error) throw new Error(error.message);
      return;
    }
    const docs = getLocal<Document[]>('documents', []);
    const doc = docs.find(d => d.id === docId);
    if (doc) { doc.whatsapp_sent_by_email = email; doc.whatsapp_sent_at = new Date().toISOString(); setLocal('documents', docs); }
  },

  async reviewDocument(docId: string, approve: boolean, email: string): Promise<void> {
    let saved: Document | undefined;
    if (supabase) {
      if (!isCloudActive()) throw new Error('Please sign in again to review documents.');
      const { data, error } = await supabase.rpc('review_document', { p_id: docId, p_approve: approve });
      if (error) throw new Error(error.message);
      if (data?.id !== docId) throw new Error('The server did not confirm this review.');
      saved = data;
    }
    const docs = getLocal<Document[]>('documents', []);
    const index = docs.findIndex(d => d.id === docId);
    if (index >= 0) {
      docs[index] = saved || { ...docs[index], status: approve ? 'approved' : 'rejected', approved_by_email: email, approved_at: new Date().toISOString() };
      setLocal('documents', docs);
    }
  },

  async approveDocument(docId: string, email: string): Promise<void> {
    await this.reviewDocument(docId, true, email);
  },

  async rejectDocument(docId: string, email: string): Promise<void> {
    await this.reviewDocument(docId, false, email);
  },

  async getApproverDevice(companyId: string): Promise<any | null> {
    if (isCloudActive() && supabase) {
      const { data, error } = await supabase
        .from('approver_devices')
        .select('*')
        .eq('company_id', companyId)
        .maybeSingle();
      if (error) throw error;
      return data;
    }
    return getLocal<any>('approver_device_' + companyId, null);
  },

  async getApproverDevices(companyId: string): Promise<any[]> {
    if (isCloudActive() && supabase) {
      const { data, error } = await supabase
        .from('approver_devices')
        .select('*')
        .eq('company_id', companyId);
      if (error) throw error;
      return data || [];
    }
    const single = getLocal<any>('approver_device_' + companyId, null);
    return single ? [single] : [];
  },

  async registerApproverDevice(companyId: string, token: string, deviceName: string): Promise<any> {
    const payload = {
      company_id: companyId,
      token,
      device_name: deviceName,
      last_active: new Date().toISOString()
    };
    if (isCloudActive() && supabase) {
      const { data: existing } = await supabase
        .from('approver_devices')
        .select('id')
        .eq('company_id', companyId)
        .maybeSingle();
      
      if (existing) {
        const { data, error } = await supabase
          .from('approver_devices')
          .update(payload)
          .eq('company_id', companyId)
          .select()
          .single();
        if (error) throw error;
        return data;
      } else {
        const { data, error } = await supabase
          .from('approver_devices')
          .insert([payload])
          .select()
          .single();
        if (error) throw error;
        return data;
      }
    } else {
      setLocal('approver_device_' + companyId, payload);
      return payload;
    }
  },

  async removeApproverDevice(companyId: string): Promise<void> {
    if (isCloudActive() && supabase) {
      const { error } = await supabase
        .from('approver_devices')
        .delete()
        .eq('company_id', companyId);
      if (error) throw error;
    } else {
      localStorage.removeItem(`docgen_approver_device_${companyId}`);
    }
  },

  // Complete Automatic Local System Backup & Recovery Engine
  async generateFullBackup(): Promise<any> {
    let docs = getLocal<Document[]>('documents', []);
    let items = getLocal<DocumentItem[]>('document_items', []);
    let custs = getLocal<Customer[]>('customers', []);
    let servs = getLocal<Service[]>('services', []);
    let profs = getLocal<CompanyProfile[]>('profiles', []);

    if (isCloudActive() && supabase) {
      try {
        const [d, it, c, s, p] = await Promise.all([
          supabase.from('documents').select('*'),
          supabase.from('document_items').select('*'),
          supabase.from('customers').select('*'),
          supabase.from('services').select('*'),
          supabase.from('profiles').select('*')
        ]);
        if (d.data) docs = d.data;
        if (it.data) items = it.data;
        if (c.data) custs = c.data;
        if (s.data) servs = s.data;
        if (p.data) profs = p.data;
      } catch (e) {
        if (import.meta.env.DEV) console.warn('Supabase fetch failed during backup generation, using local cache:', e);
      }
    }

    const comparisonData: Record<string, any> = {};
    for (const doc of docs) {
      const compData = getLocal<any>(`comparison_doc_${doc.id}`, null);
      if (compData) {
        comparisonData[doc.id] = compData;
      } else if (isCloudActive() && supabase) {
        try {
          const { data } = await supabase.from('comparison_document_data').select('options_data').eq('document_id', doc.id).maybeSingle();
          if (data?.options_data) {
            comparisonData[doc.id] = data.options_data;
          }
        } catch (e) {}
      }
    }

    return {
      backup_version: '1.0',
      system: 'B2P Document Portal',
      exported_at: new Date().toISOString(),
      documents: docs,
      document_items: items,
      customers: custs,
      services: servs,
      profiles: profs,
      comparison_data: comparisonData
    };
  },

  async generateZipBackupBlob(): Promise<{ blob: Blob; filename: string }> {
    const data = await this.generateFullBackup();
    const dateStr = new Date().toISOString().split('T')[0];
    const zip = new JSZip();

    // 1. Primary manifest file for full system restore
    zip.file('backup_manifest.json', JSON.stringify(data, null, 2));

    // 2. CSV Summary file for viewing in Excel
    let csvContent = 'Document Number,Type,Customer Name,Date,Total Amount,Status,Created At\n';
    if (Array.isArray(data.documents)) {
      data.documents.forEach((d: any) => {
        const num = `"${(d.document_number || '').replace(/"/g, '""')}"`;
        const type = `"${(d.document_type || '').replace(/"/g, '""')}"`;
        const cust = `"${(d.customer_name || '').replace(/"/g, '""')}"`;
        const date = `"${(d.date || '').replace(/"/g, '""')}"`;
        const total = d.total_amount || 0;
        const status = `"${(d.status || '').replace(/"/g, '""')}"`;
        const created = `"${(d.created_at || '').replace(/"/g, '""')}"`;
        csvContent += `${num},${type},${cust},${date},${total},${status},${created}\n`;
      });
    }
    zip.file('documents_summary.csv', csvContent);

    // 3. Folder with individual document JSONs
    const docsFolder = zip.folder('documents');
    if (docsFolder && Array.isArray(data.documents)) {
      data.documents.forEach((d: any) => {
        const cleanName = (d.document_number || d.id).replace(/[^a-zA-Z0-9_-]/g, '_');
        const docItems = Array.isArray(data.document_items) ? data.document_items.filter((it: any) => it.document_id === d.id) : [];
        const compConfig = data.comparison_data ? data.comparison_data[d.id] : null;
        
        const docRecord = {
          document: d,
          items: docItems,
          comparison_config: compConfig
        };
        docsFolder.file(`${cleanName}.json`, JSON.stringify(docRecord, null, 2));
      });
    }

    // 4. README instructions inside zip
    const readmeText = `B2P INTERNATIONAL DOCUMENT PORTAL - LOCAL SYSTEM BACKUP ARCHIVE
===================================================================
Exported At: ${new Date().toLocaleString()}
Total Documents: ${data.documents?.length || 0}
Total Items: ${data.document_items?.length || 0}
Total Customers: ${data.customers?.length || 0}

FILE STRUCTURE:
- backup_manifest.json  : Complete system restore file.
- documents_summary.csv : Excel spreadsheet summary of all documents.
- documents/            : Individual JSON records for each document.

HOW TO RESTORE:
Go to Settings > Local Backup & Data Recovery in your portal and select this .zip archive or backup_manifest.json.
`;
    zip.file('README.txt', readmeText);

    const blob = await zip.generateAsync({ type: 'blob' });
    const filename = `b2p_documents_backup_${dateStr}.zip`;
    return { blob, filename };
  },

  async downloadFullBackupFile(): Promise<void> {
    const { blob, filename } = await this.generateZipBackupBlob();

    // Native path selection prompt (File System Access API in modern desktop browsers)
    if ('showSaveFilePicker' in window) {
      try {
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: filename,
          types: [{
            description: 'ZIP Backup Archive (*.zip)',
            accept: { 'application/zip': ['.zip'] }
          }]
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return;
      } catch (err: any) {
        if (err.name === 'AbortError') {
          // User closed/cancelled the path save dialog
          return;
        }
        console.warn('showSaveFilePicker failed, falling back to standard download:', err);
      }
    }

    // Fallback standard download trigger
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  async restoreBackupFromFile(file: File): Promise<{ success: boolean; count: number; error?: string }> {
    if (file.name.toLowerCase().endsWith('.zip')) {
      try {
        const zip = new JSZip();
        const unzipped = await zip.loadAsync(file);
        const manifestFile = unzipped.file('backup_manifest.json');
        if (!manifestFile) {
          return { success: false, count: 0, error: 'backup_manifest.json not found in ZIP archive.' };
        }
        const jsonText = await manifestFile.async('string');
        const jsonContent = JSON.parse(jsonText);
        return await this.restoreFullBackup(jsonContent);
      } catch (err: any) {
        return { success: false, count: 0, error: 'Failed to extract ZIP backup: ' + err.message };
      }
    } else {
      try {
        const jsonText = await file.text();
        const jsonContent = JSON.parse(jsonText);
        return await this.restoreFullBackup(jsonContent);
      } catch (err: any) {
        return { success: false, count: 0, error: 'Failed to parse backup JSON: ' + err.message };
      }
    }
  },

  async restoreFullBackup(backupData: any): Promise<{ success: boolean; count: number; error?: string }> {
    if (!backupData || typeof backupData !== 'object' || !Array.isArray(backupData.documents)) {
      return { success: false, count: 0, error: 'Invalid backup file format.' };
    }

    try {
      const docs: Document[] = backupData.documents || [];
      const items: DocumentItem[] = backupData.document_items || [];
      const custs: Customer[] = backupData.customers || [];
      const servs: Service[] = backupData.services || [];
      const profs: CompanyProfile[] = backupData.profiles || [];
      const compData: Record<string, any> = backupData.comparison_data || {};

      if (supabase) {
        if (!isCloudActive()) throw new Error('Please sign in again. The backup was not restored.');
        const access = await supabase.rpc('current_app_role');
        if (access.error || access.data !== 'owner') throw new Error('Only the owner can restore backups.');
        for (const [table, rows] of [['profiles', profs], ['customers', custs], ['services', servs]] as const) {
          if (rows.length) {
            const { error } = await supabase.from(table).upsert(rows as any[]);
            if (error) throw new Error(`Restore stopped at ${table}: ${error.message}. Some earlier records may already be restored.`);
          }
        }
        let restored = 0;
        for (const doc of docs) {
          try {
            await this.saveDocument(doc, items.filter(it => it.document_id === doc.id), compData[doc.id]);
            restored++;
          } catch (error: any) {
            return { success: false, count: restored, error: `Restored ${restored} documents; stopped at ${doc.document_number}: ${error.message}. Restored documents require owner approval.` };
          }
        }
      } else {
        setLocal('documents', docs);
        setLocal('document_items', items);
        setLocal('customers', custs);
        setLocal('services', servs);
        setLocal('profiles', profs);
        for (const [docId, cData] of Object.entries(compData)) setLocal(`comparison_doc_${docId}`, cData);
      }

      return { success: true, count: docs.length };
    } catch (err: any) {
      console.error('Failed to restore backup:', err);
      return { success: false, count: 0, error: err.message };
    }
  },

  async syncBackupToGoogleDrive(googleSheetsUrl: string): Promise<{ success: boolean; error?: string }> {
    if (!googleSheetsUrl) {
      return { success: false, error: 'Google Sheets / Drive Web App URL is not configured in Settings.' };
    }

    try {
      const fullBackup = await this.generateFullBackup();
      const payload = {
        action: 'full_backup',
        timestamp: new Date().toISOString(),
        payload: fullBackup
      };

      await fetch(googleSheetsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      });

      return { success: true };
    } catch (err: any) {
      console.error('Failed to sync backup to Google Drive:', err);
      return { success: false, error: err.message };
    }
  },

  // ─── Phase B2: public sync functions now enqueue via sheetsSyncQueue.ts
  // instead of calling fetch() directly. Signatures for
  // syncDocumentToGoogleSheets are UNCHANGED so DocumentEditor.tsx and
  // ComparisonEditor.tsx's call sites need no changes at all.
  // deleteDocumentFromGoogleSheets gains two required parameters
  // (companyId, documentId) since the queue needs them - its one call
  // site (App.tsx) is updated accordingly.
  //
  // The old direct-fetch implementations are kept below, renamed with a
  // "Legacy" suffix and NOT called from anywhere, per the explicit
  // instruction not to remove them until the queue path is fully
  // verified (Phase B5). They can be restored as a one-line revert if
  // needed.

  async syncDocumentToGoogleSheets(
    googleSheetsUrl: string | undefined, 
    companyName: string,
    doc: Document, 
    items: DocumentItem[]
  ): Promise<boolean> {
    if (!googleSheetsUrl || !googleSheetsUrl.trim()) return false;
    if (!doc.id || !doc.company_id) return false;

    const payload = buildSyncPayload(companyName, doc, items);
    return enqueueSync(doc.company_id, doc.id, 'save_document', payload);
  },

  // ─── Phase B4: Force Full Resync ────────────────────────────────────
  // Re-enqueues every document for a company. Uses the same upsert-by-
  // document_id enqueueSync() path as a normal save, so re-running this
  // never creates duplicate queue rows - each document's existing queue
  // row (if any) is simply reset to 'pending' with a fresh payload.
  async forceFullResync(companyId: string): Promise<number> {
    const docs = await this.getDocuments(companyId);
    const profile = await this.getProfileById(companyId);
    const companyName = profile?.name || '';

    let enqueuedCount = 0;
    for (const doc of docs) {
      try {
        const full = await this.getDocumentById(doc.id);
        const items = full?.items || [];
        const payload = buildSyncPayload(companyName, doc, items);
        const ok = await enqueueSync(companyId, doc.id, 'save_document', payload);
        if (ok) enqueuedCount++;
      } catch (err) {
        console.error(`[ForceFullResync] Failed to enqueue document ${doc.id}:`, err);
      }
    }
    return enqueuedCount;
  },

  async deleteDocumentFromGoogleSheets(
    googleSheetsUrl: string | undefined,
    companyId: string,
    documentId: string,
    documentNumber: string
  ): Promise<boolean> {
    if (!googleSheetsUrl || !googleSheetsUrl.trim()) return false;
    if (!companyId || !documentId) return false;

    const payload = {
      action: 'delete_document',
      document_id: documentId,
      document_number: documentNumber
    };

    return enqueueSync(companyId, documentId, 'delete_document', payload);
  },

  // ─── Preserved, unused fallback implementations (Phase B2) ──────────
  // Not called from anywhere in the app. Kept only so the direct-fetch
  // path can be restored quickly if the queue needs to be rolled back
  // before Phase B5's final verification.

  async syncDocumentToGoogleSheetsLegacy(
    googleSheetsUrl: string | undefined, 
    companyName: string,
    doc: Document, 
    items: DocumentItem[]
  ): Promise<boolean> {
    if (!googleSheetsUrl || !googleSheetsUrl.trim()) return false;

    try {
      const payload = {
        action: 'save_document',
        company_name: companyName,
        document_number: doc.document_number,
        document_type: doc.document_type,
        customer_name: doc.customer_name,
        customer_email: doc.customer_email || '',
        customer_phone: doc.customer_phone || '',
        customer_address: doc.customer_address || '',
        customer_gstin: doc.customer_gstin || '',
        date: doc.date,
        subtotal: doc.subtotal,
        discount_total: doc.discount_total || 0,
        taxable_amount: (doc.subtotal || 0) - (doc.discount_total || 0),
        tax_total: doc.tax_total,
        total: doc.total,
        items: (items || []).map(it => ({
          description: it.description,
          qty: it.quantity,
          days: it.days || 1,
          unit: it.unit,
          rate: it.rate,
          amount: it.amount
        }))
      };

      await fetch(googleSheetsUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8'
        },
        body: JSON.stringify(payload)
      });

      return true;
    } catch (err) {
      console.error('[Google Sheets Sync Error]:', err);
      return false;
    }
  },

  async deleteDocumentFromGoogleSheetsLegacy(
    googleSheetsUrl: string | undefined,
    documentNumber: string
  ): Promise<boolean> {
    if (!googleSheetsUrl || !googleSheetsUrl.trim()) return false;

    try {
      const payload = {
        action: 'delete_document',
        document_number: documentNumber
      };

      await fetch(googleSheetsUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8'
        },
        body: JSON.stringify(payload)
      });

      return true;
    } catch (err) {
      console.error('[Google Sheets Delete Sync Error]:', err);
      return false;
    }
  }
};
