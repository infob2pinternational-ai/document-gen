// Original completion method from 3aed419203cae9ec9eeae97ca184ec66a42717da.
// Only its surrounding dependencies are supplied by the database test.
export function legacyCompletionClient({getLocal,persistOfficeRow,leadService,syncLeadNextFollowUpAt}: any) {
  const FOLLOW_UPS_KEY = "docgen_follow_ups";
  const SEED_FOLLOW_UPS: any[] = [];
  type FollowUp = any;
  return { syncLeadNextFollowUpAt,
  async completeFollowUp(id: string, completionNote: string, userEmail: string): Promise<FollowUp | null> {
    const list = getLocal<FollowUp[]>(FOLLOW_UPS_KEY, SEED_FOLLOW_UPS);
    const idx = list.findIndex(f => f.id === id);
    if (idx < 0) return null;

    const current = list[idx];
    current.status = 'COMPLETED';
    current.completed_at = new Date().toISOString();
    current.completion_note = completionNote;

    list[idx] = current;
    await persistOfficeRow(FOLLOW_UPS_KEY, 'follow_ups', list, current);

    // Sync lead's next_follow_up_at
    if (current.lead_id) {
      const syncCompanyId = (current.company_id && current.company_id !== 'default')
        ? current.company_id
        : (leadService.getActiveCompany() && leadService.getActiveCompany() !== 'default'
            ? leadService.getActiveCompany()!
            : undefined);
      if (syncCompanyId) {
        await this.syncLeadNextFollowUpAt(current.lead_id, syncCompanyId);
      }
    }

    // Log to lead activity if linked
    if (current.lead_id) {
      const activityCompanyId = (current.company_id && current.company_id !== 'default')
        ? current.company_id
        : (leadService.getActiveCompany() && leadService.getActiveCompany() !== 'default'
            ? leadService.getActiveCompany()!
            : undefined);

      if (activityCompanyId) {
        await leadService.addLeadActivity({
          lead_id: current.lead_id,
          company_id: activityCompanyId,
          user_email: userEmail,
          action: 'Follow-up Completed',
          note: `Completed follow-up: "${current.reason}". Note: ${completionNote || 'No completion remarks.'}`
        });
      }
    }

    return current;
  },

  };
}
