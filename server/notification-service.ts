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
    sentBy: undefined,
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

interface Phase2NotificationParams {
  techName: string;
  employeeId: string;
  vehicleNumber: string;
  vehicleType: string;
  workflowId: string;
  recipients: string[];
}

export async function sendPhase2TasksCreatedNotification(params: Phase2NotificationParams): Promise<{
  success: boolean;
  results: Array<{ recipient: string; status: string; error?: string }>;
}> {
  console.log(`[PHASE 2 NOTIFICATION] Sending Phase 2 tasks created notification for ${params.techName}`);
  
  if (params.recipients.length === 0) {
    console.log(`[PHASE 2 NOTIFICATION] No recipients configured, skipping notification`);
    return { success: true, results: [] };
  }

  const vehicleTypeLabel = params.vehicleType === 'byov' ? 'BYOV' 
    : params.vehicleType === 'rental' ? 'Rental' 
    : 'Company Fleet';

  const results: Array<{ recipient: string; status: string; error?: string }> = [];

  for (const recipient of params.recipients) {
    try {
      const result = await sendCommunication({
        templateName: 'phase2-tasks-created',
        recipient,
        variables: {
          techName: params.techName,
          employeeId: params.employeeId,
          vehicleNumber: params.vehicleNumber,
          vehicleType: vehicleTypeLabel,
        },
        metadata: {
          source: 'phase2-tasks-created',
          workflowId: params.workflowId,
          techName: params.techName,
        },
        sentBy: undefined,
      });
      results.push({ recipient, status: result.status, error: result.error });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      results.push({ recipient, status: 'failed', error: errorMsg });
    }
  }

  const successCount = results.filter(r => r.status === 'sent' || r.status === 'simulated').length;
  console.log(`[PHASE 2 NOTIFICATION] Sent to ${successCount}/${params.recipients.length} recipients`);

  return { success: true, results };
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
    sentBy: undefined,
  });

  return {
    success: result.success,
    status: result.status,
    error: result.error,
  };
}
