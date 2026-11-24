export const contentPlatforms = ['Instagram', 'Facebook', 'LinkedIn', 'TikTok', 'X', 'Email', 'Blog'] as const;
export type ContentPlatform = (typeof contentPlatforms)[number];
export const contentStatuses = ['idea', 'drafted', 'ready', 'posted-manually'] as const;
export type ContentStatus = (typeof contentStatuses)[number];

export const contentPostLimit = 100;
export const contentTitleLimit = 120;
export const contentBodyLimit = 2000;
const storageByteLimit = 256000;

// Plain guidance only. Shown as a length counter, never enforced.
export const platformGuidance: Record<ContentPlatform, number> = {
  Instagram: 2200,
  Facebook: 63206,
  LinkedIn: 3000,
  TikTok: 2200,
  X: 280,
  Email: 2000,
  Blog: 2000,
};

export type ContentPost = {
  id: string;
  platform: ContentPlatform;
  plannedDate: string;
  title: string;
  body: string;
  status: ContentStatus;
  linkedOfferId?: string;
};

export const contentCalendarStorageKey = (profileId: string) => `launchpad.content-calendar.v1.${profileId}`;

export function isRealDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (y < 1900 || y > 2200) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function blankPost(id: string, plannedDate = ''): ContentPost {
  return { id, platform: contentPlatforms[0], plannedDate, title: '', body: '', status: 'idea' };
}

export function validatePost(post: ContentPost): string[] {
  const problems: string[] = [];
  if (!post || typeof post !== 'object') return ['Post is not valid.'];
  if (typeof post.id !== 'string' || !post.id || post.id.length > 80) problems.push('Post needs an id.');
  if (!(contentPlatforms as readonly string[]).includes(post.platform)) problems.push('Choose a platform from the list.');
  if (!isRealDate(post.plannedDate)) problems.push('Planned date must be a real date (YYYY-MM-DD).');
  if (typeof post.title !== 'string' || !post.title.trim()) problems.push('Title is required.');
  else if (post.title.length > contentTitleLimit) problems.push(`Title must be ${contentTitleLimit} characters or fewer.`);
  if (typeof post.body !== 'string') problems.push('Body must be text.');
  else if (post.body.length > contentBodyLimit) problems.push(`Body must be ${contentBodyLimit} characters or fewer.`);
  if (!(contentStatuses as readonly string[]).includes(post.status)) problems.push('Choose a status from the list.');
  if (post.linkedOfferId !== undefined && (typeof post.linkedOfferId !== 'string' || !post.linkedOfferId || post.linkedOfferId.length > 80)) problems.push('Linked offer is not valid.');
  return problems;
}

function clean(post: ContentPost): ContentPost {
  const out: ContentPost = { id: post.id, platform: post.platform, plannedDate: post.plannedDate, title: post.title.trim(), body: post.body, status: post.status };
  if (post.linkedOfferId) out.linkedOfferId = post.linkedOfferId;
  return out;
}

export function savePost(posts: readonly ContentPost[], post: ContentPost): ContentPost[] {
  const problems = validatePost(post);
  if (problems.length) throw new Error(problems[0]);
  const next = clean(post);
  const exists = posts.some(p => p.id === next.id);
  if (!exists && posts.length >= contentPostLimit) throw new Error(`This browser supports up to ${contentPostLimit} posts.`);
  return exists ? posts.map(p => (p.id === next.id ? next : p)) : [...posts, next];
}

export function removePost(posts: readonly ContentPost[], id: string): ContentPost[] {
  return posts.filter(p => p.id !== id);
}

const byDate = (a: ContentPost, b: ContentPost) => a.plannedDate.localeCompare(b.plannedDate) || a.platform.localeCompare(b.platform) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);

export type PostDay = { date: string; posts: ContentPost[] };
export type PostMonth = { month: string; days: PostDay[] };

export function groupByMonthAndDay(posts: readonly ContentPost[]): PostMonth[] {
  const months: PostMonth[] = [];
  for (const post of [...posts].sort(byDate)) {
    const month = post.plannedDate.slice(0, 7);
    let m = months[months.length - 1];
    if (!m || m.month !== month) { m = { month, days: [] }; months.push(m); }
    let d = m.days[m.days.length - 1];
    if (!d || d.date !== post.plannedDate) { d = { date: post.plannedDate, posts: [] }; m.days.push(d); }
    d.posts.push(post);
  }
  return months;
}

/** Inclusive range of YYYY-MM-DD dates. */
export function postsInRange(posts: readonly ContentPost[], from: string, to: string): ContentPost[] {
  return posts.filter(p => p.plannedDate >= from && p.plannedDate <= to).sort(byDate);
}

export function countsByStatus(posts: readonly ContentPost[]): Record<ContentStatus, number> {
  const counts: Record<ContentStatus, number> = { idea: 0, drafted: 0, ready: 0, 'posted-manually': 0 };
  for (const p of posts) counts[p.status] += 1;
  return counts;
}

export function restoreContentCalendar(raw: string | null, profileId: string): ContentPost[] {
  if (!profileId) throw new Error('Profile is required.');
  if (raw === null) return [];
  if (raw.length > storageByteLimit) throw new Error('Saved content calendar is too large. Nothing was overwritten.');
  let values: unknown;
  try { values = JSON.parse(raw); } catch { throw new Error('Saved content calendar is not valid. Nothing was overwritten.'); }
  if (!Array.isArray(values) || values.length > contentPostLimit) throw new Error('Invalid saved content calendar. Nothing was overwritten.');
  const ids = new Set<string>();
  return values.map(value => {
    const post = value as ContentPost;
    if (!post || typeof post !== 'object' || Array.isArray(post) || validatePost(post).length) throw new Error('Invalid saved post. Nothing was overwritten.');
    if (ids.has(post.id)) throw new Error('Duplicate post IDs. Nothing was overwritten.');
    ids.add(post.id);
    return clean(post);
  });
}

/** Writes the full list only if browser storage still holds exactly what this editor last read. */
export function persistContentCalendar(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  profileId: string,
  expectedRaw: string | null,
  posts: readonly ContentPost[],
): string {
  const key = contentCalendarStorageKey(profileId);
  if (storage.getItem(key) !== expectedRaw) throw new Error('Content calendar changed in another tab. Your unsaved changes remain; copy them before reloading.');
  const checked = restoreContentCalendar(JSON.stringify(posts), profileId);
  const raw = JSON.stringify(checked);
  if (raw.length > storageByteLimit) throw new Error('Content calendar storage limit reached. Your unsaved changes remain.');
  storage.setItem(key, raw);
  return raw;
}
