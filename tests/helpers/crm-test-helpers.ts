import { Page, expect } from '@playwright/test';

export const COMPANY_A = {
  id: 'a0000000-0000-4000-a000-000000000001',
  name: 'B2P International',
  currency: 'INR',
  invoice_prefix: 'INV/',
  invoice_start_number: 1001,
  quotation_prefix: 'QTN/',
  quotation_start_number: 1001,
  proforma_prefix: 'PI/',
  proforma_start_number: 1001,
  work_order_prefix: 'WO/',
  work_order_start_number: 1001,
  created_at: '2026-08-01T00:00:00.000Z'
};

export const COMPANY_B = {
  id: 'b0000000-0000-4000-b000-000000000002',
  name: 'B2P Media Solutions',
  currency: 'INR',
  invoice_prefix: 'B2P/INV/',
  invoice_start_number: 2001,
  quotation_prefix: 'B2P/QTN/',
  quotation_start_number: 2001,
  proforma_prefix: 'B2P/PI/',
  proforma_start_number: 2001,
  work_order_prefix: 'B2P/WO/',
  work_order_start_number: 2001,
  created_at: '2026-08-01T00:00:00.000Z'
};

export const TEST_CUSTOMER = {
  id: 'c0000000-0000-4000-c000-000000000001',
  company_id: COMPANY_A.id,
  name: 'Acme Mega Events',
  phone: '9847012345',
  email: 'acme@example.com',
  address: 'MG Road, Thrissur, Kerala',
  created_at: '2026-08-01T00:00:00.000Z'
};

export interface SetupOptions {
  profiles?: any[];
  activeProfileId?: string;
  leads?: any[];
  followUps?: any[];
  customers?: any[];
  documents?: any[];
  documentItems?: any[];
  simulatedRole?: string;
  handleDialogs?: boolean;
}

export async function setupApp(page: Page, options: SetupOptions = {}) {
  const profiles = options.profiles ?? [COMPANY_A, COMPANY_B];
  const activeProfileId = options.activeProfileId ?? COMPANY_A.id;
  const leads = options.leads ?? [];
  const followUps = options.followUps ?? [];
  const customers = options.customers ?? [TEST_CUSTOMER];
  const documents = options.documents ?? [];
  const documentItems = options.documentItems ?? [];

  // Capture dialogs by default so alert/confirm doesn't block the browser unless custom handled
  if (options.handleDialogs !== false) {
    page.on('dialog', async dialog => {
      try {
        await dialog.accept();
      } catch (e) {}
    });
  }

  await page.addInitScript(
    ({ profiles, activeProfileId, leads, followUps, customers, documents, documentItems, role }) => {
      if (sessionStorage.getItem('__test_initialized')) {
        return;
      }
      sessionStorage.setItem('__test_initialized', 'true');
      localStorage.clear();
      localStorage.setItem('docgen_profiles', JSON.stringify(profiles));
      localStorage.setItem('docgen_active_profile_id', activeProfileId);
      localStorage.setItem('docgen_leads', JSON.stringify(leads));
      localStorage.setItem('docgen_follow_ups', JSON.stringify(followUps));
      localStorage.setItem('docgen_customers', JSON.stringify(customers));
      localStorage.setItem('docgen_documents', JSON.stringify(documents));
      localStorage.setItem('docgen_document_items', JSON.stringify(documentItems));
      localStorage.setItem('docgen_theme', 'light');
      if (role) {
        localStorage.setItem('docgen_simulated_role', role);
      }
    },
    {
      profiles,
      activeProfileId,
      leads,
      followUps,
      customers,
      documents,
      documentItems,
      role: options.simulatedRole
    }
  );

  await page.goto('/billing/');
  await page.waitForLoadState('domcontentloaded');
  // Wait for sidebar to be rendered
  await expect(page.locator('aside.sidebar')).toBeVisible({ timeout: 15000 });
}

export async function navigateToTab(page: Page, tabName: 'dashboard' | 'leads' | 'follow-ups' | 'customers' | 'documents' | 'calendar') {
  const labelMap: Record<string, string> = {
    'dashboard': 'Dashboard',
    'leads': 'Leads',
    'follow-ups': 'Follow-ups',
    'customers': 'Customers',
    'documents': 'Doc Gen',
    'calendar': 'Calendar'
  };

  const text = labelMap[tabName];
  const navBtn = page.locator(`aside.sidebar button:has(.nav-label:has-text("${text}"))`);
  await expect(navBtn).toBeVisible({ timeout: 5000 });
  await navBtn.click();
  // Brief stabilization wait
  await page.waitForTimeout(300);
}

export async function switchCompanyProfile(page: Page, companyName: string) {
  // Click on the company profile dropdown button in sidebar
  const profileButton = page.locator('aside.sidebar button:has(.lucide-chevron-down)');
  await profileButton.click();
  await page.waitForTimeout(200);
  
  // Select the company button inside dropdown panel
  const targetCompany = page.locator(`button:has-text("${companyName}")`).first();
  await targetCompany.click();
  await page.waitForTimeout(500);
}
