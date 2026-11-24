/** Future private course record — not persisted by the browser-local S03 slice. */
export type EducationPrivateCourse = {
  workspaceId: string;
  courseId: string;
  revision: string;
  status: 'draft' | 'published' | 'archived';
  visibility: 'private' | 'unlisted' | 'public';
  title: string;
  summary: string;
  lessonCount: number;
  publishedAt: string | null;
};

/** Future learner entitlement — browser preview never creates one of these. */
export type EducationEnrollment = {
  workspaceId: string;
  courseId: string;
  learnerId: string;
  entitled: boolean;
  source: 'purchase' | 'membership' | 'manual' | 'staff';
  grantedAt: string | null;
  expiresAt: string | null;
};

export type EducationLessonProgressRecord = {
  workspaceId: string;
  courseId: string;
  learnerId: string;
  lessonId: string;
  completedAt: string | null;
  lastOpenedAt: string;
};

export type EducationCourseAsset = {
  workspaceId: string;
  courseId: string;
  lessonId: string;
  assetId: string;
  kind: 'video' | 'file' | 'transcript';
  status: 'pending' | 'ready' | 'failed';
  storageKey: string | null;
};

export type GetPrivateCourseRequest = { workspaceId: string; courseId: string };
export type GetPrivateCourseResponse =
  | { configured: true; course: EducationPrivateCourse }
  | EducationApiUnavailable;

export type ListEnrollmentsRequest = { workspaceId: string; courseId: string; learnerId?: string };
export type ListEnrollmentsResponse =
  | { configured: true; enrollments: EducationEnrollment[] }
  | EducationApiUnavailable;

export type UpsertLessonProgressRequest = {
  workspaceId: string;
  courseId: string;
  learnerId: string;
  lessonId: string;
  completed: boolean;
  idempotencyKey: string;
};
export type UpsertLessonProgressResponse =
  | { configured: true; progress: EducationLessonProgressRecord }
  | EducationApiUnavailable;

export type RegisterCourseAssetRequest = {
  workspaceId: string;
  courseId: string;
  lessonId: string;
  kind: EducationCourseAsset['kind'];
  filename: string;
  contentType: string;
};
export type RegisterCourseAssetResponse =
  | { configured: true; asset: EducationCourseAsset; uploadUrl: string }
  | EducationApiUnavailable;

export type EducationApiUnavailable = {
  configured: false;
  error: string;
};

/** Explicit stub for UI and future client adapters — no network call is made in S03. */
export function educationApiNotConnected(): EducationApiUnavailable {
  return {
    configured: false,
    error: 'Education API is not connected. Browser-local course drafts and learner preview only.',
  };
}

export function describeEducationApiBoundary(): string {
  return 'Private course, enrollment, progress and asset contracts live in education-api-contract.ts; wire to authenticated workspace APIs after backend setup.';
}
