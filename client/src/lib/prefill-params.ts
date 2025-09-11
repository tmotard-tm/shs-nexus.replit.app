/**
 * Secure utility for extracting and validating query parameters for form prefilling.
 * 
 * Features:
 * - Security-first design with whitelisted parameters only
 * - Type safety with function overloads
 * - Input validation and sanitization
 * - XSS prevention
 * - Graceful error handling
 */

/**
 * Sanitizes a string value to prevent XSS and normalize input
 */
function sanitizeValue(value: string): string {
  return value
    .trim()
    .replace(/[<>'"&]/g, '') // Basic XSS prevention
    .slice(0, 500); // Prevent overly long values
}

/**
 * Checks if a parameter key is safe (not sensitive)
 */
function isSafeParameterKey(key: string): boolean {
  const sensitiveKeywords = [
    'password', 'token', 'secret', 'key', 'auth',
    'ssn', 'social', 'credit', 'card', 'cvv',
    'session', 'cookie', 'api_key', 'access_token'
  ];
  
  const lowerKey = key.toLowerCase();
  return !sensitiveKeywords.some(keyword => lowerKey.includes(keyword));
}

/**
 * Basic overload: Returns a simple Record<string, string>
 */
function getPrefillParams(allowedKeys: string[]): Record<string, string>;

/**
 * Advanced overload: Returns a typed Partial<T> with optional validators
 */
function getPrefillParams<T extends Record<string, any>>(
  allowedKeys: (keyof T)[],
  validators?: Partial<Record<keyof T, (value: string) => T[keyof T]>>
): Partial<T>;

/**
 * Implementation of the getPrefillParams utility
 */
function getPrefillParams<T extends Record<string, any>>(
  allowedKeys: (keyof T)[] | string[],
  validators?: Partial<Record<keyof T, (value: string) => T[keyof T]>>
): Partial<T> | Record<string, string> {
  try {
    // Get current URL search parameters
    const urlParams = new URLSearchParams(window.location.search);
    const result: Record<string, any> = {};
    
    // Create filtered safe list BEFORE extraction - CRITICAL SECURITY FIX
    const safeAllowedKeys: (keyof T | string)[] = [];
    const blockedKeys: string[] = [];
    
    for (const key of allowedKeys) {
      const keyStr = String(key);
      if (isSafeParameterKey(keyStr)) {
        safeAllowedKeys.push(key);
      } else {
        blockedKeys.push(keyStr);
        console.warn(`getPrefillParams: Potentially sensitive parameter "${keyStr}" blocked`);
      }
    }
    
    // Fail fast if sensitive keys were attempted (optional strict mode)
    if (blockedKeys.length > 0) {
      console.warn(`getPrefillParams: Blocked ${blockedKeys.length} sensitive parameter(s): ${blockedKeys.join(', ')}`);
    }
    
    // Extract and process ONLY safe whitelisted parameters
    for (const key of safeAllowedKeys) {
      const keyStr = String(key);
      const rawValue = urlParams.get(keyStr);
      
      if (rawValue !== null && rawValue !== '') {
        try {
          // Sanitize the value
          const sanitizedValue = sanitizeValue(rawValue);
          
          // Apply validator if provided
          if (validators && validators[key as keyof T]) {
            const validator = validators[key as keyof T];
            if (validator) {
              const validatedValue = validator(sanitizedValue);
              
              // Skip assignment if validation returns empty/null - prevents overriding defaults
              if (validatedValue !== '' && validatedValue !== null && validatedValue !== undefined) {
                result[keyStr] = validatedValue;
              }
            }
          } else {
            // Only assign non-empty sanitized values
            if (sanitizedValue !== '') {
              result[keyStr] = sanitizedValue;
            }
          }
        } catch (validationError) {
          console.warn(`getPrefillParams: Validation failed for "${keyStr}":`, validationError);
          // Skip invalid values rather than throwing
        }
      }
    }
    
    return result;
  } catch (error) {
    console.error('getPrefillParams: Error extracting parameters:', error);
    return {};
  }
}

/**
 * Common validators for typical form fields
 */
export const commonValidators = {
  /**
   * Validates and normalizes an employee name
   */
  employeeName: (value: string): string => {
    return value
      .trim()
      .replace(/[^a-zA-Z\s\-'\.]/g, '') // Allow only letters, spaces, hyphens, apostrophes, dots
      .slice(0, 100);
  },
  
  /**
   * Validates and normalizes a vehicle number
   */
  vehicleNumber: (value: string): string => {
    return value
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9\-]/g, '') // Allow only alphanumeric and hyphens
      .slice(0, 20);
  },
  
  /**
   * Validates and normalizes an email address
   */
  email: (value: string): string => {
    const cleaned = value.trim().toLowerCase().slice(0, 254);
    // Basic email pattern validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(cleaned) ? cleaned : '';
  },
  
  /**
   * Validates and normalizes a phone number
   */
  phone: (value: string): string => {
    return value
      .trim()
      .replace(/[^0-9\-\(\)\s\+]/g, '') // Allow digits, hyphens, parentheses, spaces, plus
      .slice(0, 20);
  },
  
  /**
   * Validates and normalizes a date string (YYYY-MM-DD format)
   */
  date: (value: string): string => {
    const cleaned = value.trim().slice(0, 10);
    // Basic date format validation
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (dateRegex.test(cleaned)) {
      const date = new Date(cleaned);
      return isNaN(date.getTime()) ? '' : cleaned;
    }
    return '';
  },
  
  /**
   * Validates and normalizes a numeric string
   */
  number: (value: string): string => {
    const cleaned = value.trim().replace(/[^0-9\.]/g, '');
    return isNaN(Number(cleaned)) ? '' : cleaned;
  },
  
  /**
   * Validates and normalizes a text field
   */
  text: (value: string): string => {
    return value
      .trim()
      .replace(/[<>'"&]/g, '') // Basic XSS prevention
      .slice(0, 255);
  }
};

/**
 * Helper function to create a safe whitelist for common form fields
 */
export function createSafeWhitelist(fields: string[]): string[] {
  return fields.filter(field => isSafeParameterKey(field));
}

export { getPrefillParams };