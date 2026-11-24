import { courseDraftFromInput, editEducationCourseDraft, type EducationCourseDraftInput } from './local-education-course.ts';
import { uuid } from './workspace-validation.ts';

export type AccountCourse = { id: string; revision: number; course: EducationCourseDraftInput };
export type CourseRequest = (url: string, init?: RequestInit) => Promise<Response>;
export async function accountRequest(url: string, init?: RequestInit, request: CourseRequest = fetch): Promise<Record<string, unknown>> {
  const response = await request(url, { ...init, credentials: 'same-origin', cache: 'no-store' });
  const body: unknown = await response.json();
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid account response. Your editor is unchanged.');
  const result = body as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'Account request failed. Your editor is unchanged.');
  return result;
}
export async function loadAccountCourses(workspace: string, request?: CourseRequest): Promise<AccountCourse[]> {
  uuid(workspace);
  const result = await accountRequest(`/api/workspace/courses?workspace=${encodeURIComponent(workspace)}`, undefined, request);
  if (!Array.isArray(result.courses)) throw new Error('Invalid course list. Your editor is unchanged.');
  const courses = result.courses.map((row: unknown) => {
    if (!row || typeof row !== 'object') throw new Error('Invalid account course.');
    const item = row as Record<string, unknown>;
    const id = uuid(item.id);
    if (!Number.isSafeInteger(item.revision) || (item.revision as number) < 1) throw new Error('Invalid course revision.');
    const course = editEducationCourseDraft(courseDraftFromInput(item.data as EducationCourseDraftInput, {id, profileId: workspace}));
    return {id, revision: item.revision as number, course};
  });
  if (new Set(courses.map(item => item.id)).size !== courses.length) throw new Error('Duplicate account courses.');
  return courses;
}
export async function saveAccountCourse(workspace: string, item: AccountCourse, request?: CourseRequest): Promise<AccountCourse> {
  uuid(workspace); uuid(item.id);
  if (!Number.isSafeInteger(item.revision) || item.revision < 0) throw new Error('Refresh before saving.');
  const course = editEducationCourseDraft(courseDraftFromInput(item.course, {id:item.id, profileId:workspace}));
  const result = await accountRequest('/api/workspace/courses', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({workspace,id:item.id,revision:item.revision,course})}, request);
  if (result.saved !== true || result.revision !== item.revision + 1) throw new Error('Save could not be verified. Refresh account courses before retrying.');
  return {...item, course, revision:result.revision as number};
}
