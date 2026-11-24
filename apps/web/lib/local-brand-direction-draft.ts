import type { Profile } from './onboarding.ts';

export const brandNameLimit = 120;
export const brandPositioningLimit = 200;
export const brandToneWordLimit = 40;
export const brandToneWordMin = 3;
export const brandToneWordMax = 5;
export const brandVisualNoteLimit = 800;
export const brandDirectionStorageByteLimit = 64000;
export const brandDirectionRevisionCap = 9999;

export const brandTypographyOptions = [
  {
    value: 'modern-sans' as const,
    label: 'Modern sans',
    stack: 'DM Sans, Inter, system-ui, sans-serif',
  },
  {
    value: 'classic-serif' as const,
    label: 'Classic serif',
    stack: 'Georgia, "Times New Roman", serif',
  },
  {
    value: 'neutral-system' as const,
    label: 'Neutral system',
    stack: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  {
    value: 'editorial-mono' as const,
    label: 'Editorial mono accents',
    stack: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  },
] as const;

export type BrandTypography = (typeof brandTypographyOptions)[number]['value'];

export type BrandDirectionDraftInput = {
  brandName: string;
  positioningLine: string;
  toneWords: string[];
  primaryColor: string;
  accentColor: string;
  typography: BrandTypography;
  visualDo: string;
  visualDont: string;
};

export type BrandDirectionDraft = {
  version: 1;
  profileId: string;
  revision: number;
  updatedAt: string;
  brandName: string;
  positioningLine: string;
  toneWords: string[];
  primaryColor: string;
  accentColor: string;
  typography: BrandTypography;
  visualDo?: string;
  visualDont?: string;
};

export type BrandDirectionSampleSwatch = {
  surfaceLabel: string;
  backgroundColor: string;
  textColor: string;
  accentColor: string;
  meetsContrastGoal: boolean;
};

export type BrandDirectionPreviewProjection = {
  disclaimer: string;
  statusLabel: string;
  brandName: string;
  positioningLine: string;
  toneWords: string[];
  primaryColor: string;
  accentColor: string;
  typographyLabel: string;
  typographyStack: string;
  visualDo: string | null;
  visualDont: string | null;
  primaryOnPrimary: string;
  accentOnAccent: string;
  lightSample: BrandDirectionSampleSwatch;
  darkSample: BrandDirectionSampleSwatch;
};

export const brandDirectionStorageKey = (profileId: string) =>
  `launchpad.brand-direction-draft.v1.${profileId}`;

const isoTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const hexPattern = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const typographyValues = new Set(brandTypographyOptions.map(option => option.value));

const text = (value: unknown, label: string, limit: number) => {
  if (typeof value !== 'string' || value.length > limit || !value.trim()) {
    throw new Error(`${label} is required and must be ${limit} characters or fewer.`);
  }
  return value.trim();
};

const optionalPlainText = (value: unknown, label: string, limit: number) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > limit) {
    throw new Error(`${label} must be ${limit} characters or fewer when provided.`);
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

function expandHexDigits(digits: string): string {
  if (digits.length === 3) {
    return digits
      .split('')
      .map(ch => ch + ch)
      .join('');
  }
  return digits;
}

export function isValidHexColor(value: string): boolean {
  return hexPattern.test(value.trim());
}

export function normalizeHexColor(value: unknown, label: string): string {
  if (typeof value !== 'string' || !hexPattern.test(value.trim())) {
    throw new Error(`${label} must be a valid #RGB or #RRGGBB hex code.`);
  }
  const match = value.trim().match(hexPattern)!;
  const expanded = expandHexDigits(match[1]).toLowerCase();
  return `#${expanded}`;
}

export function parseHexRgb(hex: string): [number, number, number] {
  const normalized = normalizeHexColor(hex, 'Color');
  const body = normalized.slice(1);
  const r = Number.parseInt(body.slice(0, 2), 16);
  const g = Number.parseInt(body.slice(2, 4), 16);
  const b = Number.parseInt(body.slice(4, 6), 16);
  return [r, g, b];
}

function srgbChannel(value: number): number {
  const channel = value / 255;
  return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHexRgb(hex);
  return 0.2126 * srgbChannel(r) + 0.7152 * srgbChannel(g) + 0.0722 * srgbChannel(b);
}

export function contrastRatio(foregroundHex: string, backgroundHex: string): number {
  const l1 = relativeLuminance(foregroundHex);
  const l2 = relativeLuminance(backgroundHex);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

const lightText = '#f5f4f1';
const darkText = '#111111';

export function pickReadableTextColor(backgroundHex: string): '#111111' | '#f5f4f1' {
  const whiteRatio = contrastRatio(lightText, backgroundHex);
  const blackRatio = contrastRatio(darkText, backgroundHex);
  return whiteRatio >= blackRatio ? lightText : darkText;
}

export function meetsReadableContrast(foregroundHex: string, backgroundHex: string): boolean {
  return contrastRatio(foregroundHex, backgroundHex) >= 4.5;
}

function parseTypography(value: unknown): BrandTypography {
  if (typeof value !== 'string' || !typographyValues.has(value as BrandTypography)) {
    throw new Error('Choose a typography preference from the list (system fonts only).');
  }
  return value as BrandTypography;
}

function normalizeToneWords(words: readonly string[]): string[] {
  if (!Array.isArray(words)) {
    throw new Error(`Add ${brandToneWordMin}–${brandToneWordMax} tone words.`);
  }
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const [index, raw] of words.entries()) {
    if (typeof raw !== 'string') {
      throw new Error(`Tone word ${index + 1} must be text.`);
    }
    const word = raw.trim();
    if (!word) continue;
    if (word.length > brandToneWordLimit) {
      throw new Error(`Each tone word must be ${brandToneWordLimit} characters or fewer.`);
    }
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(word);
  }
  if (normalized.length < brandToneWordMin || normalized.length > brandToneWordMax) {
    throw new Error(`Add ${brandToneWordMin}–${brandToneWordMax} unique tone words before saving.`);
  }
  return normalized;
}

export function parseToneWordsFromText(raw: string): string[] {
  const parts = raw
    .split(/[,;\n]+/)
    .map(part => part.trim())
    .filter(Boolean);
  return normalizeToneWords(parts);
}

function parseUpdatedAt(value: unknown): string {
  if (typeof value !== 'string' || !isoTimestampPattern.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error('Invalid saved brand direction draft. Nothing was overwritten.');
  }
  return value;
}

function parseRevision(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > brandDirectionRevisionCap) {
    throw new Error('Invalid saved brand direction draft. Nothing was overwritten.');
  }
  return value as number;
}

export function labelForTypography(value: BrandTypography): string {
  return brandTypographyOptions.find(option => option.value === value)?.label ?? value;
}

export function stackForTypography(value: BrandTypography): string {
  return brandTypographyOptions.find(option => option.value === value)?.stack ?? brandTypographyOptions[0].stack;
}

export function blankBrandDirectionDraftInput(): BrandDirectionDraftInput {
  return {
    brandName: '',
    positioningLine: '',
    toneWords: [],
    primaryColor: '#6366f1',
    accentColor: '#fcd34d',
    typography: 'modern-sans',
    visualDo: '',
    visualDont: '',
  };
}

export function editBrandDirectionDraft(draft: BrandDirectionDraft): BrandDirectionDraftInput {
  return {
    brandName: draft.brandName,
    positioningLine: draft.positioningLine,
    toneWords: [...draft.toneWords],
    primaryColor: draft.primaryColor,
    accentColor: draft.accentColor,
    typography: draft.typography,
    visualDo: draft.visualDo ?? '',
    visualDont: draft.visualDont ?? '',
  };
}

function buildDraft(
  input: BrandDirectionDraftInput,
  profileId: string,
  revision: number,
  updatedAt: string,
): BrandDirectionDraft {
  const visualDo = optionalPlainText(input.visualDo, 'Visual do notes', brandVisualNoteLimit);
  const visualDont = optionalPlainText(input.visualDont, "Visual don't notes", brandVisualNoteLimit);
  return {
    version: 1,
    profileId: text(profileId, 'Profile ID', 160),
    revision,
    updatedAt: parseUpdatedAt(updatedAt),
    brandName: text(input.brandName, 'Brand name', brandNameLimit),
    positioningLine: text(input.positioningLine, 'Positioning line', brandPositioningLimit),
    toneWords: normalizeToneWords(input.toneWords),
    primaryColor: normalizeHexColor(input.primaryColor, 'Primary color'),
    accentColor: normalizeHexColor(input.accentColor, 'Accent color'),
    typography: parseTypography(input.typography),
    ...(visualDo ? { visualDo } : {}),
    ...(visualDont ? { visualDont } : {}),
  };
}

export function saveBrandDirectionDraft(
  input: BrandDirectionDraftInput,
  profileId: string,
  prior: BrandDirectionDraft | null,
): BrandDirectionDraft {
  const revision = prior ? Math.min(prior.revision + 1, brandDirectionRevisionCap) : 1;
  return buildDraft(input, profileId, revision, new Date().toISOString());
}

export function brandDirectionDraftFromInput(
  input: BrandDirectionDraftInput,
  profileId: string,
  prior: BrandDirectionDraft | null,
): BrandDirectionDraft {
  const revision = prior?.revision ?? 1;
  return buildDraft(input, profileId, revision, new Date().toISOString());
}

export function restoreBrandDirectionDraft(raw: string | null, profileId: string): BrandDirectionDraft | null {
  if (raw === null) return null;
  if (raw.length > brandDirectionStorageByteLimit) {
    throw new Error('Saved brand direction draft is too large. Nothing was overwritten.');
  }
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid saved brand direction draft. Nothing was overwritten.');
  }
  const record = value as BrandDirectionDraft;
  if (record.version !== 1 || record.profileId !== profileId) {
    throw new Error('Invalid or mismatched brand direction draft. Nothing was overwritten.');
  }
  const revision = parseRevision(record.revision);
  const input = editBrandDirectionDraft(record);
  return buildDraft(input, profileId, revision, parseUpdatedAt(record.updatedAt));
}

export function persistBrandDirectionDraft(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  profileId: string,
  expectedRaw: string | null,
  draft: BrandDirectionDraft,
): string {
  const key = brandDirectionStorageKey(profileId);
  if (storage.getItem(key) !== expectedRaw) {
    throw new Error(
      'Brand direction draft changed in another tab. Your unsaved changes remain; copy them before reloading the saved draft.',
    );
  }
  const checked = restoreBrandDirectionDraft(JSON.stringify(draft), profileId);
  if (!checked) throw new Error('Invalid brand direction draft.');
  const raw = JSON.stringify(checked);
  if (raw.length > brandDirectionStorageByteLimit) {
    throw new Error('Brand direction storage limit reached. Your unsaved changes remain.');
  }
  storage.setItem(key, raw);
  return raw;
}

export function brandDirectionDraftAllowlistKeys(): readonly (keyof BrandDirectionDraft)[] {
  return [
    'version',
    'profileId',
    'revision',
    'updatedAt',
    'brandName',
    'positioningLine',
    'toneWords',
    'primaryColor',
    'accentColor',
    'typography',
    'visualDo',
    'visualDont',
  ];
}

export function brandDirectionPreviewAllowlistKeys(): readonly (keyof BrandDirectionPreviewProjection)[] {
  return [
    'disclaimer',
    'statusLabel',
    'brandName',
    'positioningLine',
    'toneWords',
    'primaryColor',
    'accentColor',
    'typographyLabel',
    'typographyStack',
    'visualDo',
    'visualDont',
    'primaryOnPrimary',
    'accentOnAccent',
    'lightSample',
    'darkSample',
  ];
}

export function brandDirectionSampleAllowlistKeys(): readonly (keyof BrandDirectionSampleSwatch)[] {
  return ['surfaceLabel', 'backgroundColor', 'textColor', 'accentColor', 'meetsContrastGoal'];
}

export function suggestBrandNameFromProfile(profile: Pick<Profile, 'name'>): string | null {
  const trimmed = profile.name.trim();
  if (!trimmed || trimmed.length > brandNameLimit) return null;
  return trimmed;
}

export function applyBrandNameFromProfile(
  input: BrandDirectionDraftInput,
  profile: Pick<Profile, 'name'>,
): BrandDirectionDraftInput {
  const suggested = suggestBrandNameFromProfile(profile);
  if (!suggested) {
    throw new Error('Business profile name is empty or too long to use here. Enter a brand name manually.');
  }
  return { ...input, brandName: suggested };
}

function buildSampleSwatch(
  surfaceLabel: string,
  backgroundColor: string,
  accentColor: string,
): BrandDirectionSampleSwatch {
  const textColor = pickReadableTextColor(backgroundColor);
  return {
    surfaceLabel,
    backgroundColor,
    textColor,
    accentColor,
    meetsContrastGoal: meetsReadableContrast(textColor, backgroundColor),
  };
}

export function buildBrandDirectionPreview(draft: BrandDirectionDraft): BrandDirectionPreviewProjection {
  const disclaimer =
    'Manual brand direction draft — not AI-generated branding, not trademark clearance, and not a promise of design approval. Colors and type stacks are for in-app preview only; no logos, uploads, or remote fonts are loaded.';
  const primaryOnPrimary = pickReadableTextColor(draft.primaryColor);
  const accentOnAccent = pickReadableTextColor(draft.accentColor);
  return {
    disclaimer,
    statusLabel: 'Draft · manual direction only',
    brandName: draft.brandName,
    positioningLine: draft.positioningLine,
    toneWords: [...draft.toneWords],
    primaryColor: draft.primaryColor,
    accentColor: draft.accentColor,
    typographyLabel: labelForTypography(draft.typography),
    typographyStack: stackForTypography(draft.typography),
    visualDo: draft.visualDo ?? null,
    visualDont: draft.visualDont ?? null,
    primaryOnPrimary,
    accentOnAccent,
    lightSample: buildSampleSwatch('Light surface sample', '#f5f4f1', draft.accentColor),
    darkSample: buildSampleSwatch('Dark surface sample', '#141226', draft.accentColor),
  };
}

export function projectBrandDirectionPreview(draft: BrandDirectionDraft): BrandDirectionPreviewProjection {
  return buildBrandDirectionPreview(draft);
}
