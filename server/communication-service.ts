import { storage } from "./storage";
import { sendEmail } from "./email-service";
import type { CommunicationTemplate, CommunicationLog, InsertCommunicationLog } from "@shared/schema";

interface SendResult {
  success: boolean;
  status: 'sent' | 'simulated' | 'blocked' | 'failed';
  logId: string;
  error?: string;
  intendedRecipient: string;
  actualRecipient?: string;
}

interface SendOptions {
  templateName: string;
  recipient: string;
  variables: Record<string, string>;
  metadata?: Record<string, any>;
  sentBy?: string;
}

function renderTemplate(content: string, variables: Record<string, string>): string {
  let rendered = content;
  for (const [key, value] of Object.entries(variables)) {
    const regex = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}|\\$\\{${key}\\}|\\[${key}\\]`, 'gi');
    rendered = rendered.replace(regex, value || '');
  }
  return rendered;
}

export async function sendCommunication(options: SendOptions): Promise<SendResult> {
  const { templateName, recipient, variables, metadata, sentBy } = options;

  const template = await storage.getCommunicationTemplateByName(templateName);
  
  if (!template) {
    console.error(`[COMMUNICATION] Template not found: ${templateName}`);
    const log = await storage.createCommunicationLog({
      templateId: null,
      templateName,
      type: 'email',
      mode: 'simulated',
      status: 'failed',
      intendedRecipient: recipient,
      actualRecipient: null,
      subject: null,
      contentPreview: null,
      variables: variables as any,
      errorMessage: `Template "${templateName}" not found`,
      metadata: metadata as any,
      sentBy: sentBy || null,
    });
    return {
      success: false,
      status: 'failed',
      logId: log.id,
      error: `Template "${templateName}" not found`,
      intendedRecipient: recipient,
    };
  }

  if (!template.isActive) {
    console.log(`[COMMUNICATION] Template "${templateName}" is inactive, skipping`);
    const log = await storage.createCommunicationLog({
      templateId: template.id,
      templateName,
      type: template.type,
      mode: template.mode,
      status: 'blocked',
      intendedRecipient: recipient,
      actualRecipient: null,
      subject: template.subject ? renderTemplate(template.subject, variables) : null,
      contentPreview: null,
      variables: variables as any,
      errorMessage: 'Template is inactive',
      metadata: metadata as any,
      sentBy: sentBy || null,
    });
    return {
      success: false,
      status: 'blocked',
      logId: log.id,
      error: 'Template is inactive',
      intendedRecipient: recipient,
    };
  }

  const renderedSubject = template.subject ? renderTemplate(template.subject, variables) : null;
  const renderedHtml = template.htmlContent ? renderTemplate(template.htmlContent, variables) : null;
  const renderedText = renderTemplate(template.textContent, variables);
  const contentPreview = renderedText.substring(0, 500);

  const mode = template.mode as 'simulated' | 'whitelisted' | 'live';
  let status: 'sent' | 'simulated' | 'blocked' | 'failed' = 'simulated';
  let actualRecipient: string | null = null;
  let errorMessage: string | null = null;

  if (mode === 'simulated') {
    console.log(`[COMMUNICATION - SIMULATED] Would send ${template.type} to: ${recipient}`);
    console.log(`[COMMUNICATION - SIMULATED] Subject: ${renderedSubject}`);
    console.log(`[COMMUNICATION - SIMULATED] Content preview: ${contentPreview.substring(0, 200)}...`);
    status = 'simulated';
    actualRecipient = null;
  } else if (mode === 'whitelisted') {
    const whitelistType = template.type === 'email' ? 'email' : 'phone';
    const whitelistEntries = await storage.getWhitelistEntriesByType(whitelistType);
    
    if (whitelistEntries.length === 0) {
      console.log(`[COMMUNICATION - BLOCKED] No ${whitelistType} addresses in whitelist`);
      status = 'blocked';
      errorMessage = `No ${whitelistType} addresses in whitelist. Add at least one to test.`;
    } else {
      const whitelistAddresses = whitelistEntries.map(e => e.value);
      console.log(`[COMMUNICATION - WHITELISTED] Original recipient: ${recipient}. Redirecting to whitelisted addresses: ${whitelistAddresses.join(', ')}`);
      
      if (template.type === 'email') {
        let allSent = true;
        const sentTo: string[] = [];
        for (const whitelistAddr of whitelistAddresses) {
          const sent = await sendEmail({
            to: whitelistAddr,
            from: 'stephen.wong@transformco.com',
            subject: `[TEST - Original recipient: ${recipient}] ${renderedSubject || 'Notification'}`,
            html: renderedHtml || undefined,
            text: renderedText,
          });
          if (sent) {
            sentTo.push(whitelistAddr);
          } else {
            allSent = false;
          }
        }
        status = sentTo.length > 0 ? 'sent' : 'failed';
        actualRecipient = sentTo.length > 0 ? sentTo.join(', ') : null;
        if (!allSent) errorMessage = `Some deliveries failed. Sent to: ${sentTo.join(', ')}`;
      } else {
        console.log(`[COMMUNICATION] SMS not yet implemented`);
        status = 'simulated';
        errorMessage = 'SMS not yet implemented';
      }
    }
  } else if (mode === 'live') {
    console.log(`[COMMUNICATION - LIVE] Sending ${template.type} to: ${recipient}`);
    
    if (template.type === 'email') {
      const sent = await sendEmail({
        to: recipient,
        from: 'stephen.wong@transformco.com',
        subject: renderedSubject || 'Notification',
        html: renderedHtml || undefined,
        text: renderedText,
      });
      status = sent ? 'sent' : 'failed';
      actualRecipient = sent ? recipient : null;
      if (!sent) errorMessage = 'Email delivery failed';
    } else {
      console.log(`[COMMUNICATION] SMS not yet implemented`);
      status = 'simulated';
      errorMessage = 'SMS not yet implemented';
    }
  }

  const log = await storage.createCommunicationLog({
    templateId: template.id,
    templateName,
    type: template.type,
    mode: template.mode,
    status,
    intendedRecipient: recipient,
    actualRecipient,
    subject: renderedSubject,
    contentPreview,
    variables: variables as any,
    errorMessage,
    metadata: metadata as any,
    sentBy: sentBy || null,
  });

  return {
    success: status === 'sent' || status === 'simulated',
    status,
    logId: log.id,
    error: errorMessage || undefined,
    intendedRecipient: recipient,
    actualRecipient: actualRecipient || undefined,
  };
}

export async function getTemplatePreview(
  templateName: string,
  variables: Record<string, string>
): Promise<{ subject: string | null; html: string | null; text: string } | null> {
  const template = await storage.getCommunicationTemplateByName(templateName);
  if (!template) return null;

  return {
    subject: template.subject ? renderTemplate(template.subject, variables) : null,
    html: template.htmlContent ? renderTemplate(template.htmlContent, variables) : null,
    text: renderTemplate(template.textContent, variables),
  };
}

export async function seedDefaultTemplates(): Promise<number> {
  const existingTemplates = await storage.getCommunicationTemplates();
  const existingNames = new Set(existingTemplates.map(t => t.name));

  const defaultTemplates = [
    {
      name: 'tool-audit-notification',
      description: 'Sent to technicians when they need to complete a tool audit before their last day',
      type: 'email',
      mode: 'simulated',
      subject: 'Action Required: Complete Your Tool Audit Before {{lastDay}}',
      htmlContent: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); padding: 30px; border-radius: 8px 8px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 24px;">Tool Audit Required</h1>
  </div>
  
  <div style="background: #f8fafc; padding: 30px; border: 1px solid #e2e8f0; border-top: none;">
    <p>Hello {{firstName}},</p>
    
    <p>As a reminder, you acknowledged the Policy and Acknowledgment for Company-Provided Technician Tools, either during onboarding (for technicians hired after policy launch) or via Segno (for incumbents).</p>
    
    <p>Under the Policy, technicians are responsible for:</p>
    <ul style="margin: 10px 0 20px 20px; color: #333;">
      <li>Safeguarding company-provided tools</li>
      <li>Returning all company-provided tools upon separation</li>
      <li>Notifying their supervisor of any lost or damaged tools</li>
      <li>Reimbursing the Company for the replacement value of any tools not returned, in accordance with the Policy and applicable state law</li>
    </ul>
    
    <p>To ensure an accurate inventory and a smooth offboarding process, please complete the Tool Audit form by <strong>{{lastDay}}</strong>:</p>
    
    <div style="text-align: center; margin: 30px 0;">
      <a href="https://tech-tool-audit-checklist-lucabuccilli1.replit.app?ldap={{ldapId}}" 
         style="background: #2563eb; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
        Complete Tool Audit
      </a>
    </div>
    
    <p style="color: #64748b; font-size: 14px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e2e8f0;">
      Completing this audit helps verify your current inventory and determine whether any follow-up is required under the Policy.
    </p>
    
    <p style="color: #64748b; font-size: 12px; margin-top: 20px;">
      This is an automated message from the Nexus Offboarding System. If you have questions, please contact your supervisor.
    </p>
  </div>
</body>
</html>`,
      textContent: `Hello {{firstName}},

As a reminder, you acknowledged the Policy and Acknowledgment for Company-Provided Technician Tools, either during onboarding (for technicians hired after policy launch) or via Segno (for incumbents).

Under the Policy, technicians are responsible for:
- Safeguarding company-provided tools
- Returning all company-provided tools upon separation
- Notifying their supervisor of any lost or damaged tools
- Reimbursing the Company for the replacement value of any tools not returned, in accordance with the Policy and applicable state law

To ensure an accurate inventory and a smooth offboarding process, please complete the Tool Audit form by {{lastDay}}:

https://tech-tool-audit-checklist-lucabuccilli1.replit.app?ldap={{ldapId}}

Completing this audit helps verify your current inventory and determine whether any follow-up is required under the Policy.

This is an automated message from the Nexus Offboarding System. If you have questions, please contact your supervisor.`,
      variables: ['firstName', 'lastDay', 'ldapId'],
      isActive: true,
    },
    {
      name: 'credit-card-deactivation',
      description: 'Request to OneCard Help Desk to deactivate terminated employee credit cards',
      type: 'email',
      mode: 'simulated',
      subject: 'Credit Card Deactivation Request - Employee Termination: {{employeeName}}',
      htmlContent: `<!DOCTYPE html>
<html>
<body style="font-family: Arial, sans-serif; color: #333;">
  <h2 style="color: #d32f2f;">Credit Card Deactivation Request</h2>
  <p><strong>Employee Termination Notice</strong></p>
  
  <p>Dear OneCard Help Desk,</p>
  
  <p>Please deactivate the credit card for the following terminated employee:</p>
  
  <table style="border-collapse: collapse; margin: 20px 0;">
    <tr>
      <td style="padding: 8px; font-weight: bold; border-bottom: 1px solid #ddd;">Employee Name:</td>
      <td style="padding: 8px; border-bottom: 1px solid #ddd;">{{employeeName}}</td>
    </tr>
    <tr>
      <td style="padding: 8px; font-weight: bold; border-bottom: 1px solid #ddd;">Employee ID:</td>
      <td style="padding: 8px; border-bottom: 1px solid #ddd;">{{employeeId}}</td>
    </tr>
    <tr>
      <td style="padding: 8px; font-weight: bold; border-bottom: 1px solid #ddd;">Enterprise ID:</td>
      <td style="padding: 8px; border-bottom: 1px solid #ddd;">{{enterpriseId}}</td>
    </tr>
    <tr>
      <td style="padding: 8px; font-weight: bold; border-bottom: 1px solid #ddd;">Last Day Worked:</td>
      <td style="padding: 8px; border-bottom: 1px solid #ddd;">{{lastDay}}</td>
    </tr>
    <tr>
      <td style="padding: 8px; font-weight: bold; border-bottom: 1px solid #ddd;">Termination Reason:</td>
      <td style="padding: 8px; border-bottom: 1px solid #ddd;">{{reason}}</td>
    </tr>
  </table>
  
  <p style="color: #d32f2f; font-weight: bold;">Please process this request immediately to prevent unauthorized usage.</p>
  
  <p style="font-size: 12px; color: #666; margin-top: 30px;">
    This is an automated notification from the Nexus Offboarding System.
  </p>
</body>
</html>`,
      textContent: `Dear OneCard Help Desk,

Please deactivate the credit card for the following terminated employee:

Employee Name: {{employeeName}}
Employee ID: {{employeeId}}
Enterprise ID: {{enterpriseId}}
Last Day Worked: {{lastDay}}
Termination Reason: {{reason}}

Please process this request immediately to prevent unauthorized usage.

This is an automated notification from the Nexus Offboarding System.`,
      variables: ['employeeName', 'employeeId', 'enterpriseId', 'lastDay', 'reason'],
      isActive: true,
    },
    {
      name: 'password-reset',
      description: 'Password reset link for Nexus portal users',
      type: 'email',
      mode: 'simulated',
      subject: 'Password Reset Request - Nexus Portal',
      htmlContent: `<!DOCTYPE html>
<html>
<body style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto;">
  <h2 style="color: #1e40af;">Password Reset Request</h2>
  
  <p>Hello,</p>
  
  <p>We received a request to reset your password for the Nexus Portal.</p>
  
  <p>Click the button below to reset your password:</p>
  
  <div style="text-align: center; margin: 30px 0;">
    <a href="{{resetLink}}" 
       style="background: #2563eb; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: bold;">
      Reset Password
    </a>
  </div>
  
  <p style="color: #64748b; font-size: 14px;">
    This link will expire in 1 hour. If you didn't request a password reset, you can safely ignore this email.
  </p>
  
  <p style="color: #64748b; font-size: 12px; margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 20px;">
    This is an automated message from the Nexus Portal.
  </p>
</body>
</html>`,
      textContent: `Password Reset Request

We received a request to reset your password for the Nexus Portal.

Click the link below to reset your password:
{{resetLink}}

This link will expire in 1 hour. If you didn't request a password reset, you can safely ignore this email.

This is an automated message from the Nexus Portal.`,
      variables: ['resetLink'],
      isActive: true,
    },
    {
      name: 'phase2-tasks-created',
      description: 'Notifies Fleet team when all Day 0 offboarding tasks are completed and Phase 2 tasks have been auto-generated',
      type: 'email',
      mode: 'simulated',
      subject: 'Phase 2 Tasks Created: Vehicle Retrieval for {{techName}}',
      htmlContent: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #059669 0%, #10b981 100%); padding: 30px; border-radius: 8px 8px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 24px;">Phase 2 Tasks Created</h1>
    <p style="color: #d1fae5; margin: 8px 0 0 0; font-size: 14px;">All Day 0 offboarding tasks completed</p>
  </div>
  
  <div style="background: #f8fafc; padding: 30px; border: 1px solid #e2e8f0; border-top: none;">
    <p>All <strong>5 Day 0 offboarding tasks</strong> have been completed for <strong>{{techName}}</strong>. Phase 2 Fleet tasks have been automatically created and are ready for action.</p>
    
    <table style="border-collapse: collapse; margin: 20px 0; width: 100%;">
      <tr>
        <td style="padding: 10px; font-weight: bold; border-bottom: 1px solid #e2e8f0; width: 40%;">Technician:</td>
        <td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">{{techName}}</td>
      </tr>
      <tr>
        <td style="padding: 10px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">Employee ID:</td>
        <td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">{{employeeId}}</td>
      </tr>
      <tr>
        <td style="padding: 10px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">Vehicle:</td>
        <td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">{{vehicleNumber}}</td>
      </tr>
      <tr>
        <td style="padding: 10px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">Vehicle Type:</td>
        <td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">{{vehicleType}}</td>
      </tr>
    </table>

    <h3 style="color: #059669; margin-top: 25px;">New Phase 2 Tasks:</h3>
    <ol style="padding-left: 20px;">
      <li style="margin-bottom: 8px;"><strong>Vehicle Retrieval</strong> (Day 1-3) — Retrieve vehicle from technician and transport to appropriate location</li>
      <li style="margin-bottom: 8px;"><strong>Shop Coordination</strong> (Day 3-5) — Process vehicle at service center for maintenance and reassignment prep</li>
    </ol>

    <p style="margin-top: 25px;">Please log in to <strong>Nexus</strong> to view and manage these tasks in the Fleet queue.</p>
    
    <p style="color: #64748b; font-size: 12px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e2e8f0;">
      This is an automated message from the Nexus Offboarding System. Phase 2 tasks were triggered automatically upon completion of all Day 0 tasks.
    </p>
  </div>
</body>
</html>`,
      textContent: `Phase 2 Tasks Created - All Day 0 Offboarding Complete

All 5 Day 0 offboarding tasks have been completed for {{techName}}. Phase 2 Fleet tasks have been automatically created.

Technician: {{techName}}
Employee ID: {{employeeId}}
Vehicle: {{vehicleNumber}}
Vehicle Type: {{vehicleType}}

New Phase 2 Tasks:
1. Vehicle Retrieval (Day 1-3) - Retrieve vehicle from technician
2. Shop Coordination (Day 3-5) - Process vehicle at service center

Please log in to Nexus to manage these tasks in the Fleet queue.

This is an automated message from the Nexus Offboarding System.`,
      variables: ['techName', 'employeeId', 'vehicleNumber', 'vehicleType'],
      isActive: true,
    },
  ];

  let seeded = 0;
  for (const template of defaultTemplates) {
    if (!existingNames.has(template.name)) {
      await storage.createCommunicationTemplate(template as any);
      seeded++;
      console.log(`[COMMUNICATION] Seeded missing template: ${template.name}`);
    }
  }

  if (seeded === 0) {
    console.log(`[COMMUNICATION] All default templates already exist`);
  } else {
    console.log(`[COMMUNICATION] Seeded ${seeded} default templates`);
  }
  return seeded;
}
