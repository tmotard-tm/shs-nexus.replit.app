// Email service using SendGrid
import sgMail from '@sendgrid/mail';

// Initialize SendGrid with API key
const apiKey = process.env.SENDGRID_API_KEY;
if (apiKey) {
  sgMail.setApiKey(apiKey);
  console.log('SendGrid email service initialized');
} else {
  console.warn('SENDGRID_API_KEY not found - email service will log messages instead of sending');
}

// Default verified sender email
const DEFAULT_FROM_EMAIL = 'stephen.wong@transformco.com';

interface EmailParams {
  to: string;
  from: string;
  subject: string;
  text?: string;
  html?: string;
}

export async function sendEmail(params: EmailParams): Promise<boolean> {
  // Use the verified sender if no from address provided or if the from address isn't verified
  const fromEmail = params.from || DEFAULT_FROM_EMAIL;
  
  // Ensure we have valid content - SendGrid requires non-empty content
  const textContent = params.text || (params.html ? params.html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : 'Please view this email in an HTML-capable email client.');
  const htmlContent = params.html || params.text || textContent;
  
  const msg = {
    to: params.to,
    from: DEFAULT_FROM_EMAIL, // Always use verified sender
    replyTo: fromEmail !== DEFAULT_FROM_EMAIL ? fromEmail : undefined,
    subject: params.subject,
    text: textContent,
    html: htmlContent,
  };

  // If no API key, log the email but return false to indicate it wasn't sent
  if (!apiKey) {
    console.warn('========================================');
    console.warn('EMAIL NOT SENT - SENDGRID_API_KEY not configured');
    console.warn('========================================');
    console.warn(`To: ${msg.to}`);
    console.warn(`From: ${msg.from}`);
    console.warn(`Subject: ${msg.subject}`);
    console.warn('');
    console.warn('Message would have been:');
    console.warn(msg.text);
    console.warn('========================================');
    return false;
  }

  try {
    await sgMail.send(msg);
    console.log(`Email sent successfully to ${params.to}: ${params.subject}`);
    return true;
  } catch (error: any) {
    console.error('SendGrid email error:', error);
    if (error.response) {
      console.error('SendGrid error details:', error.response.body);
    }
    return false;
  }
}

export function createCreditCardDeactivationEmail(employeeData: {
  name: string;
  employeeId: string;
  racfId: string;
  lastDayWorked: string;
  reason: string;
}): EmailParams {
  const subject = `Credit Card Deactivation Request - Employee Termination: ${employeeData.name}`;
  
  const text = `
Dear OneCard Help Desk,

Please deactivate the credit card for the following terminated employee:

Employee Name: ${employeeData.name}
Employee ID: ${employeeData.employeeId}
Enterprise ID: ${employeeData.racfId}
Last Day Worked: ${employeeData.lastDayWorked}
Termination Reason: ${employeeData.reason}

Please process this request immediately to prevent unauthorized usage.

This is an automated notification from the Sears Employee Offboarding System.

Thank you,
Sears IT Administration
`;

  const html = `
<html>
<body style="font-family: Arial, sans-serif; color: #333;">
  <h2 style="color: #d32f2f;">Credit Card Deactivation Request</h2>
  <p><strong>Employee Termination Notice</strong></p>
  
  <p>Dear OneCard Help Desk,</p>
  
  <p>Please deactivate the credit card for the following terminated employee:</p>
  
  <table style="border-collapse: collapse; margin: 20px 0;">
    <tr>
      <td style="padding: 8px; font-weight: bold; border-bottom: 1px solid #ddd;">Employee Name:</td>
      <td style="padding: 8px; border-bottom: 1px solid #ddd;">${employeeData.name}</td>
    </tr>
    <tr>
      <td style="padding: 8px; font-weight: bold; border-bottom: 1px solid #ddd;">Employee ID:</td>
      <td style="padding: 8px; border-bottom: 1px solid #ddd;">${employeeData.employeeId}</td>
    </tr>
    <tr>
      <td style="padding: 8px; font-weight: bold; border-bottom: 1px solid #ddd;">Enterprise ID:</td>
      <td style="padding: 8px; border-bottom: 1px solid #ddd;">${employeeData.racfId}</td>
    </tr>
    <tr>
      <td style="padding: 8px; font-weight: bold; border-bottom: 1px solid #ddd;">Last Day Worked:</td>
      <td style="padding: 8px; border-bottom: 1px solid #ddd;">${employeeData.lastDayWorked}</td>
    </tr>
    <tr>
      <td style="padding: 8px; font-weight: bold; border-bottom: 1px solid #ddd;">Termination Reason:</td>
      <td style="padding: 8px; border-bottom: 1px solid #ddd;">${employeeData.reason}</td>
    </tr>
  </table>
  
  <p style="color: #d32f2f; font-weight: bold;">Please process this request immediately to prevent unauthorized usage.</p>
  
  <p style="font-size: 12px; color: #666; margin-top: 30px;">
    This is an automated notification from the Sears Employee Offboarding System.
  </p>
  
  <p>Thank you,<br>
  Sears IT Administration</p>
</body>
</html>
`;

  return {
    to: "onecardhelpdesk@transformco.com",
    from: DEFAULT_FROM_EMAIL,
    subject,
    text,
    html
  };
}

// Sprint 1: Tool Audit Notification
interface ToolAuditNotificationParams {
  email: string;
  firstName: string;
  technicianName: string;
  lastDay: string;
  ldapId: string;
}

const TOOL_AUDIT_FORM_URL = 'https://tech-tool-audit-checklist-lucabuccilli1.replit.app';

function isToolAuditTestMode(): boolean {
  return process.env.TOOL_AUDIT_EMAIL_TEST_MODE !== 'false'; // Default to true
}

function getToolAuditTestEmail(): string | null {
  return process.env.TOOL_AUDIT_TEST_EMAIL || null;
}

export async function sendToolAuditNotification(params: ToolAuditNotificationParams): Promise<{
  success: boolean;
  testMode: boolean;
  intendedRecipient: string;
  actualRecipient: string;
  error?: string;
}> {
  const testMode = isToolAuditTestMode();
  const testEmail = getToolAuditTestEmail();
  
  // Determine actual recipient
  const intendedRecipient = params.email;
  let actualRecipient = intendedRecipient;
  
  if (testMode) {
    if (!testEmail) {
      console.log(`[TOOL AUDIT EMAIL - TEST MODE] No test email configured, skipping send`);
      console.log(`[TOOL AUDIT EMAIL - TEST MODE] Would have sent to: ${intendedRecipient}`);
      console.log(`[TOOL AUDIT EMAIL - TEST MODE] Subject: Action Required: Complete Your Tool Audit Before ${params.lastDay}`);
      return {
        success: false,
        testMode: true,
        intendedRecipient,
        actualRecipient: 'none',
        error: 'TOOL_AUDIT_TEST_EMAIL not configured',
      };
    }
    actualRecipient = testEmail;
    console.log(`[TOOL AUDIT EMAIL - TEST MODE] Would send to: ${intendedRecipient}`);
    console.log(`[TOOL AUDIT EMAIL - TEST MODE] Actually sending to: ${actualRecipient}`);
  }

  const formUrl = `${TOOL_AUDIT_FORM_URL}?ldap=${encodeURIComponent(params.ldapId)}`;
  
  const subject = `Action Required: Complete Your Tool Audit Before ${params.lastDay}`;
  
  const text = `Hi ${params.firstName},

As you prepare for your last day on ${params.lastDay}, please complete the Tool Audit form below.

Complete Tool Audit: ${formUrl}

As part of your onboarding, you signed a Tool Accountability Policy acknowledging your responsibility for company-provided tools. Completing this form helps us verify your inventory and avoid any payroll adjustments on your final check.

This takes about 5 minutes.

Thank you,
Transform Co Tools Team`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; color: #333; line-height: 1.6; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #1a365d; color: white; padding: 20px; text-align: center; }
    .content { padding: 30px 20px; background: #f9f9f9; }
    .button { display: inline-block; background: #2563eb; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; margin: 20px 0; }
    .footer { font-size: 12px; color: #666; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; }
    .important { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 style="margin: 0;">Tool Audit Required</h1>
    </div>
    <div class="content">
      <p>Hi ${params.firstName},</p>
      
      <p>As you prepare for your last day on <strong>${params.lastDay}</strong>, please complete the Tool Audit form below.</p>
      
      <p style="text-align: center;">
        <a href="${formUrl}" class="button">Complete Tool Audit</a>
      </p>
      
      <div class="important">
        <p style="margin: 0;">As part of your onboarding, you signed a Tool Accountability Policy acknowledging your responsibility for company-provided tools. Completing this form helps us verify your inventory and avoid any payroll adjustments on your final check.</p>
      </div>
      
      <p><strong>This takes about 5 minutes.</strong></p>
      
      <p>Thank you,<br>
      Transform Co Tools Team</p>
      
      <div class="footer">
        ${testMode ? `<p style="color: #d32f2f;"><strong>[TEST MODE]</strong> This email was intended for: ${intendedRecipient}</p>` : ''}
        <p>This is an automated message from the Nexus Employee Offboarding System.</p>
        <p>If you did not expect this email or have questions, please contact your supervisor or the Tools Team.</p>
      </div>
    </div>
  </div>
</body>
</html>
`;

  try {
    const result = await sendEmail({
      to: actualRecipient,
      from: DEFAULT_FROM_EMAIL,
      subject,
      text,
      html,
    });

    if (result) {
      console.log(`[TOOL AUDIT EMAIL] Sent successfully to ${actualRecipient}${testMode ? ` (test mode, intended: ${intendedRecipient})` : ''}`);
    }

    return {
      success: result,
      testMode,
      intendedRecipient,
      actualRecipient,
    };
  } catch (error: any) {
    console.error(`[TOOL AUDIT EMAIL] Failed to send:`, error.message);
    return {
      success: false,
      testMode,
      intendedRecipient,
      actualRecipient,
      error: error.message,
    };
  }
}
