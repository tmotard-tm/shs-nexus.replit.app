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
 * Processes a parameter value with optional validation
 */
function processParameterValue<T extends Record<string, any>>(
  rawValue: string,
  key: keyof T | string,
  validators?: Partial<Record<keyof T, (value: string) => T[keyof T]>>
): any | null {
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
          return validatedValue;
        }
      }
    } else {
      // Only assign non-empty sanitized values
      if (sanitizedValue !== '') {
        return sanitizedValue;
      }
    }
  } catch (validationError) {
    console.warn(`getPrefillParams: Validation failed for "${String(key)}":`, validationError);
    // Skip invalid values rather than throwing
  }
  return null;
}

/**
 * Basic overload: Returns a simple Record<string, string>
 */
function getPrefillParams(
  allowedKeys: string[], 
  aliases?: Record<string, string>
): Record<string, string>;

/**
 * Advanced overload: Returns a typed Partial<T> with optional validators and aliases
 */
function getPrefillParams<T extends Record<string, any>>(
  allowedKeys: (keyof T)[],
  validators?: Partial<Record<keyof T, (value: string) => T[keyof T]>>,
  aliases?: Record<string, keyof T | string>
): Partial<T>;

/**
 * Implementation of the getPrefillParams utility
 */
function getPrefillParams<T extends Record<string, any>>(
  allowedKeys: (keyof T)[] | string[],
  validators?: Partial<Record<keyof T, (value: string) => T[keyof T]>> | Record<string, string>,
  aliases?: Record<string, keyof T | string>
): Partial<T> | Record<string, string> {
  // Handle parameter overload detection
  let actualValidators: Partial<Record<keyof T, (value: string) => T[keyof T]>> | undefined;
  let actualAliases: Record<string, keyof T | string> | undefined;
  
  // Detect if second parameter is validators or aliases based on usage pattern
  if (arguments.length === 2 && validators && typeof Object.values(validators)[0] === 'string') {
    // Basic overload: getPrefillParams(keys, aliases)
    actualValidators = undefined;
    actualAliases = validators as Record<string, string>;
  } else {
    // Advanced overload: getPrefillParams(keys, validators, aliases)
    actualValidators = validators as Partial<Record<keyof T, (value: string) => T[keyof T]>>;
    actualAliases = aliases;
  }
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
    
    // Create alias lookup map for efficient processing
    const aliasMap = new Map<string, keyof T | string>();
    if (actualAliases) {
      for (const [aliasKey, targetKey] of Object.entries(actualAliases)) {
        if (isSafeParameterKey(aliasKey)) {
          aliasMap.set(aliasKey, targetKey);
        }
      }
    }
    
    // Process direct parameters (allowed keys)
    for (const key of safeAllowedKeys) {
      const keyStr = String(key);
      const rawValue = urlParams.get(keyStr);
      
      if (rawValue !== null && rawValue !== '') {
        const processedValue = processParameterValue(rawValue, key, actualValidators);
        if (processedValue !== null) {
          result[keyStr] = processedValue;
        }
      }
    }
    
    // Process alias parameters
    if (actualAliases) {
      for (const [aliasKey, targetKey] of Object.entries(actualAliases)) {
        if (!aliasMap.has(aliasKey)) continue;
        
        const rawValue = urlParams.get(aliasKey);
        const targetKeyStr = String(targetKey);
        
        // Only process if target key is in our allowed list and we haven't already set it
        if (rawValue !== null && rawValue !== '' && 
            safeAllowedKeys.some(k => String(k) === targetKeyStr) && 
            !result.hasOwnProperty(targetKeyStr)) {
          
          const processedValue = processParameterValue(rawValue, targetKey, actualValidators);
          if (processedValue !== null) {
            result[targetKeyStr] = processedValue;
          }
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
  },
  
  /**
   * Validates and normalizes a zip code (US format)
   */
  zipCode: (value: string): string => {
    const cleaned = value.trim().replace(/\D/g, '');
    // Support both 5-digit and 9-digit zip codes
    return cleaned.length >= 5 ? cleaned.slice(0, 9) : cleaned.slice(0, 5);
  },
  
  /**
   * Validates and normalizes a VIN number
   */
  vin: (value: string): string => {
    return value
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '') // VINs are alphanumeric only, no I, O, Q
      .slice(0, 17);
  },
  
  /**
   * Validates and normalizes a license plate
   */
  licensePlate: (value: string): string => {
    return value
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9\-\s]/g, '') // Allow letters, numbers, hyphens, spaces
      .slice(0, 10);
  },
  
  /**
   * Validates and normalizes a state abbreviation
   */
  stateAbbr: (value: string): string => {
    const cleaned = value.trim().toUpperCase().replace(/[^A-Z]/g, '');
    // US state abbreviations are exactly 2 characters
    return cleaned.length === 2 ? cleaned : '';
  },
  
  /**
   * Validates and normalizes a year value
   */
  year: (value: string): number | null => {
    const numValue = parseInt(value.trim(), 10);
    const currentYear = new Date().getFullYear();
    // Allow reasonable year range (1900 to current year + 5)
    if (numValue >= 1900 && numValue <= currentYear + 5) {
      return numValue;
    }
    return null;
  },
  
  /**
   * Validates and normalizes an employee ID
   */
  employeeId: (value: string): string => {
    return value
      .trim()
      .replace(/[^A-Z0-9]/g, '') // Employee IDs are typically alphanumeric
      .slice(0, 15);
  },
  
  /**
   * Validates and normalizes a department name
   */
  department: (value: string): string => {
    return value
      .trim()
      .replace(/[^a-zA-Z\s\-]/g, '') // Allow letters, spaces, hyphens
      .slice(0, 50);
  },
  
  /**
   * Validates and normalizes a position/job title
   */
  position: (value: string): string => {
    return value
      .trim()
      .replace(/[^a-zA-Z\s\-&]/g, '') // Allow letters, spaces, hyphens, ampersands
      .slice(0, 100);
  },
  
  /**
   * Validates and normalizes a priority level
   */
  priority: (value: string): string => {
    const validPriorities = ['low', 'medium', 'high', 'critical'];
    const cleaned = value.trim().toLowerCase();
    return validPriorities.includes(cleaned) ? cleaned : '';
  },
  
  /**
   * Validates and normalizes a status field
   */
  status: (value: string): string => {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z_]/g, '') // Allow lowercase letters and underscores
      .slice(0, 50);
  },
  
  /**
   * Validates and normalizes a boolean string
   */
  boolean: (value: string): boolean | null => {
    const cleaned = value.trim().toLowerCase();
    if (cleaned === 'true' || cleaned === '1' || cleaned === 'yes') return true;
    if (cleaned === 'false' || cleaned === '0' || cleaned === 'no') return false;
    return null;
  },
  
  /**
   * Validates and normalizes a URL
   */
  url: (value: string): string => {
    try {
      const url = new URL(value.trim());
      // Only allow http and https protocols
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        return url.toString().slice(0, 500);
      }
    } catch {
      // Invalid URL
    }
    return '';
  },
  
  /**
   * Validates and normalizes an address field
   */
  address: (value: string): string => {
    return value
      .trim()
      .replace(/[<>'"&]/g, '') // Basic XSS prevention
      .slice(0, 200);
  },
  
  /**
   * Validates and normalizes a comma-separated list (like specialties)
   */
  csvList: (value: string): string[] => {
    return value
      .split(',')
      .map(item => item.trim())
      .filter(item => item.length > 0 && item.length <= 50)
      .slice(0, 10); // Limit to 10 items
  }
};

/**
 * Helper function to create a safe whitelist for common form fields
 */
export function createSafeWhitelist(fields: string[]): string[] {
  return fields.filter(field => isSafeParameterKey(field));
}

export { getPrefillParams };