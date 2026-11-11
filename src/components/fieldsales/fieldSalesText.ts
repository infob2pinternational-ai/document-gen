import { REQUIREMENT_OPTIONS } from '../../services/fieldVisitService';
import type { RequirementKey } from '../../services/fieldVisitService';

export const requirementText = (requirements: RequirementKey[] = [], other?: string | null) =>
  [...requirements].sort((a, b) => REQUIREMENT_OPTIONS.findIndex(o => o.value === a) - REQUIREMENT_OPTIONS.findIndex(o => o.value === b)).map(key => {
    const label = REQUIREMENT_OPTIONS.find(option => option.value === key)?.label || key;
    return key === 'other' && other ? `Other: ${other}` : label;
  }).join(', ');
export const EVENT_LABEL: Record<string, string> = {
  submitted: 'Submitted', updated: 'Updated before review', resubmitted: 'Corrected and resubmitted', approved: 'Approved',
  rejected: 'Rejected', correction_requested: 'Sent back for correction', converted_new_lead: 'Converted to a new lead',
  converted_linked_lead: 'Linked to an existing lead'
};
