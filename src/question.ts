import type { QuestionFixture } from "./types";

export const POC_QUESTION: QuestionFixture = {
  id: "paris-timing-fixture-v1",
  prompt: "Which city is this landmark in?",
  imageUrl: "/question-paris.svg",
  choices: [
    { id: "london", label: "London" },
    { id: "paris", label: "Paris" },
    { id: "rome", label: "Rome" },
    { id: "vienna", label: "Vienna" },
  ],
  correctChoiceId: "paris",
  note: "Static POC fixture. It is not part of the future Question Bank.",
};
