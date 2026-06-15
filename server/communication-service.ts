import { storage } from "./storage";
import { sendEmail } from "./email-service";
import { sendTwilioMessage } from "./fleet-scope-reg-messaging";
import type { CommunicationTemplate, CommunicationLog, InsertCommunicationLog } from "@shared/schema";

interface SendResult {
  success: boolean;
  status: 'sent' | 'simulated' | 'blocked' | 'failed';
  logId: string;
  error?: string;
  intendedRecipient: string;
  actualRecipient?: string;
  providerMessageId?: string;
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

  // Conditional blocks: {{#if key}}...{{/if}} — the inner content is kept only
  // when the variable is "truthy" (non-empty and not 'false'/'0'/'no'). Used by
  // the LOA team-notice template to render the 30+ day rows only when the leave
  // duration qualifies. Process these before plain token replacement so tokens
  // inside surviving blocks still get substituted.
  const ifRegex = /\{\{\s*#if\s+([a-zA-Z0-9_]+)\s*\}\}([\s\S]*?)\{\{\s*\/if\s*\}\}/g;
  rendered = rendered.replace(ifRegex, (_match, key: string, inner: string) => {
    const raw = variables[key];
    const truthy =
      raw !== undefined &&
      raw !== null &&
      String(raw).trim() !== '' &&
      !['false', '0', 'no'].includes(String(raw).trim().toLowerCase());
    return truthy ? inner : '';
  });

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
  let providerMessageId: string | null = null;

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
        const sentTo: string[] = [];
        const failedDetails: string[] = [];
        for (const whitelistAddr of whitelistAddresses) {
          const result = await sendEmail({
            to: whitelistAddr,
            from: 'stephen.wong@transformco.com',
            subject: `[TEST - Original recipient: ${recipient}] ${renderedSubject || 'Notification'}`,
            html: renderedHtml || undefined,
            text: renderedText,
          });
          if (result.success) {
            sentTo.push(whitelistAddr);
          } else {
            failedDetails.push(`${whitelistAddr}: ${result.error || 'Unknown error'}`);
          }
        }
        status = sentTo.length > 0 ? 'sent' : 'failed';
        actualRecipient = sentTo.length > 0 ? sentTo.join(', ') : null;
        if (failedDetails.length > 0) {
          errorMessage = failedDetails.join('; ');
          if (sentTo.length > 0) errorMessage = `Partial success (sent to: ${sentTo.join(', ')}). Failures: ${failedDetails.join('; ')}`;
        }
      } else {
        console.log(`[COMMUNICATION] SMS not yet implemented`);
        status = 'simulated';
        errorMessage = 'SMS not yet implemented';
      }
    }
  } else if (mode === 'live') {
    console.log(`[COMMUNICATION - LIVE] Sending ${template.type} to: ${recipient}`);
    
    if (template.type === 'email') {
      const result = await sendEmail({
        to: recipient,
        from: 'stephen.wong@transformco.com',
        subject: renderedSubject || 'Notification',
        html: renderedHtml || undefined,
        text: renderedText,
      });
      status = result.success ? 'sent' : 'failed';
      actualRecipient = result.success ? recipient : null;
      if (result.success) providerMessageId = result.messageId || null;
      if (!result.success) errorMessage = result.error || 'Email delivery failed';
    } else {
      try {
        const sid = await sendTwilioMessage(recipient, renderedText);
        status = 'sent';
        actualRecipient = recipient;
        providerMessageId = sid || null;
        console.log(`[COMMUNICATION - LIVE] SMS sent to ${recipient}, sid=${sid}`);
      } catch (err: any) {
        status = 'failed';
        errorMessage = err?.message || 'SMS delivery failed';
        console.error(`[COMMUNICATION - LIVE] SMS to ${recipient} failed:`, errorMessage);
      }
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
    providerMessageId: providerMessageId || undefined,
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
        name: 'recovery-pre-fleet',
        description: 'Outreach email for techs with company fleet vehicles, sent before last day — asks for tool audit completion',
        type: 'email',
        mode: 'simulated',
        subject: 'Action Required: Return Your Sears Home Services Company Equipment',
        htmlContent: `<!DOCTYPE html>
  <html>
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
  <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: linear-gradient(135deg, #2563eb 0%, #60a5fa 100%); padding: 30px; border-radius: 8px 8px 0 0;">
      <h1 style="color: white; margin: 0; font-size: 24px;">Complete Your Tool Audit</h1>
      <p style="color: #dbeafe; margin: 8px 0 0 0; font-size: 14px;">Before your last day on {{separationDate}}</p>
    </div>
    <div style="background: #f8fafc; padding: 30px; border: 1px solid #e2e8f0; border-top: none;">
      <p>Hi {{firstName}},</p>
      <p>As you prepare for your last day on <strong>{{separationDate}}</strong>, please complete your <strong>Tool Audit</strong>. Your company vehicle will be retrieved by Fleet, but we need an audit of the tools on board first.</p>

      <div style="background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 20px 0;">
        <h3 style="margin: 0 0 8px 0; color: #2563eb;">Complete Your Tool Audit</h3>
        <p style="margin: 0 0 12px 0;">This audit confirms which company-issued tools are on your truck. Please complete it as soon as possible.</p>
        <div style="text-align: center;">
          <a href="{{toolAuditLink}}" style="background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Complete Tool Audit</a>
        </div>
      </div>

      <p style="background: #f0f9ff; border-left: 4px solid #2563eb; padding: 12px; margin: 20px 0; font-size: 14px;"><strong>If you have already completed your tool audit (or used the QR shipping link if one was provided), please disregard this message.</strong></p>

      <p>Questions? Contact the Tools Recovery team.</p>
      <p>Thank you,<br>Offboarding Operations</p>
      <p style="color: #64748b; font-size: 12px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e2e8f0;">This is an automated message from the Nexus Offboarding System.</p>
    </div>
  </body>
  </html>`,
        textContent: `Hi {{firstName}},

  As you prepare for your last day on {{separationDate}}, please complete your Tool Audit. Your company vehicle will be retrieved by Fleet, but we need an audit of the tools on board first.

  Complete your Tool Audit:
  {{toolAuditLink}}

  If you have already completed your tool audit (or used the QR shipping link if one was provided), please disregard this message.

  Questions? Contact the Tools Recovery team.

  Thank you,
  Offboarding Operations`,
        variables: ['firstName', 'technicianName', 'separationDate', 'enterpriseId', 'toolAuditLink'],
        isActive: true,
      },
      {
        name: 'recovery-pre-byov',
        description: 'Outreach email for BYOV/rental techs, sent before last day — asks for tool + iPhone return via QR shipping',
        type: 'email',
        mode: 'simulated',
        subject: 'Action Required: Return Your Sears Home Services Company Equipment',
        htmlContent: `<!DOCTYPE html>
  <html>
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
  <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: linear-gradient(135deg, #2563eb 0%, #60a5fa 100%); padding: 30px; border-radius: 8px 8px 0 0;">
      <h1 style="color: white; margin: 0; font-size: 24px;">Return Your Company Tools and iPhone</h1>
      <p style="color: #dbeafe; margin: 8px 0 0 0; font-size: 14px;">Before your last day on {{separationDate}}</p>
    </div>
    <div style="background: #f8fafc; padding: 30px; border: 1px solid #e2e8f0; border-top: none;">
      <p>Hi {{firstName}},</p>
      <p>As you prepare for your last day on <strong>{{separationDate}}</strong>, please return your company-provided tools and iPhone using the steps below.</p>

      <div style="background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 20px 0;">
        <h3 style="margin: 0 0 8px 0; color: #2563eb;">STEP 1: COMPLETE YOUR TOOL AUDIT</h3>
        <p style="margin: 0 0 12px 0;">Confirm which company tools you currently have in your possession.</p>
        <div style="text-align: center;">
          <a href="{{toolAuditLink}}" style="background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Complete Tool Audit</a>
        </div>
      </div>

      <div style="background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 20px 0;">
        <h3 style="margin: 0 0 8px 0; color: #2563eb;">STEP 2: RETURN YOUR TOOLS AND iPHONE</h3>
        <p style="margin: 0 0 12px 0;">Use the link below to generate prepaid QR shipping labels (sign in at <a href="https://asset-returns.replit.app/shipping-qr/">https://asset-returns.replit.app/shipping-qr/</a>). Drop your packaged tools and iPhone at any UPS location — no cost to you.</p>
        <div style="text-align: center;">
          <a href="{{qrShippingLink}}" style="background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Generate QR Shipping Labels</a>
        </div>
        <p style="margin: 8px 0 0 0; font-size: 13px; color: #64748b; text-align: center;">Sign in with <strong>Username:</strong> your Enterprise ID (<strong>{{enterpriseId}}</strong>) <em>or</em> your truck number (<strong>{{truckNumber}}</strong>) &middot; <strong>Password:</strong> your username followed by your 4-digit district number (e.g. <strong>{{enterpriseId}}{{districtNo}}</strong> or <strong>{{truckNumber}}{{districtNo}}</strong>)</p>
      </div>

      <div style="background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 20px 0;">
        <h3 style="margin: 0 0 8px 0; color: #2563eb;">Before You Ship the iPhone</h3>
        <ol style="padding-left: 20px; margin: 0;">
          <li>Open <strong>Settings</strong> &rarr; tap your name at the top &rarr; <strong>Find My</strong> &rarr; turn <strong>OFF</strong> Find My iPhone (enter your Apple ID password).</li>
          <li>Sign out of iCloud: <strong>Settings</strong> &rarr; tap your name &rarr; <strong>Sign Out</strong>.</li>
          <li>Erase the device: <strong>Settings</strong> &rarr; <strong>General</strong> &rarr; <strong>Transfer or Reset iPhone</strong> &rarr; <strong>Erase All Content and Settings</strong>.</li>
        </ol>
        <p style="margin: 10px 0 0 0; font-size: 13px; color: #64748b;">If Activation Lock is still on when we receive the device we cannot recycle it and you may be charged for the replacement.</p>
      </div>

      <p style="background: #f0f9ff; border-left: 4px solid #2563eb; padding: 12px; margin: 20px 0; font-size: 14px;"><strong>If you have already completed your tool audit, used the QR shipping link, and shipped your tools and iPhone, please disregard this message.</strong></p>

      <p>Questions? Contact the Tools Recovery team.</p>
      <p>Thank you,<br>Offboarding Operations</p>
      <p style="color: #64748b; font-size: 12px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e2e8f0;">This is an automated message from the Nexus Offboarding System.</p>
    </div>
  </body>
  </html>`,
        textContent: `Hi {{firstName}},

  As you prepare for your last day on {{separationDate}}, please return your company-provided tools and iPhone using the steps below.

  STEP 1: COMPLETE YOUR TOOL AUDIT
  {{toolAuditLink}}

  STEP 2: RETURN YOUR TOOLS AND iPHONE
  Use the link below to generate prepaid QR shipping labels (sign in at https://asset-returns.replit.app/shipping-qr/). Drop your packaged tools and iPhone at any UPS location - no cost to you.
  {{qrShippingLink}}
  Sign in with Username: your Enterprise ID ({{enterpriseId}}) OR your truck number ({{truckNumber}}); Password: your username followed by your 4-digit district number (e.g. {{enterpriseId}}{{districtNo}} or {{truckNumber}}{{districtNo}}).

  Before you ship the iPhone:
    1. Settings > [your name] > Find My > turn OFF Find My iPhone (enter Apple ID password)
    2. Settings > [your name] > Sign Out (sign out of iCloud)
    3. Settings > General > Transfer or Reset iPhone > Erase All Content and Settings
  If Activation Lock is still on when we receive the device we cannot recycle it and you may be charged for the replacement.

  If you have already completed your tool audit, used the QR shipping link, and shipped your tools and iPhone, please disregard this message.

  Questions? Contact the Tools Recovery team.

  Thank you,
  Offboarding Operations`,
        variables: ['firstName', 'technicianName', 'separationDate', 'enterpriseId', 'truckNumber', 'districtNo', 'toolAuditLink', 'qrShippingLink'],
        isActive: true,
      },
      {
        name: 'recovery-past-email',
        description: 'Consolidated recovery email sent after last day worked — asks tech to return everything',
        type: 'email',
        mode: 'simulated',
        subject: 'Action Required: Return Your Sears Home Services Company Equipment',
        htmlContent: `<!DOCTYPE html>
  <html>
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
  <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: linear-gradient(135deg, #ea580c 0%, #fb923c 100%); padding: 30px; border-radius: 8px 8px 0 0;">
      <h1 style="color: white; margin: 0; font-size: 24px;">Return Your Company Tools and Equipment</h1>
      <p style="color: #fed7aa; margin: 8px 0 0 0; font-size: 14px;">Please complete your return promptly</p>
    </div>
    <div style="background: #f8fafc; padding: 30px; border: 1px solid #e2e8f0; border-top: none;">
      <p>Hi {{firstName}},</p>
      <p>Our records show your employment with Sears Home Services ended on <strong>{{separationDate}}</strong>. Please return your company-provided tools, iPhone, and other equipment as soon as possible using the steps below.</p>

      <div style="background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 20px 0;">
        <h3 style="margin: 0 0 8px 0; color: #ea580c;">STEP 1: COMPLETE YOUR TOOL AUDIT</h3>
        <p style="margin: 0 0 12px 0;">Confirm which company-issued tools you currently have in your possession.</p>
        <div style="text-align: center;">
          <a href="{{toolAuditLink}}" style="background: #ea580c; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Complete Tool Audit</a>
        </div>
      </div>

      <div style="background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 20px 0;">
        <h3 style="margin: 0 0 8px 0; color: #ea580c;">STEP 2: RETURN EVERYTHING</h3>
        <p style="margin: 0 0 12px 0;">Use the link below to generate prepaid QR shipping labels (sign in at <a href="https://asset-returns.replit.app/shipping-qr/">https://asset-returns.replit.app/shipping-qr/</a>). Ship back your company tools, iPhone, fuel cards, hotspot devices, and any other company-provided equipment. Drop the packages at any UPS location — no cost to you.</p>
        <div style="text-align: center;">
          <a href="{{qrShippingLink}}" style="background: #ea580c; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Generate QR Shipping Labels</a>
        </div>
        <p style="margin: 8px 0 0 0; font-size: 13px; color: #64748b; text-align: center;">Sign in with <strong>Username:</strong> your Enterprise ID (<strong>{{enterpriseId}}</strong>) <em>or</em> your truck number (<strong>{{truckNumber}}</strong>) &middot; <strong>Password:</strong> your username followed by your 4-digit district number (e.g. <strong>{{enterpriseId}}{{districtNo}}</strong> or <strong>{{truckNumber}}{{districtNo}}</strong>)</p>
      </div>

      <div style="background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 20px 0;">
        <h3 style="margin: 0 0 8px 0; color: #ea580c;">Before You Ship the iPhone</h3>
        <ol style="padding-left: 20px; margin: 0;">
          <li>Open <strong>Settings</strong> &rarr; tap your name at the top &rarr; <strong>Find My</strong> &rarr; turn <strong>OFF</strong> Find My iPhone (enter your Apple ID password).</li>
          <li>Sign out of iCloud: <strong>Settings</strong> &rarr; tap your name &rarr; <strong>Sign Out</strong>.</li>
          <li>Erase the device: <strong>Settings</strong> &rarr; <strong>General</strong> &rarr; <strong>Transfer or Reset iPhone</strong> &rarr; <strong>Erase All Content and Settings</strong>.</li>
        </ol>
        <p style="margin: 10px 0 0 0; font-size: 13px; color: #64748b;">If Activation Lock is still on when we receive the device we cannot recycle it and you may be charged for the replacement.</p>
      </div>

      <p style="background: #fffbeb; border-left: 4px solid #f59e0b; padding: 12px; margin: 20px 0; font-size: 14px;"><strong>If you have already completed your tool audit, used the QR shipping link, and returned your equipment, please disregard this message.</strong></p>

      <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 20px; margin: 24px 0;">
        <h3 style="margin: 0 0 12px 0; color: #92400e;">POLICY REMINDER</h3>
        <p style="margin: 0;">Under the Policy and Acknowledgment for Company-Provided Technician Tools that you acknowledged, technicians are responsible for returning all company-provided tools upon separation and reimbursing the Company for the replacement value of any tools not returned, in accordance with the Policy and applicable state law.</p>
      </div>

      <p>Questions? Contact the Tools Recovery team.</p>
      <p>Thank you,<br>Offboarding Operations</p>
      <p style="color: #64748b; font-size: 12px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e2e8f0;">This is an automated message from the Nexus Offboarding System.</p>
    </div>
  </body>
  </html>`,
        textContent: `Hi {{firstName}},

  Our records show your employment with Sears Home Services ended on {{separationDate}}. Please return your company-provided tools, iPhone, and other equipment as soon as possible using the steps below.

  STEP 1: COMPLETE YOUR TOOL AUDIT
  {{toolAuditLink}}

  STEP 2: RETURN EVERYTHING
  Use the link below to generate prepaid QR shipping labels (sign in at https://asset-returns.replit.app/shipping-qr/). Ship back your company tools, iPhone, fuel cards, hotspot devices, and any other company-provided equipment. Drop the packages at any UPS location - no cost to you.
  {{qrShippingLink}}
  Sign in with Username: your Enterprise ID ({{enterpriseId}}) OR your truck number ({{truckNumber}}); Password: your username followed by your 4-digit district number (e.g. {{enterpriseId}}{{districtNo}} or {{truckNumber}}{{districtNo}}).

  Before you ship the iPhone:
    1. Settings > [your name] > Find My > turn OFF Find My iPhone (enter Apple ID password)
    2. Settings > [your name] > Sign Out (sign out of iCloud)
    3. Settings > General > Transfer or Reset iPhone > Erase All Content and Settings
  If Activation Lock is still on when we receive the device we cannot recycle it and you may be charged for the replacement.

  If you have already completed your tool audit, used the QR shipping link, and returned your equipment, please disregard this message.

  ---

  POLICY REMINDER
  Under the Policy and Acknowledgment for Company-Provided Technician Tools that you acknowledged, technicians are responsible for returning all company-provided tools upon separation and reimbursing the Company for the replacement value of any tools not returned, in accordance with the Policy and applicable state law.

  ---

  Questions? Contact the Tools Recovery team.

  Thank you,
  Offboarding Operations`,
        variables: ['firstName', 'technicianName', 'separationDate', 'enterpriseId', 'truckNumber', 'districtNo', 'toolAuditLink', 'qrShippingLink'],
        isActive: true,
      },
      {
        name: 'recovery-past-sms',
        description: 'Consolidated recovery SMS sent after last day worked — short text directing tech to return everything',
        type: 'sms',
        mode: 'simulated',
        subject: null,
        htmlContent: null,
        textContent: `Hi {{firstName}}, Sears Home Services records show your last day was {{separationDate}}. Complete your tool audit: {{toolAuditLink}} and return your tools, iPhone (sign out of iCloud + turn off Find My iPhone first), and company equipment via prepaid QR labels: {{qrShippingLink}} — sign in with Username = Enterprise ID ({{enterpriseId}}) OR truck # ({{truckNumber}}), Password = username + 4-digit district (e.g. {{enterpriseId}}{{districtNo}} or {{truckNumber}}{{districtNo}}). If you already did this, please disregard. — Offboarding Operations`,
        variables: ['firstName', 'separationDate', 'enterpriseId', 'truckNumber', 'districtNo', 'toolAuditLink', 'qrShippingLink'],
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
    // ==================== LOA Communications (Task #437) ====================
    {
      name: 'loa-team-notice',
      description: 'Team LOA notice (start) emailed to Fleet/Assets/Inventory 3 working days before leave start. Also reused for the extension re-trigger (isExtension flag). The vehicle-recovery and P-card rows render only when is30Plus is set.',
      type: 'email',
      mode: 'live',
      subject: 'LOA Notice – {{tech_name}} | Starts {{loa_start_date}}',
      htmlContent: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 640px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #2563eb 0%, #3b82f6 100%); padding: 28px; border-radius: 8px 8px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 22px;">Leave of Absence Notice</h1>
    <p style="color: #dbeafe; margin: 8px 0 0 0; font-size: 14px;">Action required before the leave start date</p>
  </div>
  <div style="background: #f8fafc; padding: 28px; border: 1px solid #e2e8f0; border-top: none;">
    {{#if isExtension}}<div style="background: #fffbeb; border-left: 4px solid #f59e0b; padding: 12px 16px; margin: 0 0 20px 0; font-size: 14px;"><strong>Leave extended past 30 days.</strong> This leave now qualifies for 30-day recovery actions. The new expected return date is <strong>{{loa_expected_return_date}}</strong>.</div>{{/if}}
    <p>A technician on your team is going on a continuous leave of absence. Please review the details and complete the required actions below before the leave start date.</p>

    <h3 style="color: #2563eb; margin: 24px 0 8px 0;">Leave Details</h3>
    <table style="border-collapse: collapse; width: 100%;">
      <tr><td style="padding: 8px 10px; font-weight: bold; border-bottom: 1px solid #e2e8f0; width: 45%;">Technician</td><td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0;">{{tech_name}}</td></tr>
      <tr><td style="padding: 8px 10px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">Enterprise ID</td><td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0;">{{enterprise_id}}</td></tr>
      <tr><td style="padding: 8px 10px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">Leave Start Date</td><td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0;">{{loa_start_date}}</td></tr>
      <tr><td style="padding: 8px 10px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">Expected Return Date</td><td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0;">{{loa_expected_return_date}}</td></tr>
      <tr><td style="padding: 8px 10px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">Leave Duration</td><td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0;">{{loa_duration_days}} days</td></tr>
      <tr><td style="padding: 8px 10px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">Van Number</td><td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0;">{{van_number}}</td></tr>
      <tr><td style="padding: 8px 10px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">District</td><td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0;">{{district}}</td></tr>
    </table>

    <h3 style="color: #2563eb; margin: 24px 0 8px 0;">Required Actions</h3>
    <table style="border-collapse: collapse; width: 100%; font-size: 14px;">
      <tr style="background: #eff6ff;"><th style="padding: 8px 10px; text-align: left; border-bottom: 2px solid #bfdbfe;">Team</th><th style="padding: 8px 10px; text-align: left; border-bottom: 2px solid #bfdbfe;">Action</th></tr>
      <tr><td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0;">Inventory</td><td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0;">Cancel open parts orders / pending shipments effective Day 1.</td></tr>
      <tr><td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0;">Assets</td><td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0;">Suspend the phone line / cell plan (handset stays with the technician).</td></tr>
      <tr><td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0;">Fleet</td><td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0;">Confirm the technician has removed personal tools from the vehicle.</td></tr>
      {{#if is30Plus}}<tr><td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0;">Fleet</td><td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0;"><strong>Initiate vehicle recovery</strong> (leave is 30+ days).</td></tr>
      <tr><td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0;">Assets</td><td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0;"><strong>Suspend the P-card</strong> (leave is 30+ days).</td></tr>{{/if}}
    </table>

    <p style="background: #f1f5f9; border-left: 4px solid #94a3b8; padding: 12px 16px; margin: 24px 0; font-size: 13px;">Please do not contact the associate directly regarding their leave. Route any questions through the Employee Leave Management Team.</p>

    <p style="margin-top: 24px;">Thank you,<br><strong>Employee Leave Management Team</strong></p>
    <p style="color: #64748b; font-size: 12px; margin-top: 24px; padding-top: 16px; border-top: 1px solid #e2e8f0;">This is an automated message from the Nexus LOA system.</p>
  </div>
</body>
</html>`,
      textContent: `Leave of Absence Notice

{{#if isExtension}}LEAVE EXTENDED PAST 30 DAYS. This leave now qualifies for 30-day recovery actions. New expected return date: {{loa_expected_return_date}}.

{{/if}}A technician on your team is going on a continuous leave of absence. Please review the details and complete the required actions below before the leave start date.

LEAVE DETAILS
Technician: {{tech_name}}
Enterprise ID: {{enterprise_id}}
Leave Start Date: {{loa_start_date}}
Expected Return Date: {{loa_expected_return_date}}
Leave Duration: {{loa_duration_days}} days
Van Number: {{van_number}}
District: {{district}}

REQUIRED ACTIONS
- Inventory: Cancel open parts orders / pending shipments effective Day 1.
- Assets: Suspend the phone line / cell plan (handset stays with the technician).
- Fleet: Confirm the technician has removed personal tools from the vehicle.
{{#if is30Plus}}- Fleet: Initiate vehicle recovery (leave is 30+ days).
- Assets: Suspend the P-card (leave is 30+ days).
{{/if}}
Please do not contact the associate directly regarding their leave. Route any questions through the Employee Leave Management Team.

Thank you,
Employee Leave Management Team`,
      variables: ['tech_name', 'enterprise_id', 'loa_start_date', 'loa_expected_return_date', 'loa_duration_days', 'van_number', 'district', 'is30Plus', 'isExtension'],
      isActive: true,
    },
    {
      name: 'loa-return-notice',
      description: 'Return notice emailed to Fleet/Assets 3 working days before the expected return date (suppressed if the LOA record was closed).',
      type: 'email',
      mode: 'live',
      subject: 'LOA Return Notice – {{tech_name}} | Returns {{loa_expected_return_date}}',
      htmlContent: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 640px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #059669 0%, #10b981 100%); padding: 28px; border-radius: 8px 8px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 22px;">Leave of Absence — Return Notice</h1>
    <p style="color: #d1fae5; margin: 8px 0 0 0; font-size: 14px;">Prepare for the technician's return</p>
  </div>
  <div style="background: #f8fafc; padding: 28px; border: 1px solid #e2e8f0; border-top: none;">
    <p>A technician on your team is returning from a continuous leave of absence. Please complete the reactivation actions below so they are ready for Day 1 back.</p>

    <h3 style="color: #059669; margin: 24px 0 8px 0;">Return Details</h3>
    <table style="border-collapse: collapse; width: 100%;">
      <tr><td style="padding: 8px 10px; font-weight: bold; border-bottom: 1px solid #e2e8f0; width: 45%;">Technician</td><td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0;">{{tech_name}}</td></tr>
      <tr><td style="padding: 8px 10px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">Enterprise ID</td><td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0;">{{enterprise_id}}</td></tr>
      <tr><td style="padding: 8px 10px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">Expected Return Date</td><td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0;">{{loa_expected_return_date}}</td></tr>
      <tr><td style="padding: 8px 10px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">Van Number</td><td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0;">{{van_number}}</td></tr>
      <tr><td style="padding: 8px 10px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">District</td><td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0;">{{district}}</td></tr>
    </table>

    <h3 style="color: #059669; margin: 24px 0 8px 0;">Required Actions</h3>
    <table style="border-collapse: collapse; width: 100%; font-size: 14px;">
      <tr style="background: #ecfdf5;"><th style="padding: 8px 10px; text-align: left; border-bottom: 2px solid #a7f3d0;">Team</th><th style="padding: 8px 10px; text-align: left; border-bottom: 2px solid #a7f3d0;">Action</th></tr>
      <tr><td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0;">Fleet</td><td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0;">Confirm a vehicle (or rental) is available for the technician's Day 1 return.</td></tr>
      <tr><td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0;">Assets</td><td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0;">Reactivate the phone line / cell plan and the P-card.</td></tr>
      <tr><td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0;">Inventory</td><td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0;">Restock parts / tools as needed for Day 1.</td></tr>
    </table>

    <p style="background: #f0fdf4; border-left: 4px solid #34d399; padding: 12px 16px; margin: 24px 0; font-size: 13px;">For protected leaves, the technician must be reinstated to their same or an equivalent position upon return, in accordance with applicable law and company policy.</p>

    <p style="margin-top: 24px;">Thank you,<br><strong>Employee Leave Management Team</strong></p>
    <p style="color: #64748b; font-size: 12px; margin-top: 24px; padding-top: 16px; border-top: 1px solid #e2e8f0;">This is an automated message from the Nexus LOA system.</p>
  </div>
</body>
</html>`,
      textContent: `Leave of Absence — Return Notice

A technician on your team is returning from a continuous leave of absence. Please complete the reactivation actions below so they are ready for Day 1 back.

RETURN DETAILS
Technician: {{tech_name}}
Enterprise ID: {{enterprise_id}}
Expected Return Date: {{loa_expected_return_date}}
Van Number: {{van_number}}
District: {{district}}

REQUIRED ACTIONS
- Fleet: Confirm a vehicle (or rental) is available for the technician's Day 1 return.
- Assets: Reactivate the phone line / cell plan and the P-card.
- Inventory: Restock parts / tools as needed for Day 1.

For protected leaves, the technician must be reinstated to their same or an equivalent position upon return, in accordance with applicable law and company policy.

Thank you,
Employee Leave Management Team`,
      variables: ['tech_name', 'enterprise_id', 'loa_expected_return_date', 'van_number', 'district'],
      isActive: true,
    },
    {
      name: 'loa-tech-sms-under30',
      description: 'Technician LOA SMS for leaves under 30 days (single message), sent 3 working days before leave start.',
      type: 'sms',
      mode: 'live',
      subject: null,
      htmlContent: null,
      textContent: `Hi {{first_name}}, your leave starts {{loa_start_date}}. Please clear all personal tools out of your work van before Day 1 — anything left behind we'll store safely for you. Heads up: your company phone gets shut off during leave, but your P-card stays active. When you're ready to come back, give us 5-7 business days' notice so your van and gear are set for Day 1.`,
      variables: ['first_name', 'loa_start_date'],
      isActive: true,
    },
    {
      name: 'loa-tech-sms-30plus-1',
      description: 'Technician LOA SMS for 30+ day leaves — part 1 of 2, sent 3 working days before leave start.',
      type: 'sms',
      mode: 'live',
      subject: null,
      htmlContent: null,
      textContent: `(1/2) Hi {{first_name}}, your leave starts {{loa_start_date}}. Please clear ALL personal tools out of your work van before Day 1 — anything left behind we'll store safely until you're back.`,
      variables: ['first_name', 'loa_start_date'],
      isActive: true,
    },
    {
      name: 'loa-tech-sms-30plus-2',
      description: 'Technician LOA SMS for 30+ day leaves — part 2 of 2, sent 3 working days before leave start.',
      type: 'sms',
      mode: 'live',
      subject: null,
      htmlContent: null,
      textContent: `(2/2) Since your leave is 30+ days: Fleet will arrange to pick up your van and reach out to coordinate. Your company phone and P-card will both be paused, and any open service orders are cancelled on Day 1. Give us 5-7 business days' notice before you return.`,
      variables: ['first_name', 'loa_start_date'],
      isActive: true,
    },
  ];

  const outreachTemplateNames = new Set([
    'recovery-pre-fleet',
    'recovery-pre-byov',
    'recovery-past-email',
    'recovery-past-sms',
    'loa-team-notice',
    'loa-return-notice',
    'loa-tech-sms-under30',
    'loa-tech-sms-30plus-1',
    'loa-tech-sms-30plus-2',
  ]);

  // Task #424: remove deprecated 4-lane outreach templates from any prior seed
  const deprecatedTemplateNames = [
    'tool-recovery-outreach-pre',
    'tool-recovery-outreach-warm',
    'tool-recovery-outreach-late',
    'tool-recovery-outreach-cold',
  ];
  let removed = 0;
  for (const name of deprecatedTemplateNames) {
    const stale = existingTemplates.find(t => t.name === name);
    if (stale) {
      try {
        await storage.deleteCommunicationTemplate(stale.id);
        removed++;
        console.log(`[COMMUNICATION] Removed deprecated outreach template: ${name}`);
      } catch (err: any) {
        console.warn(`[COMMUNICATION] Failed to remove deprecated template ${name}: ${err?.message || err}`);
      }
    }
  }

  let seeded = 0;
  let updated = 0;
  for (const template of defaultTemplates) {
    if (!existingNames.has(template.name)) {
      await storage.createCommunicationTemplate(template as any);
      seeded++;
      console.log(`[COMMUNICATION] Seeded missing template: ${template.name}`);
    } else if (outreachTemplateNames.has(template.name)) {
      const existing = existingTemplates.find(t => t.name === template.name);
      if (existing) {
        await storage.updateCommunicationTemplate(existing.id, {
          subject: template.subject,
          htmlContent: template.htmlContent,
          textContent: template.textContent,
          variables: template.variables,
          description: template.description,
        } as any);
        updated++;
        console.log(`[COMMUNICATION] Updated outreach template: ${template.name}`);
      }
    }
  }

  if (seeded === 0 && updated === 0) {
    console.log(`[COMMUNICATION] All default templates already exist and outreach templates are current`);
  } else {
    if (seeded > 0) console.log(`[COMMUNICATION] Seeded ${seeded} default templates`);
    if (updated > 0) console.log(`[COMMUNICATION] Updated ${updated} outreach templates with finalized content`);
  }
  return seeded + updated;
}
