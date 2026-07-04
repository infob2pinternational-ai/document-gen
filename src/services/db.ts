import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { CompanyProfile, Customer, Service, Document, DocumentItem } from '../types';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const isSupabaseConfigured = (): boolean => {
  return !!(supabaseUrl && supabaseAnonKey);
};

export const supabase: SupabaseClient | null = isSupabaseConfigured()
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

// Raw SQL schema string to show in Settings
export const SQL_SCHEMA = `-- Profiles (Company entities)
CREATE TABLE profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  logo_url TEXT, -- Base64 logo or url
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
  letterhead_header_url TEXT,
  letterhead_footer_url TEXT,
  seal_url TEXT,
  stamp_url TEXT,
  
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
  issue_date DATE NOT NULL,
  due_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  
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
  rate NUMERIC NOT NULL DEFAULT 0,
  unit TEXT DEFAULT 'nos',
  hsn_sac TEXT,
  gst_percentage NUMERIC DEFAULT 0,
  amount NUMERIC NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0
);`;

// Helper to check if we should write to local storage or supabase
const useCloud = (): boolean => {
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

export const dbService = {
  // Profiles
  async getProfiles(): Promise<CompanyProfile[]> {
    if (useCloud() && supabase) {
      const { data, error } = await supabase.from('profiles').select('*').order('created_at', { ascending: true });
      if (error) throw error;
      return data || [];
    } else {
      return getLocal<CompanyProfile[]>('profiles', []);
    }
  },

  async saveProfile(profile: CompanyProfile): Promise<CompanyProfile> {
    if (useCloud() && supabase) {
      const userStr = localStorage.getItem('supabase_user');
      const userId = userStr ? JSON.parse(userStr).id : null;
      
      const payload = { ...profile, user_id: userId };
      
      // Check if it already exists in Supabase
      const { data: existing } = await supabase.from('profiles').select('id').eq('id', profile.id).single();
      
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
      const index = profiles.findIndex(p => p.id === profile.id);
      if (index >= 0) {
        profiles[index] = profile;
      } else {
        profiles.push(profile);
      }
      setLocal('profiles', profiles);
      return profile;
    }
  },

  async deleteProfile(id: string): Promise<void> {
    if (useCloud() && supabase) {
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
    if (useCloud() && supabase) {
      const { data, error } = await supabase.from('customers').select('*').eq('company_id', companyId).order('name', { ascending: true });
      if (error) throw error;
      return data || [];
    } else {
      const customers = getLocal<Customer[]>('customers', []);
      return customers.filter(c => c.company_id === companyId);
    }
  },

  async saveCustomer(customer: Customer): Promise<Customer> {
    if (useCloud() && supabase) {
      const userStr = localStorage.getItem('supabase_user');
      const userId = userStr ? JSON.parse(userStr).id : null;
      const payload = { ...customer, user_id: userId };
      
      const { data: existing } = await supabase.from('customers').select('id').eq('id', customer.id).single();
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
    if (useCloud() && supabase) {
      const { error } = await supabase.from('customers').delete().eq('id', id);
      if (error) throw error;
    } else {
      const customers = getLocal<Customer[]>('customers', []);
      setLocal('customers', customers.filter(c => c.id !== id));
    }
  },

  // Services
  async getServices(companyId: string): Promise<Service[]> {
    if (useCloud() && supabase) {
      const { data, error } = await supabase.from('services').select('*').eq('company_id', companyId).order('name', { ascending: true });
      if (error) throw error;
      return data || [];
    } else {
      const services = getLocal<Service[]>('services', []);
      return services.filter(s => s.company_id === companyId);
    }
  },

  async saveService(service: Service): Promise<Service> {
    if (useCloud() && supabase) {
      const userStr = localStorage.getItem('supabase_user');
      const userId = userStr ? JSON.parse(userStr).id : null;
      const payload = { ...service, user_id: userId };
      
      const { data: existing } = await supabase.from('services').select('id').eq('id', service.id).single();
      if (existing) {
        const { data, error } = await supabase.from('services').update(payload).eq('id', service.id).select().single();
        if (error) throw error;
        return data;
      } else {
        const { data, error } = await supabase.from('services').insert([payload]).select().single();
        if (error) throw error;
        return data;
      }
    } else {
      const services = getLocal<Service[]>('services', []);
      const index = services.findIndex(s => s.id === service.id);
      if (index >= 0) {
        services[index] = service;
      } else {
        services.push(service);
      }
      setLocal('services', services);
      return service;
    }
  },

  async deleteService(id: string): Promise<void> {
    if (useCloud() && supabase) {
      const { error } = await supabase.from('services').delete().eq('id', id);
      if (error) throw error;
    } else {
      const services = getLocal<Service[]>('services', []);
      setLocal('services', services.filter(s => s.id !== id));
    }
  },

  // Documents
  async getDocuments(companyId?: string): Promise<Document[]> {
    if (useCloud() && supabase) {
      let query = supabase.from('documents').select('*');
      if (companyId) {
        query = query.eq('company_id', companyId);
      }
      const { data, error } = await query.order('issue_date', { ascending: false }).order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    } else {
      const docs = getLocal<Document[]>('documents', []);
      if (companyId) {
        return docs.filter(d => d.company_id === companyId);
      }
      return docs;
    }
  },

  async getDocumentById(id: string): Promise<{ document: Document; items: DocumentItem[] } | null> {
    if (useCloud() && supabase) {
      const { data: document, error: docError } = await supabase.from('documents').select('*').eq('id', id).single();
      if (docError) {
        if (docError.code === 'PGRST116') return null; // not found
        throw docError;
      }
      const { data: items, error: itemsError } = await supabase
        .from('document_items')
        .select('*')
        .eq('document_id', id)
        .order('sort_order', { ascending: true });
      if (itemsError) throw itemsError;
      return { document, items: items || [] };
    } else {
      const docs = getLocal<Document[]>('documents', []);
      const doc = docs.find(d => d.id === id);
      if (!doc) return null;
      const items = getLocal<DocumentItem[]>('document_items', []);
      const docItems = items.filter(it => it.document_id === id).sort((a, b) => a.sort_order - b.sort_order);
      return { document: doc, items: docItems };
    }
  },

  async saveDocument(doc: Document, items: DocumentItem[]): Promise<Document> {
    if (useCloud() && supabase) {
      const userStr = localStorage.getItem('supabase_user');
      const userId = userStr ? JSON.parse(userStr).id : null;
      
      const docPayload = { ...doc, user_id: userId };
      
      // Save doc
      const { data: existingDoc } = await supabase.from('documents').select('id').eq('id', doc.id).single();
      if (existingDoc) {
        const { error } = await supabase.from('documents').update(docPayload).eq('id', doc.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('documents').insert([docPayload]);
        if (error) throw error;
      }
      
      // Delete old line items
      const { error: deleteError } = await supabase.from('document_items').delete().eq('document_id', doc.id);
      if (deleteError) throw deleteError;
      
      // Insert new line items
      if (items.length > 0) {
        const itemsPayload = items.map(it => ({
          id: it.id,
          document_id: it.document_id,
          service_id: it.service_id || null,
          description: it.description,
          quantity: it.quantity,
          rate: it.rate,
          unit: it.unit,
          hsn_sac: it.hsn_sac || null,
          gst_percentage: it.gst_percentage,
          amount: it.amount,
          sort_order: it.sort_order
        }));
        const { error: insertError } = await supabase.from('document_items').insert(itemsPayload);
        if (insertError) throw insertError;
      }
      
      return doc;
    } else {
      // LocalStorage save
      const docs = getLocal<Document[]>('documents', []);
      const docIdx = docs.findIndex(d => d.id === doc.id);
      if (docIdx >= 0) {
        docs[docIdx] = doc;
      } else {
        docs.push(doc);
      }
      setLocal('documents', docs);
      
      // Save items
      const localItems = getLocal<DocumentItem[]>('document_items', []);
      const itemsWithoutThisDoc = localItems.filter(it => it.document_id !== doc.id);
      const updatedItems = [...itemsWithoutThisDoc, ...items];
      setLocal('document_items', updatedItems);
      
      return doc;
    }
  },

  async deleteDocument(id: string): Promise<void> {
    if (useCloud() && supabase) {
      const { error } = await supabase.from('documents').delete().eq('id', id);
      if (error) throw error;
    } else {
      const docs = getLocal<Document[]>('documents', []);
      setLocal('documents', docs.filter(d => d.id !== id));
      
      const items = getLocal<DocumentItem[]>('document_items', []);
      setLocal('document_items', items.filter(it => it.document_id !== id));
    }
  }
};
