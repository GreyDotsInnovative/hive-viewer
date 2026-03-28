"use client";

import type {
  Signature,
  SignatureInkColor,
  SignaturePlacement,
  SignaturePlacementDraft,
} from "../types";

export const SIGNATURE_INK_COLORS: SignatureInkColor[] = [
  "black",
  "blue",
  "red",
  "green",
];

export const SIGNATURE_INK_COLOR_VALUES: Record<SignatureInkColor, string> = {
  black: "#111827",
  blue: "#2563eb",
  red: "#dc2626",
  green: "#16a34a",
};

const DD_MM_YYYY_PATTERN = /^(\d{2})-(\d{2})-(\d{4})$/;

function padDatePart(value: number) {
  return String(value).padStart(2, "0");
}

function isValidDdMmYyyy(value: string) {
  const match = value.match(DD_MM_YYYY_PATTERN);
  if (!match) {
    return false;
  }

  const [, day, month, year] = match;
  const candidate = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
  );

  return (
    !Number.isNaN(candidate.getTime())
    && candidate.getDate() === Number(day)
    && candidate.getMonth() === Number(month) - 1
    && candidate.getFullYear() === Number(year)
  );
}

export function formatDateAsDdMmYyyy(date: Date) {
  return [
    padDatePart(date.getDate()),
    padDatePart(date.getMonth() + 1),
    date.getFullYear(),
  ].join("-");
}

export function normalizeSignatureDate(value?: string) {
  const trimmedValue = value?.trim();
  if (!trimmedValue) {
    return formatDateAsDdMmYyyy(new Date());
  }

  if (isValidDdMmYyyy(trimmedValue)) {
    return trimmedValue;
  }

  const parsed = new Date(trimmedValue);
  if (Number.isNaN(parsed.getTime())) {
    return trimmedValue;
  }

  return formatDateAsDdMmYyyy(parsed);
}

export function normalizeSignatureInkColor(value?: string | null): SignatureInkColor {
  switch (value) {
    case "blue":
    case "red":
    case "green":
    case "black":
      return value;
    default:
      return "black";
  }
}

export function normalizeSignature(signature: Signature): Signature {
  return {
    ...signature,
    id: signature.id || `sig-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    signedBy: signature.signedBy?.trim() || undefined,
    jobTitle: signature.jobTitle?.trim() || undefined,
    dateSigned: normalizeSignatureDate(signature.dateSigned),
  };
}

export function normalizeSignaturePlacement<T extends SignaturePlacement | SignaturePlacementDraft>(
  placement: T,
): T {
  return {
    ...placement,
    signature: normalizeSignature(placement.signature),
    signatureColor: normalizeSignatureInkColor(placement.signatureColor),
  };
}
