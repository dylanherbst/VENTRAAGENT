import assert from 'node:assert/strict';
import test from 'node:test';
import { applyQuizzesToCourse, quizzesFromCourse, restoreLessonQuizzes } from '../lib/lesson-quiz-sync.ts';
import { saveEducationCourseDraft } from '../lib/local-education-course.ts';
import { blankProfile } from '../lib/onboarding.ts';

const profile = { ...blankProfile(), expertise: 'Teaching', audience: 'Creators', goal: 'Launch', educationOffer: 'Course' };
const quiz = { questions: [{ id: 'q1', prompt: 'What is a habit loop?', correctOptionId: 'a', options: [{ id: 'a', text: 'Cue, routine, reward' }, { id: 'b', text: 'Start, middle, end' }] }] };
const course = (withQuiz: boolean) => JSON.stringify(saveEducationCourseDraft({ title: 'Small experiments', summary: 'A short course.', lessons: [
  { id: 'l1', title: 'Notice', content: 'Start small.', durationMinutes: '', ...(withQuiz ? { quizDraft: { questions: quiz.questions.map(q => ({ ...q, authorNotes: '' })) } } : {}) },
  { id: 'l2', title: 'Try', content: 'Run it.', durationMinutes: '' }] } as never, { id: 'c1', profileId: profile.id }));

test('quizzes are read from the saved course draft', () => {
  assert.equal(quizzesFromCourse(null, profile.id), null);
  assert.equal(quizzesFromCourse(course(false), profile.id), null);
  const out = JSON.parse(quizzesFromCourse(course(true), profile.id)!);
  assert.equal(out.quizzes.length, 1);
  assert.equal(out.quizzes[0].lessonId, 'l1');
});
test('restoreLessonQuizzes rejects bad shapes', () => {
  assert.throws(() => restoreLessonQuizzes(null));
  assert.throws(() => restoreLessonQuizzes('{bad'));
  assert.throws(() => restoreLessonQuizzes(JSON.stringify({ version: 2, quizzes: [] })));
  assert.throws(() => restoreLessonQuizzes(JSON.stringify({ version: 1, quizzes: [{ lessonId: 'l1', quiz: { questions: [] } }] })));
  assert.throws(() => restoreLessonQuizzes(JSON.stringify({ version: 1, quizzes: [{ lessonId: 'l1', quiz }, { lessonId: 'l1', quiz }] })));
  assert.equal(restoreLessonQuizzes(JSON.stringify({ version: 1, quizzes: [{ lessonId: 'l1', quiz }] })).quizzes.length, 1);
});
test('applying replaces quizzes and keeps the rest of the course', () => {
  const remote = JSON.stringify({ version: 1, quizzes: [{ lessonId: 'l2', quiz }] });
  const out = JSON.parse(applyQuizzesToCourse(course(true), profile.id, remote));
  assert.equal(out.title, 'Small experiments');
  assert.equal(out.lessons[0].quizDraft, undefined);
  assert.equal(out.lessons[1].quizDraft.questions.length, 1);
  assert.throws(() => applyQuizzesToCourse(null, profile.id, remote));
  assert.throws(() => applyQuizzesToCourse(course(false), profile.id, JSON.stringify({ version: 1, quizzes: [{ lessonId: 'nope', quiz }] })));
});
