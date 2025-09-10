// Email service - logs email content instead of sending (no email service configured)

interface EmailParams {
  to: string;
  from: string;
  subject: string;
  text?: string;
  html?: string;
}

export async function sendEmail(params: EmailParams): Promise<boolean> {
  try {
    // Log the email content since no email service is configured
    console.log('========================================');
    console.log('EMAIL NOTIFICATION (would be sent to):');
    console.log('========================================');
    console.log(`To: ${params.to}`);
    console.log(`From: ${params.from}`);
    console.log(`Subject: ${params.subject}`);
    console.log('');
    console.log('Message:');
    console.log(params.text);
    console.log('========================================');
    
    return true;
  } catch (error) {
    console.error('Email logging error:', error);
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
RACF ID: ${employeeData.racfId}
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
      <td style="padding: 8px; font-weight: bold; border-bottom: 1px solid #ddd;">RACF ID:</td>
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
    from: "noreply@sears.com", // This would need to be a verified sender
    subject,
    text,
    html
  };
}