/**
 * Shared helper: detect and reject legacy .xls (BIFF) files before they reach
 * ExcelJS, which only supports the OOXML (.xlsx) format.
 *
 * All multipart spreadsheet import endpoints import this helper so the check
 * is in one place and can be unit-tested without HTTP.
 */

export const XLS_REJECTION_MESSAGE =
  "Legacy .xls files are not supported. Please save the file as .xlsx and re-upload.";

/**
 * Returns the rejection message when the upload is a legacy .xls file, or null
 * when the filename is acceptable (.xlsx, .csv, etc.).
 *
 * The check is purely by extension (lowercase); MIME types are advisory and
 * untrustworthy in multipart uploads.
 */
export function xlsRejectionMessage(originalname: string): string | null {
  const n = (originalname || "").toLowerCase();
  // .xls ends with ".xls" but NOT with ".xlsx"
  if (n.endsWith(".xls") && !n.endsWith(".xlsx")) {
    return XLS_REJECTION_MESSAGE;
  }
  return null;
}
