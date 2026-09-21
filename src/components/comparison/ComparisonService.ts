import { supabase } from '../../services/db';
import type { ComparisonConfig, ComparisonTemplate } from './ComparisonTypes';

// Helper to check if we should read/write to Supabase or local storage
const isCloudEnabled = (): boolean => {
  if (!supabase) return false;
  const storedUser = localStorage.getItem('supabase_user');
  return !!storedUser;
};

// Local storage helper
const getLocal = <T>(key: string, defaultValue: T): T => {
  const data = localStorage.getItem(`docgen_${key}`);
  return data ? JSON.parse(data) : defaultValue;
};

const setLocal = <T>(key: string, value: T): void => {
  localStorage.setItem(`docgen_${key}`, JSON.stringify(value));
};

export const ComparisonService = {
  /**
   * Fetches the options data for a specific comparison quotation document.
   */
  async getComparisonData(documentId: string): Promise<ComparisonConfig | null> {
    if (supabase && !isCloudEnabled()) throw new Error('Please sign in again to load comparison details.');
    if (isCloudEnabled() && supabase) {
      const { data, error } = await supabase
        .from('comparison_document_data')
        .select('options_data')
        .eq('document_id', documentId)
        .maybeSingle();
      
      if (error) {
        console.error('Error fetching comparison document data:', error);
        throw error;
      }
      if (data?.options_data) {
        setLocal(`comparison_doc_${documentId}`, data.options_data);
        return data.options_data as ComparisonConfig;
      }
      return null;
    } else {
      return getLocal<ComparisonConfig | null>(`comparison_doc_${documentId}`, null);
    }
  },

  /**
   * Saves or updates the options data for a comparison quotation document.
   */
  /**
   * Fetches all comparison templates for a given company profile.
   */
  async getComparisonTemplates(companyId: string): Promise<ComparisonTemplate[]> {
    if (isCloudEnabled() && supabase) {
      const { data, error } = await supabase
        .from('comparison_templates')
        .select('*')
        .eq('company_id', companyId)
        .order('name', { ascending: true });
      
      if (error) {
        console.error('Error fetching comparison templates:', error);
        throw error;
      }
      return data || [];
    } else {
      return getLocal<ComparisonTemplate[]>(`comparison_templates_${companyId}`, []);
    }
  },

  /**
   * Saves a new comparison template to the database.
   */
  async saveComparisonTemplate(companyId: string, name: string, config: ComparisonConfig): Promise<ComparisonTemplate> {
    const userStr = localStorage.getItem('supabase_user');
    const userId = userStr ? JSON.parse(userStr).id : null;
    
    if (isCloudEnabled() && supabase) {
      const payload = {
        user_id: userId,
        company_id: companyId,
        name,
        template_config: config
      };

      const { data, error } = await supabase
        .from('comparison_templates')
        .insert([payload])
        .select()
        .single();
      
      if (error) {
        console.error('Error saving comparison template:', error);
        throw error;
      }
      return data;
    } else {
      const localTemplates = getLocal<ComparisonTemplate[]>(`comparison_templates_${companyId}`, []);
      const newTemplate: ComparisonTemplate = {
        id: 'tpl_' + Math.random().toString(36).substring(2, 9),
        company_id: companyId,
        name,
        template_config: config,
        created_at: new Date().toISOString()
      };
      localTemplates.push(newTemplate);
      setLocal(`comparison_templates_${companyId}`, localTemplates);
      return newTemplate;
    }
  },

  /**
   * Deletes a comparison template by ID.
   */
  async deleteComparisonTemplate(companyId: string, templateId: string): Promise<void> {
    if (isCloudEnabled() && supabase) {
      const { error } = await supabase
        .from('comparison_templates')
        .delete()
        .eq('id', templateId);
      
      if (error) {
        console.error('Error deleting comparison template:', error);
        throw error;
      }
    } else {
      const localTemplates = getLocal<ComparisonTemplate[]>(`comparison_templates_${companyId}`, []);
      const updated = localTemplates.filter(t => t.id !== templateId);
      setLocal(`comparison_templates_${companyId}`, updated);
    }
  }
};
