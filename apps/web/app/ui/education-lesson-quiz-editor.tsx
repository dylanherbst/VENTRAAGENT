'use client';
import { useEffect, useRef, useState } from 'react';
import type { EducationLessonQuizDraftInput, EducationQuizQuestionInput } from '../../lib/local-education-course';
import {
  blankEducationQuizQuestionInput,
  educationQuizAuthorNotesLimit,
  educationQuizMaxOptions,
  educationQuizMaxQuestionsPerLesson,
  educationQuizMinOptions,
  educationQuizOptionTextLimit,
  educationQuizPromptLimit,
  reorderQuizQuestionInputs,
} from '../../lib/local-education-course';

type Props = {
  lessonIndex: number;
  quiz: EducationLessonQuizDraftInput | undefined;
  onChange: (quiz: EducationLessonQuizDraftInput | undefined) => void;
  disabled?: boolean;
};

function cloneQuiz(quiz: EducationLessonQuizDraftInput | undefined): EducationLessonQuizDraftInput | undefined {
  if (!quiz) return undefined;
  return {
    questions: quiz.questions.map(q => ({
      ...q,
      options: q.options.map(o => ({ ...o })),
    })),
  };
}

export default function EducationLessonQuizEditor({ lessonIndex, quiz, onChange, disabled }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<EducationLessonQuizDraftInput | undefined>(() => cloneQuiz(quiz));
  const hasSavedQuiz = Boolean(quiz?.questions.length);
  const quizToggleButton = useRef<HTMLButtonElement>(null);
  const returnFocusToToggle = useRef(false);

  useEffect(() => {
    if (!editing) setDraft(cloneQuiz(quiz));
  }, [quiz, editing]);

  useEffect(() => {
    if (editing || !returnFocusToToggle.current) return;
    returnFocusToToggle.current = false;
    quizToggleButton.current?.focus();
  }, [editing]);

  function startEdit() {
    setDraft(cloneQuiz(quiz) ?? { questions: [] });
    setEditing(true);
  }

  function closeQuizEditor() {
    returnFocusToToggle.current = true;
    setEditing(false);
  }

  function cancelEdit() {
    setDraft(cloneQuiz(quiz));
    closeQuizEditor();
  }

  function applyToLesson(next: EducationLessonQuizDraftInput | undefined) {
    if (!next?.questions.length) {
      onChange(undefined);
      return;
    }
    onChange(next);
  }

  function saveQuizEdits() {
    applyToLesson(draft?.questions.length ? draft : undefined);
    closeQuizEditor();
  }

  function updateQuestion(qIndex: number, patch: Partial<EducationQuizQuestionInput>) {
    setDraft(current => {
      const base = current ?? { questions: [] };
      const questions = [...base.questions];
      questions[qIndex] = { ...questions[qIndex], ...patch };
      return { questions };
    });
  }

  function updateOption(qIndex: number, oIndex: number, text: string) {
    setDraft(current => {
      if (!current) return current;
      const questions = [...current.questions];
      const options = [...questions[qIndex].options];
      options[oIndex] = { ...options[oIndex], text };
      questions[qIndex] = { ...questions[qIndex], options };
      return { questions };
    });
  }

  function addQuestion() {
    setDraft(current => {
      const base = current ?? { questions: [] };
      if (base.questions.length >= educationQuizMaxQuestionsPerLesson) return base;
      const question = blankEducationQuizQuestionInput();
      question.id = window.crypto.randomUUID();
      question.options = question.options.map(opt => ({
        ...opt,
        id: window.crypto.randomUUID(),
      }));
      return { questions: [...base.questions, question] };
    });
  }

  function removeQuestion(qIndex: number) {
    setDraft(current => {
      if (!current) return current;
      const questions = current.questions.filter((_, i) => i !== qIndex);
      return questions.length ? { questions } : { questions: [] };
    });
  }

  function addOption(qIndex: number) {
    setDraft(current => {
      if (!current) return current;
      const questions = [...current.questions];
      const options = [...questions[qIndex].options];
      if (options.length >= educationQuizMaxOptions) return current;
      options.push({ id: window.crypto.randomUUID(), text: '' });
      questions[qIndex] = { ...questions[qIndex], options };
      return { questions };
    });
  }

  function removeOption(qIndex: number, oIndex: number) {
    setDraft(current => {
      if (!current) return current;
      const questions = [...current.questions];
      const options = questions[qIndex].options.filter((_, i) => i !== oIndex);
      if (options.length < educationQuizMinOptions) return current;
      const removedId = questions[qIndex].options[oIndex]?.id;
      let correctOptionId = questions[qIndex].correctOptionId;
      if (removedId && correctOptionId === removedId) correctOptionId = '';
      questions[qIndex] = { ...questions[qIndex], options, correctOptionId };
      return { questions };
    });
  }

  const displayQuestions = editing ? draft?.questions ?? [] : quiz?.questions ?? [];

  return (
    <fieldset className="education-lesson-quiz" disabled={disabled}>
      <legend>Lesson quiz (optional, multiple choice)</legend>
      <p className="panel-note">
        Up to {educationQuizMaxQuestionsPerLesson} questions · {educationQuizMinOptions}–{educationQuizMaxOptions} options each ·
        one correct answer · saved with the course draft · not graded or hosted for learners.
      </p>
      {!editing && (
        <p className="subtle-label">
          {hasSavedQuiz
            ? `${quiz!.questions.length} question(s) in this lesson’s saved draft slice.`
            : 'No quiz on this lesson yet.'}
        </p>
      )}
      {editing && (
        <>
          {displayQuestions.map((question, qIndex) => (
            <div className="education-quiz-question" key={question.id || `q-${qIndex}`}>
              <p className="subtle-label">Question {qIndex + 1}</p>
              <label>
                Prompt
                <input
                  required
                  maxLength={educationQuizPromptLimit}
                  value={question.prompt}
                  onChange={e => updateQuestion(qIndex, { prompt: e.target.value })}
                />
              </label>
              <fieldset>
                <legend>Answer options</legend>
                {question.options.map((option, oIndex) => (
                  <label key={option.id || `o-${oIndex}`} className="education-quiz-option-row">
                    <input
                      type="radio"
                      name={`lesson-${lessonIndex}-q-${qIndex}-correct`}
                      checked={question.correctOptionId === option.id}
                      onChange={() => updateQuestion(qIndex, { correctOptionId: option.id })}
                      aria-label={`Mark option ${oIndex + 1} as correct`}
                    />
                    <input
                      required
                      maxLength={educationQuizOptionTextLimit}
                      value={option.text}
                      placeholder={`Option ${oIndex + 1}`}
                      onChange={e => updateOption(qIndex, oIndex, e.target.value)}
                    />
                    <button
                      type="button"
                      disabled={question.options.length <= educationQuizMinOptions}
                      onClick={() => removeOption(qIndex, oIndex)}
                    >
                      Remove option
                    </button>
                  </label>
                ))}
                <button
                  type="button"
                  disabled={question.options.length >= educationQuizMaxOptions}
                  onClick={() => addOption(qIndex)}
                >
                  Add option
                </button>
              </fieldset>
              <label>
                Author notes (not shown in learner preview)
                <textarea
                  maxLength={educationQuizAuthorNotesLimit}
                  rows={2}
                  value={question.authorNotes}
                  onChange={e => updateQuestion(qIndex, { authorNotes: e.target.value })}
                />
              </label>
              <span className="education-lesson-order">
                <button
                  type="button"
                  aria-label={`Move question ${qIndex + 1} up`}
                  disabled={qIndex === 0}
                  onClick={() => setDraft(c => ({ questions: reorderQuizQuestionInputs(c!.questions, qIndex, -1) }))}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`Move question ${qIndex + 1} down`}
                  disabled={qIndex === displayQuestions.length - 1}
                  onClick={() => setDraft(c => ({ questions: reorderQuizQuestionInputs(c!.questions, qIndex, 1) }))}
                >
                  ↓
                </button>
                <button type="button" onClick={() => removeQuestion(qIndex)}>Remove question</button>
              </span>
            </div>
          ))}
          <button
            type="button"
            disabled={displayQuestions.length >= educationQuizMaxQuestionsPerLesson}
            onClick={addQuestion}
          >
            Add question
          </button>
        </>
      )}
      <div className="setup-actions">
        {!editing && (
          <button type="button" ref={quizToggleButton} onClick={startEdit}>
            {hasSavedQuiz ? 'Edit lesson quiz' : 'Add lesson quiz'}
          </button>
        )}
        {editing && (
          <>
            <button type="button" className="primary-button" onClick={saveQuizEdits}>
              Apply quiz to lesson
            </button>
            <button type="button" onClick={cancelEdit}>Cancel quiz edits</button>
            {hasSavedQuiz && (
              <button
                type="button"
                onClick={() => {
                  setDraft({ questions: [] });
                  applyToLesson(undefined);
                  closeQuizEditor();
                }}
              >
                Remove quiz from lesson
              </button>
            )}
          </>
        )}
      </div>
    </fieldset>
  );
}
