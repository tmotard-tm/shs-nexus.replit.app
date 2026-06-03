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

// Default verified sender email — sourced from SENDGRID_EMAIL secret.
// Set this secret to a verified SendGrid Sender Identity to enable outbound mail.
const DEFAULT_FROM_EMAIL = process.env.SENDGRID_EMAIL || '';
if (DEFAULT_FROM_EMAIL) {
  console.log(`SendGrid from-address: ${DEFAULT_FROM_EMAIL}`);
} else {
  console.warn('SENDGRID_EMAIL secret not set — outgoing emails will be blocked until this is configured.');
}

interface Attachment {
  content: string;
  filename: string;
  type: string;
  disposition: 'attachment' | 'inline';
}

interface EmailParams {
  to: string;
  cc?: string | string[];
  from: string;
  subject: string;
  text?: string;
  html?: string;
  attachments?: Attachment[];
}

export interface EmailResult {
  success: boolean;
  error?: string;
  messageId?: string;
}

interface MailPayload {
  to: string;
  from: string;
  replyTo?: string;
  subject: string;
  text: string;
  html: string;
  cc?: string | string[];
  attachments?: Attachment[];
}

export async function sendEmail(params: EmailParams): Promise<EmailResult> {
  if (!DEFAULT_FROM_EMAIL) {
    console.error('EMAIL NOT SENT - SENDGRID_EMAIL secret is not configured');
    return { success: false, error: 'SENDGRID_EMAIL secret not configured' };
  }

  const fromEmail = params.from || DEFAULT_FROM_EMAIL;
  
  const textContent = params.text || (params.html ? params.html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : 'Please view this email in an HTML-capable email client.');
  const htmlContent = params.html || params.text || textContent;
  
  const msg: MailPayload = {
    to: params.to,
    from: DEFAULT_FROM_EMAIL,
    ...(fromEmail !== DEFAULT_FROM_EMAIL ? { replyTo: fromEmail } : {}),
    subject: params.subject,
    text: textContent,
    html: htmlContent,
    ...(params.cc ? { cc: params.cc } : {}),
    ...(params.attachments ? { attachments: params.attachments } : {}),
  };

  if (!apiKey) {
    console.warn('========================================');
    console.warn('EMAIL NOT SENT - SENDGRID_API_KEY not configured');
    console.warn('========================================');
    console.warn(`To: ${msg.to}`);
    if (msg.cc) console.warn(`CC: ${Array.isArray(msg.cc) ? msg.cc.join(', ') : msg.cc}`);
    console.warn(`From: ${msg.from}`);
    console.warn(`Subject: ${msg.subject}`);
    console.warn('');
    console.warn('Message would have been:');
    console.warn(msg.text);
    console.warn('========================================');
    return { success: false, error: 'SendGrid API key not configured' };
  }

  try {
    const [response] = await sgMail.send(msg);
    // SendGrid returns the provider message id in the x-message-id response
    // header. Capture it so callers can record it on their audit records.
    const headerMessageId = response?.headers?.['x-message-id'];
    const messageId = Array.isArray(headerMessageId)
      ? headerMessageId[0]
      : (headerMessageId as string | undefined);
    console.log(`Email sent successfully to ${params.to}: ${params.subject}`);
    return { success: true, messageId: messageId || undefined };
  } catch (error: any) {
    console.error('SendGrid email error:', error);
    let errorDetail = 'Unknown SendGrid error';
    if (error.response?.body) {
      const body = error.response.body;
      if (body.errors && Array.isArray(body.errors) && body.errors.length > 0) {
        errorDetail = body.errors.map((e: any) => e.message || e.field || JSON.stringify(e)).join('; ');
      } else if (body.message) {
        errorDetail = body.message;
      } else if (typeof body === 'string') {
        errorDetail = body;
      } else {
        errorDetail = JSON.stringify(body);
      }
    } else if (error.message) {
      errorDetail = error.message;
    }
    console.error('SendGrid error details:', errorDetail);
    return { success: false, error: errorDetail };
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

// Note: sendToolAuditNotification has been moved to notification-service.ts
// to avoid circular imports. Import it from there instead.
