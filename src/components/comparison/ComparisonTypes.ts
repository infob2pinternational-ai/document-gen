export type ComparisonColumnType = 'text' | 'number' | 'currency' | 'date' | 'dropdown' | 'remarks' | 'formula';

export interface ComparisonColumn {
  id: string;
  name: string;
  type: ComparisonColumnType;
  width: number; // Column width in pixels
  visible: boolean;
  formulaConfig?: {
    operator: 'multiply';
    colA: string; // Source Column ID A
    colB: string; // Source Column ID B
  };
  dropdownOptions?: string[]; // Comma-separated list of choices
}

export interface ComparisonOption {
  id: string;
  name: string;
  heading: string;
  description: string;
  isRecommended: boolean;
  columns: ComparisonColumn[];
  rows: Record<string, any>[]; // Key is column ID, value is string | number
  sumColumnId: string; // Column ID selected to calculate the total
  totalLabel: string; // Customizable total label text (e.g. "Grand Total")
  showTotal: boolean; // Option to show or hide the section total
  totalValue: number; // Sum of the selected sum column across all rows
}

export interface ComparisonConfig {
  layout: 'stacked' | 'side-by-side';
  selectedOptionId: string; // ID of the option representing the document's total
  options: ComparisonOption[];
  themeColor: string; // Custom header accent theme
  notes?: string;
  terms?: string;
}

export interface ComparisonTemplate {
  id: string;
  company_id: string;
  name: string;
  template_config: ComparisonConfig;
  created_at?: string;
}
