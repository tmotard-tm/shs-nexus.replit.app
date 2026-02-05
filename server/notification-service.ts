// Notification service - wraps communication service for specific notification types
// This file exists to avoid circular imports between email-service and communication-service

import { sendCommunication } from "./communication-service";

interface ToolAuditNotificationParams {
  email: string;
  firstName: string;
  technicianName: string;
  lastDay: string;
  ldapId: string;
}

export async function sendToolAuditNotification(params: ToolAuditNotificationParams): Promise<{
  success: boolean;
  testMode: boolean;
  intendedRecipient: string;
  actualRecipient: string;
  error?: string;
}> {
  console.log(`[TOOL AUDIT EMAIL] Using Communication Hub for template-based sending`);
  
  const result = await sendCommunication({
    templateName: 'tool-audit-notification',
    recipient: params.email,
    variables: {
      firstName: params.firstName,
      technicianName: params.technicianName,
      lastDay: params.lastDay,
      ldapId: params.ldapId,
    },
    metadata: {
      source: 'tool-audit-notification',
      ldapId: params.ldapId,
    },
    sentBy: 'system',
  });

  return {
    success: result.success,
    testMode: result.status === 'simulated',
    intendedRecipient: result.intendedRecipient,
    actualRecipient: result.actualRecipient || 'none',
    error: result.error,
  };
}

interface CreditCardDeactivationParams {
  name: string;
  employeeId: string;
  racfId: string;
  lastDayWorked: string;
  reason: string;
}

export async function sendCreditCardDeactivationNotification(params: CreditCardDeactivationParams): Promise<{
  success: boolean;
  status: string;
  error?: string;
}> {
  console.log(`[CREDIT CARD DEACTIVATION] Using Communication Hub for template-based sending`);
  
  const result = await sendCommunication({
    templateName: 'credit-card-deactivation',
    recipient: 'onecardhelpdesk@transformco.com',
    variables: {
      name: params.name,
      employeeId: params.employeeId,
      racfId: params.racfId,
      lastDayWorked: params.lastDayWorked,
      reason: params.reason,
    },
    metadata: {
      source: 'credit-card-deactivation',
      employeeId: params.employeeId,
    },
    sentBy: 'system',
  });

  return {
    success: result.success,
    status: result.status,
    error: result.error,
  };
}
