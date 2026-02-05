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
    const isWhitelisted = await storage.isInWhitelist(whitelistType, recipient);
    
    if (!isWhitelisted) {
      console.log(`[COMMUNICATION - BLOCKED] Recipient not in whitelist: ${recipient}`);
      status = 'blocked';
      errorMessage = `Recipient "${recipient}" is not in the ${whitelistType} whitelist`;
    } else {
      console.log(`[COMMUNICATION - WHITELISTED] Sending to whitelisted recipient: ${recipient}`);
      
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
  if (existingTemplates.length > 0) {
    console.log(`[COMMUNICATION] Found ${existingTemplates.length} existing templates, skipping seed`);
    return 0;
  }

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
    
    <p>As part of your offboarding process, you are required to complete a <strong>Tool Audit</strong> before your last day on <strong>{{lastDay}}</strong>.</p>
    
    <p>This audit helps us ensure all company-issued tools and equipment are properly accounted for. Please complete this as soon as possible.</p>
    
    <div style="text-align: center; margin: 30px 0;">
      <a href="https://tech-tool-audit-checklist-lucabuccilli1.replit.app?ldap={{ldapId}}" 
         style="background: #2563eb; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
        Complete Tool Audit
      </a>
    </div>
    
    <p style="color: #64748b; font-size: 14px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e2e8f0;">
      <strong>Important:</strong> Per company policy, you are responsible for all tools issued to you. Any missing or damaged tools may result in payroll deductions.
    </p>
    
    <p style="color: #64748b; font-size: 12px; margin-top: 20px;">
      This is an automated message from the Nexus Offboarding System. If you have questions, please contact your supervisor.
    </p>
  </div>
</body>
</html>`,
      textContent: `Hello {{firstName}},

As part of your offboarding process, you are required to complete a Tool Audit before your last day on {{lastDay}}.

Please complete the audit at: https://tech-tool-audit-checklist-lucabuccilli1.replit.app?ldap={{ldapId}}

Important: Per company policy, you are responsible for all tools issued to you. Any missing or damaged tools may result in payroll deductions.

This is an automated message from the Nexus Offboarding System.`,
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
  ];

  let seeded = 0;
  for (const template of defaultTemplates) {
    await storage.createCommunicationTemplate(template as any);
    seeded++;
  }

  console.log(`[COMMUNICATION] Seeded ${seeded} default templates`);
  return seeded;
}
