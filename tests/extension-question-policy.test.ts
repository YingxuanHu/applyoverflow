import test from "node:test";
import assert from "node:assert/strict";
import { questionAssistance } from "../src/lib/extension-suggestions";
import { canPrepareAnswer } from "../extensions/chrome/answer-runner.mjs";

const professionalQuestions = [
  ["What professional accomplishment are you most proud of?", "draft"],
  ["Which project best demonstrates your abilities?", "draft"],
  ["What is the most impactful thing you have built?", "draft"],
  ["In 50 words or less, what have you built that you're proud of?", "draft"],
  ["Give an example of a project where you improved a process.", "draft"],
  ["Walk us through a technical achievement and its impact.", "draft"],
  ["What was your contribution to a recent project?", "draft"],
  ["How did you validate the output of your document classifier project?", "draft"],
  ["Professional accomplishments (maximum 200 characters)", "draft"],
  ["Describe your data visualization project.", "draft"],
  ["Describe your experience building tracing tools.", "draft"],
  ["Describe a project involving a disagreement over the implementation.", "draft"],
  ["Describe how you addressed race conditions in your project", "draft"],
  ["How did you address reliability issues in your project?", "draft"],
  ["How do you address concurrency failures in a system?", "draft"],
  ["Describe email delivery pipeline you built", "draft"],
  ["Describe an email notification service you built.", "draft"],
  ["Which programming languages have you used professionally?", "qualification"],
  ["What technologies do you have experience with?", "qualification"],
  ["Please select the tools with which you are proficient.", "qualification"],
  ["Which of the following skills do you have?", "qualification"],
  ["Choose a framework you have used to build an application.", "qualification"],
  ["List the software platforms you have worked with.", "qualification"],
  ["Programming languages you have experience with", "qualification"],
  ["(Required) Please indicate your technical skills.", "qualification"],
  ["(Optional) Please do you have experience managing a project?", "qualification"],
  ["3. Have you built reporting applications?", "qualification"],
  ["Are you proficient in spreadsheet modeling?", "qualification"],
  ["How long have you worked with Python?", "qualification"],
  ["What is your highest level of education?", "qualification"],
  ["Highest completed education *", "qualification"],
  ["Please select your highest educational qualification.", "qualification"],
  ["What is the highest degree you have earned?", "qualification"],
  ["Do you hold a bachelor's degree?", "qualification"],
  ["Do you have a master's degree in finance?", "qualification"],
  ["List your professional certifications.", "qualification"],
  ["Which certifications have you earned?", "qualification"],
  ["Are you AWS certified?", "qualification"],
  ["Do you hold a valid professional license?", "qualification"],
  ["Please describe your professional credentials.", "qualification"],
  ["Which programming language are you most confident in? Describe a feature you built.", "context"],
  ["What would you build with your documented technology stack?", "context"],
] as const;

for (const [label, kind] of professionalQuestions) {
  test(`professional policy: ${label}`, () => {
    assert.equal(questionAssistance(label), kind);
    // The injected review UI stringifies this function; keep it self-contained.
    const browserPolicy = (0, eval)(`(${questionAssistance.toString()})`);
    assert.equal(browserPolicy(label), kind);
    assert.equal(canPrepareAnswer({ id: "fixture", label, kind: "text", state: "needed", canAnswer: true }), true);
    if (kind === "qualification") {
      for (const control of ["select", "combobox", "radio"])
        assert.equal(canPrepareAnswer({ id: "fixture", label, kind: control, state: "needed", canAnswer: true }), true);
    }
  });
}

const personalQuestions = [
  "What country do you live in?",
  "Which countries can you work in?",
  "What is your nationality?",
  "Are you legally allowed to work here?",
  "Do you require a visa or sponsorship?",
  "What is your gender?",
  "Are you a veteran?",
  "Do you have a disability?",
  "What is your race or ethnicity?",
  "What is your sexual orientation?",
  "What is your marital status?",
  "Do you identify as Indigenous?",
  "Do you need an accommodation?",
  "Are you 18 or older?",
  "Do you consent to a background check?",
  "I certify this information is accurate.",
  "Do you agree to the terms?",
  "Do you accept the privacy policy?",
  "Please confirm this information is accurate.",
  "Do you have relatives or friends at this company?",
  "Were you referred by an employee?",
  "Have you ever been employed with this company?",
  "Do you have a conflict of interest?",
  "Do you know anyone working at this company?",
  "Have you worked here before?",
  "What is your notice period?",
  "When could you start?",
  "What weekdays are you available?",
  "Can you work evenings?",
  "Please confirm you can work night shifts.",
  "Can you commit to 40 hours per week?",
  "Are you able to work remotely?",
  "Are you willing to travel?",
  "What is your desired pay?",
  "What are your compensation expectations?",
  "Are you open to relocation?",
  "What is your preferred work arrangement?",
  "Which programming language do you prefer?",
  "What is your favorite framework?",
  "Where would you work?",
  "Are you based in Canada?",
  "Do you have a driver's license?",
  "How long do you anticipate working in a part time role?",
  "What is your email address?",
  "What is your email?",
  "What is your address?",
  "What is your race?",
];

for (const question of personalQuestions) {
  test(`personal clauses override every professional category: ${question}`, () => {
    for (const professional of [
      "", "Describe a project you built. ", "Which technologies have you used? ",
      "Highest completed education. ", "List professional certifications. ",
      "What would you build? ",
      "Describe how you addressed race conditions in your project. ",
      "How did you address reliability issues in your project? ",
      "Describe email delivery pipeline you built. ",
    ]) {
      for (const label of [`${professional}${question}`, `${question} ${professional}`]) {
        assert.equal(questionAssistance(label), "personal", label);
        assert.equal(canPrepareAnswer({ id: "fixture", label, kind: "text", state: "needed", canAnswer: true }), false);
      }
    }
  });
}

test("unknown questions fail closed and labels tolerate common ATS formatting", () => {
  for (const label of ["", "Additional information", "Choose an option", "Please specify", "How did you hear about us?"])
    assert.equal(questionAssistance(label), "personal", label);
  assert.equal(questionAssistance("  (Required)\nPlease\t DO YOU HAVE experience with SQL? *  "), "qualification");
});

test("technical wording never hides applicant details within the same clause", () => {
  for (const label of [
    "Describe your race and the race conditions you addressed in your project.",
    "Describe email delivery pipeline you built and provide your email.",
    "How did you address reliability issues in your project, and what is your address?",
    "Describe a project using your personal email address.",
    "How did you address your work authorization for this project?",
    "Describe how your race affected your project experience.",
    "How did you address a project and confirm your consent?",
  ]) assert.equal(questionAssistance(label), "personal", label);
});
