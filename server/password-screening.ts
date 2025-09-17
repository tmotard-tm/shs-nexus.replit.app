import crypto from 'crypto';

/**
 * Password screening service using Have I Been Pwned k-anonymity API
 * Implements NIST guidelines for compromised credential screening
 */

export interface PasswordScreeningResult {
  isCompromised: boolean;
  error?: string;
}

/**
 * Checks if a password has been compromised using Have I Been Pwned k-anonymity API
 * Only sends first 5 characters of SHA-1 hash for privacy protection
 * 
 * @param password - The password to check (never logged or stored)
 * @returns Promise resolving to screening result
 */
export async function checkPasswordCompromised(password: string): Promise<PasswordScreeningResult> {
  try {
    // Generate SHA-1 hash of password
    const hash = crypto.createHash('sha1').update(password).digest('hex').toUpperCase();
    const prefix = hash.slice(0, 5);
    const suffix = hash.slice(5);
    
    // Make request to Have I Been Pwned API with 5-second timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    try {
      const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
        method: 'GET',
        headers: {
          'User-Agent': 'Sears-Operations-Portal-Password-Check/1.0',
          'Add-Padding': 'true' // Request padding for additional privacy
        },
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        // API error - log for monitoring but allow password (fail open for availability)
        console.warn(`Have I Been Pwned API returned ${response.status}: ${response.statusText}`);
        return {
          isCompromised: false,
          error: 'Password screening service temporarily unavailable - password accepted'
        };
      }
      
      const responseText = await response.text();
      
      // Check if our password hash suffix appears in the response
      const lines = responseText.split('\n');
      for (const line of lines) {
        const [hashSuffix, count] = line.split(':');
        if (hashSuffix === suffix) {
          const breachCount = parseInt(count.trim(), 10);
          if (breachCount > 0) {
            return {
              isCompromised: true
            };
          }
        }
      }
      
      // Password not found in breaches
      return {
        isCompromised: false
      };
      
    } catch (fetchError: any) {
      clearTimeout(timeoutId);
      
      if (fetchError?.name === 'AbortError') {
        console.warn('Have I Been Pwned API request timed out after 5 seconds');
        return {
          isCompromised: false,
          error: 'Password screening service timeout - password accepted'
        };
      }
      
      // Network or other fetch errors - fail open for availability
      console.warn('Have I Been Pwned API request failed:', fetchError?.message || 'Unknown error');
      return {
        isCompromised: false,
        error: 'Password screening service unavailable - password accepted'
      };
    }
    
  } catch (error: any) {
    // Hash generation or other unexpected errors - fail open
    console.error('Password screening service error:', error?.message || 'Unknown error');
    return {
      isCompromised: false,
      error: 'Password screening service error - password accepted'
    };
  }
}

/**
 * Validates password meets basic security requirements before screening
 * 
 * @param password - Password to validate
 * @returns true if password meets minimum requirements
 */
export function validatePasswordRequirements(password: string): boolean {
  // Basic validation - minimum 8 characters
  // Additional requirements should be enforced in frontend/schema validation
  return Boolean(password) && password.length >= 8;
}