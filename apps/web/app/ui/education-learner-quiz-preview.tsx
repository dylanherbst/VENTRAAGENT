'use client';
import { useEffect, useState } from 'react';
import type { EducationLearnerQuizProjection } from '../../lib/local-education-course';

type Props = {
  quiz: EducationLearnerQuizProjection;
};

export default function EducationLearnerQuizPreview({ quiz }: Props) {
  const [selections, setSelections] = useState<Record<string, string>>({});

  useEffect(() => {
    setSelections({});
  }, [quiz]);

  return (
    <section className="education-quiz-preview" aria-labelledby="education-quiz-preview-heading">
      <h5 id="education-quiz-preview-heading">Practice quiz preview</h5>
      <p className="subtle-label">
        Read-only learner projection — correct answers and author notes are hidden. Selections are not saved and are not graded.
      </p>
      <ol className="education-quiz-preview-list">
        {quiz.questions.map(question => (
          <li key={question.id}>
            <p>{question.prompt}</p>
            <ul className="education-quiz-preview-options">
              {question.options.map(option => (
                <li key={option.id}>
                  <label className="education-quiz-preview-option">
                    <input
                      type="radio"
                      name={`preview-quiz-${question.id}`}
                      checked={selections[question.id] === option.id}
                      onChange={() => setSelections(current => ({ ...current, [question.id]: option.id }))}
                    />
                    <span className="education-quiz-preview-option-text">{option.text}</span>
                  </label>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  );
}
