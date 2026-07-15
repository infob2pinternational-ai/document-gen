import { supabase } from '../../services/db';
import type { ComparisonConfig, ComparisonTemplate } from './ComparisonTypes';

// Helper to check if we should read/write to Supabase or local storage
const useCloud = (): boolean => {
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
    if (useCloud() && supabase) {
      const { data, error } = await supabase
        .from('comparison_document_data')
        .select('options_data')
        .eq('document_id', documentId)
        .maybeSingle();
      
      if (error) {
        console.error('Error fetching comparison document data:', error);
        throw error;
      }
      return data ? (data.options_data as ComparisonConfig) : null;
    } else {
      return getLocal<ComparisonConfig | null>(`comparison_doc_${documentId}`, null);
    }
  },

  /**
   * Saves or updates the options data for a comparison quotation document.
   */
  async saveComparisonData(documentId: string, optionsData: ComparisonConfig): Promise<void> {
    if (useCloud() && supabase) {
      // Check if data already exists for this document_id
      const { data: existing, error: checkError } = await supabase
        .from('comparison_document_data')
        .select('id')
        .eq('document_id', documentId)
        .maybeSingle();

      if (checkError) {
        console.error('Error checking comparison data existence:', checkError);
        throw checkError;
      }

      if (existing) {
        const { error } = await supabase
          .from('comparison_document_data')
          .update({ options_data: optionsData })
          .eq('document_id', documentId);
        
        if (error) {
          console.error('Error updating comparison data:', error);
          throw error;
        }
      } else {
        const { error } = await supabase
          .from('comparison_document_data')
          .insert([{ document_id: documentId, options_data: optionsData }]);
        
        if (error) {
          console.error('Error inserting comparison data:', error);
          throw error;
        }
      }
    } else {
      setLocal(`comparison_doc_${documentId}`, optionsData);
    }
  },

  /**
   * Deletes comparison quotation options data when the document is deleted.
   */
  async deleteComparisonData(documentId: string): Promise<void> {
    if (useCloud() && supabase) {
      const { error } = await supabase
        .from('comparison_document_data')
        .delete()
        .eq('document_id', documentId);
      
      if (error) console.error('Error deleting comparison data:', error);
    } else {
      localStorage.removeItem(`docgen_comparison_doc_${documentId}`);
    }
  },

  /**
   * Fetches all comparison templates for a given company profile.
   */
  async getComparisonTemplates(companyId: string): Promise<ComparisonTemplate[]> {
    if (useCloud() && supabase) {
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
    
    if (useCloud() && supabase) {
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
    if (useCloud() && supabase) {
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
