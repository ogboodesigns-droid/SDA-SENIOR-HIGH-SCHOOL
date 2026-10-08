import type { CellValue } from 'exceljs';

/** Text of a spreadsheet cell, whatever Excel stored it as (number, rich text, formula result…). */
export function cellText(v: CellValue | undefined): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return isoDate(v);
  if (typeof v === 'object') {
    if ('result' in v) return cellText(v.result as CellValue);
    if ('richText' in v) return v.richText.map((t) => t.text).join('').trim() || null;
    if ('text' in v) return String(v.text).trim() || null;
    if ('error' in v) return null;
  }
  const s = String(v).trim();
  return s ? s : null;
}

export function cellNumber(v: CellValue | undefined): number | null | 'invalid' {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && v !== null && 'result' in v) return cellNumber(v.result as CellValue);
  const s = cellText(v);
  if (s === null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : 'invalid';
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * A date typed or stored as: an Excel date, an Excel serial number,
 * DD/MM/YYYY (as on the template) or YYYY-MM-DD.
 */
export function cellDate(v: CellValue | undefined): string | null | 'invalid' {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? 'invalid' : isoDate(v);
  if (typeof v === 'number') {
    // Excel serial date (days since 1899-12-30).
    const d = new Date(Math.round((v - 25569) * 86_400_000));
    return Number.isNaN(d.getTime()) ? 'invalid' : isoDate(d);
  }
  const s = cellText(v);
  if (!s) return null;
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) return validYmd(Number(m[3]), Number(m[2]), Number(m[1]));
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return validYmd(Number(m[1]), Number(m[2]), Number(m[3]));
  return 'invalid';
}

function validYmd(y: number, mo: number, d: number): string | 'invalid' {
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return 'invalid';
  return isoDate(date);
}

/**
 * Ghanaian phone number as on the template: 10 digits starting with 0.
 * Excel often drops the leading 0 (024… stored as 24…), so a 9-digit number gets it back.
 * +233 / 233 prefixes are converted to the local form.
 */
export function ghanaPhone(v: CellValue | undefined): string | null | 'invalid' {
  const raw = cellText(v);
  if (!raw) return null;
  let digits = raw.replace(/[\s-]/g, '');
  if (digits.startsWith('+233')) digits = `0${digits.slice(4)}`;
  else if (/^233\d{9}$/.test(digits)) digits = `0${digits.slice(3)}`;
  if (/^\d{9}$/.test(digits) && !digits.startsWith('0')) digits = `0${digits}`;
  return /^0\d{9}$/.test(digits) ? digits : 'invalid';
}

/** BECE index number: 10 digits. Excel turns 0050401012 into 50401012, so leading zeros are restored. */
export function beceIndex(v: CellValue | undefined): string | null | 'invalid' {
  const raw = cellText(v);
  if (!raw) return null;
  const digits = raw.replace(/\s/g, '');
  if (!/^\d{1,10}$/.test(digits)) return 'invalid';
  return digits.padStart(10, '0');
}

/** Header text without the required-field star: "Surname *" → "surname". */
export function headerKey(v: CellValue | undefined): string {
  return (cellText(v) ?? '').replace(/\*/g, '').trim().toLowerCase();
}
