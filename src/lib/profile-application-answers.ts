import { z } from "zod";
import { applicationContext } from "../../extensions/chrome/sites.mjs";

// Voluntary answers are user-entered only. Never derive them from a resume,
// location, name, recommendations, or an AI-generated answer.
export const applicationAnswerFields = [
  { key: "gender", label: "Gender identity", options: ["Woman", "Man", "Non-binary", "Prefer not to answer"] },
  { key: "transgender", label: "Transgender identity", options: ["Yes", "No", "Prefer not to answer"] },
  { key: "sexualOrientation", label: "Sexual orientation", options: ["Heterosexual", "Gay", "Lesbian", "Bisexual", "Asexual", "Pansexual", "Queer", "Prefer not to answer"] },
  { key: "ethnicity", label: "Race or ethnicity", options: ["American Indian or Alaska Native", "Asian", "Black or African American", "Hispanic or Latino", "Native Hawaiian or Other Pacific Islander", "White", "Two or more races", "Prefer not to answer"] },
  { key: "hispanicLatino", label: "Hispanic or Latino", options: ["Yes", "No", "Prefer not to answer"] },
  { key: "veteran", label: "U.S. protected veteran status", options: ["I identify as one or more of the classifications of a protected veteran", "I am not a protected veteran", "I don't wish to answer"] },
  { key: "disability", label: "Disability status (current or past)", options: ["Yes, I have a disability, or have had one in the past", "No, I do not have a disability and have not had one in the past", "I do not want to answer"] },
  { key: "limitingDisability", label: "Currently have a disability that limits daily activities", options: ["Yes", "No", "Prefer not to answer"] },
  { key: "physicalDisability", label: "Currently have a physical disability", options: ["Yes", "No", "Prefer not to answer"] },
  { key: "veteranOrActiveUS", label: "U.S. veteran or active member of the Armed Forces", options: ["Yes", "No", "Prefer not to answer"] },
  { key: "over18", label: "At least 18 years old", options: ["Yes", "No"] },
  { key: "authorizedCA", label: "Legally authorized to work in Canada", options: ["Yes", "No"] },
  { key: "authorizedUS", label: "Legally authorized to work in the United States", options: ["Yes", "No"] },
  { key: "sponsorshipCA", label: "Require work sponsorship in Canada, now or in future", options: ["Yes", "No"] },
  { key: "sponsorshipUS", label: "Require work sponsorship in the United States, now or in future", options: ["Yes", "No"] },
  { key: "usPerson", label: "U.S. citizen, permanent resident, or asylee/refugee", options: ["Yes", "No"] },
  { key: "smsUpdates", label: "Receive text messages about my application", options: ["Yes", "No"] },
  { key: "emailUpdates", label: "Receive email updates about my application", options: ["Yes", "No"] },
  { key: "jobSource", label: "Default source when asked how I found a job", options: ["ApplyOverflow", "LinkedIn", "Company careers website", "Indeed", "Other"] },
  { key: "relocation", label: "Willing to relocate", options: ["Yes", "No"] },
] as const;
export const applicationTextFields = [
  { key: "sourceDetails", label: "Other job source", maxLength: 200, type: "text" },
  { key: "startDate", label: "Earliest available start date", maxLength: 10, type: "date" },
  { key: "availability", label: "Days and hours available to work", maxLength: 500, type: "text" },
  { key: "desiredPay", label: "Desired pay (include currency and annual/hourly basis)", maxLength: 200, type: "text" },
  { key: "partTimeReason", label: "Reason for seeking part-time work", maxLength: 1000, type: "text" },
  { key: "partTimeDuration", label: "How long I intend to work part-time", maxLength: 200, type: "text" },
  { key: "visaDetailsUS", label: "U.S. visa type and remaining validity, if applicable", maxLength: 500, type: "text" },
] as const;
export const employerAnswerFields = [
  { key: "employeeRelationship", label: "Relatives or close personal ties at this employer" },
  { key: "referral", label: "Referred by an employee of this employer" },
  { key: "previousEmployment", label: "Previously employed by this employer" },
] as const;
export type ApplicationAnswerKey = typeof applicationAnswerFields[number]["key"] | typeof applicationTextFields[number]["key"];
export type EmployerAnswers = { url: string; employeeRelationship?: string; relationshipDetails?: string; referral?: string; referralName?: string; previousEmployment?: string };
export type ProfileApplicationAnswers = { enabled: boolean; values: Partial<Record<ApplicationAnswerKey, string>>; employers?: EmployerAnswers[] };
const shape = {
  ...Object.fromEntries(applicationAnswerFields.map(field => [field.key, z.enum(["", ...field.options]).optional()])),
  ...Object.fromEntries(applicationTextFields.map(field => [field.key, field.type === "date"
    ? z.union([z.literal(""), z.iso.date()]).optional() : z.string().trim().max(field.maxLength).optional()])),
};
export const profileApplicationAnswersSchema: z.ZodType<ProfileApplicationAnswers> = z.object({
  enabled: z.boolean(), values: z.object(shape).strict(),
  employers: z.array(z.object({
    url: z.string().trim().max(2000).refine(value => !value || Boolean(applicationContext(value, true)), "Enter an employer application URL."),
    ...Object.fromEntries(employerAnswerFields.map(field => [field.key, z.enum(["", "Yes", "No"]).optional()])),
    relationshipDetails: z.string().trim().max(500).optional(), referralName: z.string().trim().max(200).optional(),
  }).strict()).max(12).optional(),
}).strict();

export function normalizeApplicationAnswers(raw: unknown): ProfileApplicationAnswers {
  const parsed = profileApplicationAnswersSchema.safeParse(raw);
  return parsed.success ? parsed.data : { enabled: false, values: {} };
}

const cleanQuestion = (label: string) => label.normalize("NFKC").replace(/[\u2018\u2019]/g, "'")
  .replace(/[*:\u2731\u2217]/g, "").replace(/\(optional\)|\(required\)/gi, "").trim().replace(/\s+/g, " ").toLowerCase();

export function applicationAnswerKey(label: string, employmentCountry?: "CA" | "US"): ApplicationAnswerKey | undefined {
  let text = cleanQuestion(label);
  if (employmentCountry) {
    const country = employmentCountry === "CA" ? "Canada" : "United States";
    text = text.replace(/\bthe country of employment(?: for this position)?\b|\bthe country (?:where|in which) (?:this|the) (?:role|position|job) is (?:based|located)\b|\bwhere (?:this|the) (?:role|position|job) is based\b/g, country.toLowerCase());
  }
  // Compound declarations and attestations are not a synonym for a profile fact.
  if (/certify|attest|signature|agree to|terms|privacy|background check|criminal|convict/.test(text)) return;
  if (/^(?:gender|gender identity|i identify my gender as|what is your gender(?: identity)?\??|which gender do you identify as\??|how (?:do|would) you (?:describe|identify) your gender(?: identity)?\??(?: \(mark all that apply\))?)$/.test(text)) return "gender";
  if (/^(?:race|ethnicity|race\/ethnicity|race or ethnicity|racial or ethnic identity|i identify my ethnicity as|please indicate your race or ethnicity\??|what is your race and ethnicity\??|how would you describe your racial\/ethnic background\??(?: \(mark all that apply\))?)$/.test(text)) return "ethnicity";
  if (/^(?:do you identify as transgender|are you transgender|i identify as transgender)\??$/.test(text)) return "transgender";
  if (/^(?:sexual orientation|i identify my sexual orientation as|what is your sexual orientation|how would you describe your sexual orientation)(?:\?)?(?: \(mark all that apply\))?$/.test(text)) return "sexualOrientation";
  if (/^do you (?:currently )?have a disability (?:or chronic condition )?(?:\([^)]*\) )?that (?:substantially )?limits? (?:one or more of )?your (?:major )?(?:daily|life) activities(?:, including[^?]*)?\??$/.test(text)) return "limitingDisability";
  if (/^are you (?:a veteran or active member|an active member or veteran) of the (?:united states|u\.?s\.?) (?:armed forces|military)\??$/.test(text)) return "veteranOrActiveUS";
  if (/^(?:are you hispanic(?: or |\/)latino\??|hispanic or latino)$/.test(text)) return "hispanicLatino";
  if (/^(?:veteran status|protected veteran status|u\.?s\.? protected veteran status|please (?:select|indicate) your (?:protected )?veteran status[.!?]?)$/.test(text)) return "veteran";
  if (/^(?:disability status|disability|voluntary self-identification of disability|please (?:select|indicate) your disability status[.!?]?)$/.test(text)) return "disability";
  if (/^(?:i have a physical disability|do you (?:currently )?have a physical disability)\??$/.test(text)) return "physicalDisability";
  if (/^are you (?:at least 18(?: years old| years of age)?|18 years (?:of age or older|old or older))\??$/.test(text)) return "over18";
  const us = /\bunited states\b|\bu\.?s\.?a?\b|\bh[- ]?1[- ]?b\b/.test(text), ca = /\bcanada\b|\bcanadian\b/.test(text);
  if (us !== ca) {
    if (/\b(?:authorized|authorised|authorization|authorisation|legally eligible|legal right|eligibility)\b/.test(text) && /\bwork\b/.test(text) &&
      !/sponsor|visa|citizen|permanent resident|without|unrestricted|indefinite|proof|document|\bnot\b/.test(text)) return us ? "authorizedUS" : "authorizedCA";
    if (/\b(?:need|require)\b/.test(text) && /sponsor/.test(text) && /(?:now|currently).{0,30}(?:future|later)/.test(text) &&
      !/without|not require|will not|other countr/.test(text)) return us ? "sponsorshipUS" : "sponsorshipCA";
    if (us && /\bcitizen\b/.test(text) && /permanent resident|green card/.test(text) && /asylee|refugee/.test(text) &&
      !/export|itar|security clearance|born|only|not a/.test(text)) return "usPerson";
  }
  if (/receive|receiving|contact|opt[ -]?in/.test(text) && /application|hiring|recruit/.test(text) &&
    !/marketing|promotional|advertis|third.part|partners/.test(text)) {
    if (/text messages|sms/.test(text) && !/email|e-mail/.test(text)) return "smsUpdates";
    if (/email|e-mail/.test(text) && !/text messages|sms/.test(text)) return "emailUpdates";
  }
  if (/^how did you (?:initially )?(?:hear|learn|find out) about (?:(?:this|the|our) (?:position|role|job(?: opening)?|opportunity|opening)(?: with .+)?|us)\??$|^where did you (?:hear about|find) (?:this|the) (?:job|role|position|opening)\??$/.test(text)) return "jobSource";
  if (/^(?:earliest (?:available )?start date|(?:date |when are you |when would you be )available(?: to start(?: work)?)?|when (?:can|could) you start(?: work)?|availability date)\??$/.test(text)) return "startDate";
  if (/^(?:what (?:weekdays|days)(?: and times| and hours)? are you available(?: to work)?|(?:work |weekly )?availability|available (?:days|hours)(?: and (?:days|hours))?)\??$/.test(text)) return "availability";
  if (/^(?:please (?:indicate|provide) |what are )?(?:your )?(?:desired (?:starting )?(?:pay|salary(?: expectations)?|compensation)|salary expectations)(?:\s*\([^)]*\))?[.!?]?$/.test(text)) return "desiredPay";
  if (/^(?:please )?(?:explain|describe) why you are interested in part[ -]time employment[.!?]?$/.test(text)) return "partTimeReason";
  if (/^how long do you (?:anticipate|intend|plan on) working in a part[ -]time role\??$/.test(text)) return "partTimeDuration";
  if (/^are you (?:willing|open) to relocat(?:e|ion)\??$/.test(text)) return "relocation";
}

export type CommonAnswer = { label: string; answer: string; answerKey: string; alternatives?: string[]; dependsOn?: { answerKey: string; answer: string } };
export type CommonAnswerDetail = { label: string; profileLabel: string; reason: string; answerKey: string; notApplicable?: boolean; dependsOn?: { answerKey: string; answer: string } };
export function applicationAnswerPlan(raw: unknown, labels: string[], url?: string, employmentCountry?: "CA" | "US") {
  const saved = normalizeApplicationAnswers(raw);
  const context = url && applicationContext(url, true);
  const employers = saved.employers?.filter(e => e.url && applicationContext(e.url, true)?.companyKey === (context && context.companyKey));
  const employer = employers?.length === 1 ? employers[0] : undefined;
  const answers: CommonAnswer[] = [], details: CommonAnswerDetail[] = [];
  labels.forEach((label, index) => {
    const text = cleanQuestion(label), previous = cleanQuestion(labels[index - 1] || "");
    let key: string | undefined = applicationAnswerKey(label, employmentCountry);
    let notApplicable = false;
    let answer = key ? saved.values[key as ApplicationAnswerKey] : undefined;
    let profileLabel: string | undefined = [...applicationAnswerFields, ...applicationTextFields].find(f => f.key === key)?.label;
    if (/^desired salary \((?:amount|currency)\)$/.test(text)) {
      answer = undefined;
      const pay = /^(USD|CAD)\s*\$?\s*((?:[1-9]\d{0,2}(?:,\d{3})+|[1-9]\d*)(?:\.\d{1,2})?)\s*(?:\/\s*year|per year|annually|per annum)$/i.exec(saved.values.desiredPay || "");
      key = text.endsWith("(amount)") ? "desiredPayAmount" : "desiredPayCurrency";
      profileLabel = "Desired pay with annual amount and currency";
      if (pay && Number(pay[2].replaceAll(",", "")) <= 1_000_000_000)
        answer = key === "desiredPayAmount" ? pay[2].replaceAll(",", "") : `${pay[1].toUpperCase()} $`;
    }
    if (/^if ["']?other\b/.test(text) && applicationAnswerKey(labels[index - 1] || "") === "jobSource") {
      key = "sourceDetails"; profileLabel = "Other job source";
      answer = saved.values.jobSource === "ApplyOverflow" ? "ApplyOverflow" : saved.values.jobSource === "Other" ? saved.values.sourceDetails : undefined;
    }
    const tenant = context && context.tenant.replace(/[^a-z0-9]/gi, "").toLowerCase();
    const sameEmployer = Boolean(tenant && tenant.length >= 4 && text.replace(/[^a-z0-9]/g, "").includes(tenant)) || /\b(?:this|our) (?:company|employer|organization)\b/.test(text) || /^have you ever worked for us before\??$/.test(text);
    const relationship = sameEmployer && /related to|relatives?\b|family member|close personal ties/.test(text) && /employ(?:ee|ed)|team member/.test(text) && !/government|official|politic|client|customer/.test(text);
    const referral = sameEmployer && /(?:were|are|have) you (?:been )?referred/.test(text) && /employee/.test(text);
    const former = sameEmployer && /have you (?:ever |previously )?(?:been )?(?:employed|worked) (?:by|with|at|for)/.test(text) && !/government|agency|competitor|client/.test(text);
    if (relationship || referral || former) {
      key = relationship ? "employeeRelationship" : referral ? "referral" : "previousEmployment";
      profileLabel = employerAnswerFields.find(f => f.key === key)?.label;
      answer = employer?.[key as keyof EmployerAnswers];
    }
    if (/if (?:applicable|yes).{0,40}(?:name|relationship)/.test(text) && /related to|personal ties|relatives?/.test(previous)) {
      key = "relationshipDetails"; profileLabel = "Relationship details for this employer";
      answer = employer?.employeeRelationship === "Yes" ? employer.relationshipDetails : undefined;
      notApplicable = employer?.employeeRelationship === "No";
    }
    if (/if you were referred, who should we thank|(?:referrer's|referring employee'?s?) name/.test(text)) {
      key = "referralName"; profileLabel = "Referrer at this employer";
      answer = employer?.referral === "Yes" ? employer.referralName : undefined;
      notApplicable = employer?.referral === "No";
    }
    if (/visa\/sponsorship|visa type/.test(text) && /time remaining|validity|expir/.test(text) && applicationAnswerKey(labels[index - 1] || "") === "sponsorshipUS") {
      key = "visaDetailsUS"; profileLabel = "U.S. visa type and remaining validity";
      answer = saved.values.sponsorshipUS === "Yes" ? saved.values.visaDetailsUS : undefined;
      notApplicable = saved.values.sponsorshipUS === "No";
    }
    if (!key || !profileLabel) return;
    const alternatives = key === "jobSource" && answer === "ApplyOverflow" ? ["Other"] :
      answer === "Prefer not to answer" || answer === "I don't wish to answer" || answer === "I do not want to answer" ? ["Decline to self-identify", "Decline to self identify", "I decline to self-identify", "I prefer not to say", "I prefer not to answer", "Prefer not to say", "Prefer not to answer", "I don't wish to answer", "I do not wish to answer", "I do not want to answer"] :
      key === "gender" ? ({ Man: ["Male"], Woman: ["Female"] } as Record<string, string[]>)[answer || ""] : undefined;
    if (saved.enabled && answer) answers.push({ label, answer, answerKey: key, ...(alternatives ? { alternatives } : {}),
      ...(key === "sourceDetails" ? { dependsOn: { answerKey: "jobSource", answer: "Other" } } :
        key === "desiredPayAmount" ? { dependsOn: { answerKey: "desiredPayCurrency", answer: `${saved.values.desiredPay!.slice(0, 3).toUpperCase()} $` } } : {}) });
    else if (saved.enabled && notApplicable) details.push({ label, profileLabel, answerKey: key, notApplicable: true,
      dependsOn: { answerKey: key === "relationshipDetails" ? "employeeRelationship" : key === "referralName" ? "referral" : "sponsorshipUS", answer: "No" },
      reason: "Not applicable based on your saved answer. Left blank." });
    else details.push({ label, profileLabel, answerKey: key, reason: !saved.enabled
      ? "Enable sharing in Profile > Optional application answers to use your saved choices."
      : `Add ${profileLabel.toLowerCase()} in Profile, or answer on the form.` });
  });
  return { answers, details };
}

export function commonApplicationAnswers(raw: unknown, labels: string[]) {
  return applicationAnswerPlan(raw, labels).answers.map(({ label, answer }) => ({ label, answer }));
}
