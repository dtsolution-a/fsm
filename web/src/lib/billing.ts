export const invTone = (s: string) => (({ draft: 'slate', unpaid: 'amber', partially_paid: 'blue', paid: 'green', overdue: 'red', cancelled: 'slate' }) as Record<string, 'slate' | 'amber' | 'blue' | 'green' | 'red'>)[s] || 'slate';
export const invLabel = (s: string) => s.replace('_', ' ');
