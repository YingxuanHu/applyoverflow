import { z } from "zod";
import { applicationContext } from "../../extensions/chrome/sites.mjs";
import { normalizeLocationSubdivision } from "./location-search";

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
  { key: "talentCommunity", label: "Join an employer's talent community for future opportunities", options: ["Yes", "No"] },
  { key: "jobAlerts", label: "Receive email job alerts about future opportunities", options: ["Yes", "No"] },
  { key: "careerNewsletters", label: "Receive career newsletters about news, events and opportunities", options: ["Yes", "No"] },
  { key: "jobSource", label: "Default source when asked how I found a job", options: ["ApplyOverflow", "LinkedIn", "Company careers website", "Indeed", "Other"] },
  { key: "relocation", label: "Willing to relocate", options: ["Yes", "No"] },
  { key: "travel", label: "Willing to travel for work (frequency and destinations unspecified)", options: ["Yes", "No"] },
] as const;
export const applicationTextFields = [
  { key: "sourceDetails", label: "Other job source", maxLength: 200, type: "text" },
  { key: "startDate", label: "Earliest available start date", maxLength: 10, type: "date" },
  { key: "noticePeriod", label: "Notice period (include units, for example 2 weeks)", maxLength: 200, type: "text" },
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
type ApplicationQuestionKey = ApplicationAnswerKey | "talentCommunityNewsletters" | "authorizedCountries";
export type EmployerAnswers = { url: string; employeeRelationship?: string; relationshipDetails?: string; referral?: string; referralName?: string; previousEmployment?: string };
export type CommuteAnswer = { location: string; willingness?: "" | "Yes" | "No" };
export type ProfileApplicationAnswers = { enabled: boolean; values: Partial<Record<ApplicationAnswerKey, string>>; employers?: EmployerAnswers[]; commutes?: CommuteAnswer[] };
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
  commutes: z.array(z.object({
    location: z.string().trim().max(200), willingness: z.enum(["", "Yes", "No"]).optional(),
  }).strict().superRefine((row, ctx) => {
    const message = commuteLocationError(row.location, row.willingness);
    if (message) ctx.addIssue({ code: "custom", path: ["location"], message });
  })).max(12).optional(),
}).strict();

export function normalizeApplicationAnswers(raw: unknown): ProfileApplicationAnswers {
  const parsed = profileApplicationAnswersSchema.safeParse(raw);
  return parsed.success ? parsed.data : { enabled: false, values: {} };
}

const cleanQuestion = (label: string) => label.normalize("NFKC").replace(/[\u2018\u2019]/g, "'")
  .replace(/[*:\u2731\u2217]/g, "").replace(/\(optional\)|\(required\)/gi, "").trim().replace(/\s+/g, " ").toLowerCase();

const reviewOnly = (text: string) => /certif|attest|signature|\bterms\b|privacy|background check|criminal|convict|\b(?:confirm|declare)\b.*\b(?:accurate|truthful|complete|true)\b/.test(text);
type EmploymentCountry = "CA" | "US";
function eligibilityKey(text: string, employmentCountry?: EmploymentCountry): ApplicationAnswerKey | undefined {
  const country = employmentCountry === "CA" || employmentCountry === "US" ? employmentCountry : undefined;
  // Only job context supplied by the caller can resolve an omitted/relative country.
  // Residence, employer hostname and visa examples are not a country fallback.
  let question = text.replace(/\b(?:the )?(?:united states(?: of america)?\b|u\.?s\.?a?\b\.?)/g, "{US}")
    .replace(/\bcanada\b/g, "{CA}");
  if (country) question = question
    .replace(/\bthe country of employment(?: for this position)?\b|\bthe country (?:where|in which) (?:this|the) (?:role|position|job) is (?:based|located)\b|\bthe country (?:where|in which) you (?:are applying|will (?:work|be employed))\b/g, `{${country}}`)
    .replace(/\bwhere (?:this|the) (?:role|position|job) is based\b/g, `in {${country}}`);
  question = question.replace(/[?.!]$/, "").trim();
  const authorization = /^(?:are you (?:currently )?(?:legally )?(?:authorized|authorised|eligible) to work|are you (?:currently )?legally (?:able|permitted) to work|do you (?:currently )?have (?:the )?(?:legal (?:right|authorization|authorisation)|authorization|authorisation) to work|can you legally work)(?: in (\{(?:US|CA)\}))?$/.exec(question);
  if (authorization) {
    const target = authorization[1]?.slice(1, -1) || country;
    return target === "CA" ? "authorizedCA" : target === "US" ? "authorizedUS" : undefined;
  }
  // A now-or-future answer must not be reused for a now-only/future-only question.
  const scope = /(?:, )?\b(?:now|currently),? or (?:(?:at any (?:time|point) )?in (?:the )?)?future\b,?/;
  if (!scope.test(question)) return;
  question = question.replace(scope, "").replace(/\s+/g, " ").trim();
  const sponsorship = /^(?:will|do|would) you (?:need|require) (?:any )?(?:(?:visa|work visa|work authorization|immigration|employment|employment visa|employment[- ]based) )?sponsorship(?: (?:from (?:the|our|your) (?:company|employer)))?(?: (?:to work|for (?:employment(?: visa status)?|work authorization)))?(?: in (\{(?:US|CA)\}))?$/.exec(question);
  if (sponsorship) {
    const target = sponsorship[1]?.slice(1, -1) || country;
    return target === "CA" ? "sponsorshipCA" : target === "US" ? "sponsorshipUS" : undefined;
  }
  // This complete immigration-case wording explicitly names a US visa, not just an employer.
  if (/^will you require [a-z0-9 '&.-]+ to commence or sponsor an immigration case in order to employ you \(for example h[- ]?1[- ]?b or other employment[- ]based immigration\)$/.test(question)) return "sponsorshipUS";
}

function communicationKey(text: string): ApplicationQuestionKey | undefined {
  const question = text.replace(/[?.!]$/, "");
  // Only these informational SMS notices may accompany application-only consent.
  const smsAgreement = /^check yes or no to indicate your agreement to receive text message updates from ([a-z0-9][a-z0-9 &'.,-]{0,119}) regarding your job application(?:\. frequency may vary)?(?:\. message and data rates may apply)?(?:\. reply help for assistance)?(?:\. reply stop to opt out of future messaging)?$/.exec(question);
  if (smsAgreement && !/\s&\s|,(?! (?:inc|llc|ltd|corp)\.?$)|\b(?:and|or|for|with|including|plus|as|behalf|other|partners?|affiliates?|third[ -]part(?:y|ies)|marketing|promotional|advertising|offers?|regarding|receive|consent|agree)\b/.test(smsAgreement[1])) return "smsUpdates";
  const invitation = "(?:(?:would you like|do you want) to|i (?:would like to|want to|consent to|agree to))";
  const newsletterPurpose = "career-related news, events and opportunities";
  const combined = new RegExp(`^(?:${invitation}|select ['\"]yes['\"] to) join (?:(our|the)|([a-z0-9 &.-]+)'s) talent community and receive newsletters to help you stay up to date on ${newsletterPurpose}(?: at ([a-z0-9 &.-]+))?$`).exec(question);
  if (combined && (!combined[3] || (combined[2] && combined[2] === combined[3]))) return "talentCommunityNewsletters";
  if (new RegExp(`^${invitation} (?:join|be (?:a )?part of) (?:the |our |[a-z0-9 &.-]+'s )?talent (?:community|network)(?: for future (?:job |career )?opportunities)?$`).test(question)) return "talentCommunity";
  if (new RegExp(`^${invitation} (?:receive|subscribe to) (?:email (?:job alerts|updates about future (?:jobs|job opportunities|career opportunities))|job alerts (?:by|via) email)$`).test(question)) return "jobAlerts";
  if (new RegExp(`^${invitation} (?:receive|subscribe to) (?:career(?:-related)? newsletters|newsletters (?:about|on) ${newsletterPurpose})$`).test(question)) return "careerNewsletters";
  const prefix = `${invitation} (?:opt[ -]in to (?:receiving )?|receive )`;
  const purpose = "(?:about (?:my|your|this|the) application|(?:about|in relation to) the hiring process|about (?:my|your) application status)";
  if (new RegExp(`^${prefix}(?:text messages|sms(?: messages)?)(?: at the number you provided in your application,?)? ${purpose}$`).test(question)) return "smsUpdates";
  if (new RegExp(`^${prefix}(?:email (?:updates|messages)|emails) ${purpose}$`).test(question)) return "emailUpdates";
}

function normalizeCommuteLocation(value: string): string | undefined {
  if (value.length > 200 || /[\n\r;|/?!]/.test(value)) return;
  let location = value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ").replace(/\s*,\s*/g, ", ")
    .replace(/, canada$/, ", ca").replace(/, (?:united states(?: of america)?|u\.?s\.?a?\.?)$/, ", us");
  const parts = location.split(", ");
  if (parts.length < 2 || parts.length > 3 || parts.some(part => !part) || !/^(?:ca|us)$/.test(parts.at(-1)!)) return;
  if (!/\p{L}/u.test(parts[0]) || !/^[\p{L}\p{M}\d .'\u2019-]+$/u.test(parts[0])) return;
  if (parts.length === 3) {
    const subdivision = normalizeLocationSubdivision(parts[1], parts[2] === "ca" ? "CA" : "US");
    if (!subdivision) return;
    parts[1] = subdivision.toLowerCase();
    location = parts.join(", ");
  }
  if (/ (?:and|or) |\b(?:any|all|every|each|daily|weekly|days?|times?|hours?|minutes?|miles?|kilomet(?:er|re)s?|relocat\w*|office|offices|locations?|here|there|abroad|anywhere|remote)\b|\d\s*%/.test(location)) return;
  return location;
}

export function commuteLocationError(location: string, willingness?: CommuteAnswer["willingness"]): string | undefined {
  if (!location.trim() && !willingness) return;
  if (!normalizeCommuteLocation(location)) return "Enter one city, an optional state or province, and Canada or United States, separated by commas.";
}

const postingCommuteQuestion = (text: string) => /^are you (?:willing|open|prepared) to commute(?: to (?:our office|the office|this office|(?:this|the) (?:job|work|office) location|(?:this|the) (?:job|position)'s location|the location (?:of|for) this (?:role|position|job)))?\??$/.test(text)
  || /^will you be able to regularly commute and work in an office in (?:the )?job posting location\??$/.test(text);
function commuteLocation(text: string, employmentLocation?: string): string | undefined {
  if (postingCommuteQuestion(text)) return normalizeCommuteLocation(employmentLocation || "");
  const match = /^are you (?:willing|open|prepared) to commute to (?:the office in |our office in |an office in )?([^?!]+?)\??$/.exec(text);
  const location = match?.[1]?.replace(/\.$/, "").trim();
  // No inferred radius, schedule, transport, relocation or unspecified office.
  return location ? normalizeCommuteLocation(location) : undefined;
}

function employerQuestionKey(text: string, tenant?: string): typeof employerAnswerFields[number]["key"] | undefined {
  const isEmployer = (name: string | undefined) => Boolean(name && (
    /^(?:(?:this|our) (?:company|employer|organization)|us)$/.test(name) ||
    (tenant && name.replace(/[^a-z0-9]/g, "") === tenant)));
  const relationship = /^are you (?:related to or have any close personal ties with|related to) (?:any |an? )?(?:current )?(.+?) employees?\??$/.exec(text)
    || /^do you have (?:any )?(?:relatives|family members) (?:employed|working) (?:at|by|for) (.+?)\??$/.exec(text);
  if (isEmployer(relationship?.[1])) return "employeeRelationship";
  const referral = /^(?:were|are|have) you (?:been )?referred by an? employee (?:of|at) (.+?)\??$/.exec(text);
  if (isEmployer(referral?.[1])) return "referral";
  const former = /^have you (?:ever |previously )?(?:been )?(?:employed|worked) (?:by|with|at|for) (.+?)(?: before)?\??$/.exec(text);
  if (isEmployer(former?.[1])) return "previousEmployment";
}

export function applicationAnswerKey(label: string, employmentCountry?: "CA" | "US"): ApplicationQuestionKey | undefined {
  const text = cleanQuestion(label);
  // Compound declarations and attestations are not a synonym for a profile fact.
  if (reviewOnly(text)) return;
  if (/^(?:(?:please )?(?:select|choose|indicate) (?:the |all )?(?:countries|country(?: \(or countries\)|\(ies\))?) (?:where|in which) you (?:\b(?:currently )?have work authori[sz]ation|are (?:currently )?(?:legally )?authori[sz]ed to work)|which countries are you (?:currently )?(?:legally )?authori[sz]ed to work in)[.!?]?(?: \(select all that apply\))?$/.test(text)) return "authorizedCountries";
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
  const eligibility = eligibilityKey(text, employmentCountry);
  if (eligibility) return eligibility;
  if (/^are you (?:a )?(?:us|u\.s\.|united states) citizen, (?:lawful )?permanent resident, (?:green card holder, )?or (?:asylee\/refugee|asylee or refugee)\??$/.test(text)) return "usPerson";
  const communication = communicationKey(text);
  if (communication) return communication;
  if (/^how did you (?:initially )?(?:hear|learn|find out) about (?:(?:this|the|our) (?:position|role|job(?: opening)?|(?:career )?opportunity|opening)(?: with [a-z0-9 '&.-]+)?|us)\??$|^(?:where|how) did you (?:hear about|find) (?:this|the) (?:job|role|position|opening)\??$|^(?:job source|source of application)$/.test(text)) return "jobSource";
  if (/^(?:earliest (?:available )?start date|(?:date |when are you |when would you be )available to start(?: work)?|when (?:can|could) you start(?: work)?|availability date)\??$/.test(text)) return "startDate";
  if (/^(?:what (?:weekdays|days)(?: and times| and hours)? are you available(?: to work)?|(?:work |weekly )availability|available (?:days|hours)(?: and (?:days|hours))?)\??$/.test(text)) return "availability";
  if (/^(?:(?:what is |please (?:specify|provide|indicate) )?your (?:current )?notice period|(?:current )?notice period|how much notice (?:do you need to|must you) give (?:your (?:current )?employer|before starting(?: a new (?:role|job))?))[.!?]?$/.test(text)) return "noticePeriod";
  if (/^(?:please (?:indicate|provide) |what are )?(?:your )?(?:desired (?:starting )?(?:pay|salary(?: expectations)?|compensation)|salary expectations)(?:\s*\([^)]*\))?[.!?]?$/.test(text)) return "desiredPay";
  if (/^(?:please )?(?:explain|describe) why you are interested in part[ -]time employment[.!?]?$/.test(text)) return "partTimeReason";
  if (/^how long do you (?:anticipate|intend|plan on) working in a part[ -]time role\??$/.test(text)) return "partTimeDuration";
  if (/^are you (?:willing|open) to relocat(?:e|ion)\??$/.test(text)) return "relocation";
  if (/^are you (?:willing|open) to travel(?: for (?:work|business))?\??$/.test(text)) return "travel";
}

export type CommonAnswerDependency = { answerKey: string; answer: string; alternatives?: string[] };
export type CommonAnswer = { label: string; answer: string; answerKey: string; alternatives?: string[]; selections?: string[]; dependsOn?: CommonAnswerDependency };
export type CommonAnswerDetail = { label: string; profileLabel: string; reason: string; answerKey: string; notApplicable?: boolean; dependsOn?: CommonAnswerDependency };
const otherSourceOptions = ["Other (please specify)", "Other - please specify"];

function otherSourceFollowup(text: string): boolean {
  if (/^(?:if (?:you (?:selected|chose) )?["']?other[,"']* +)?please (?:specify(?: here)?|provide (?:more )?details|tell us more)[.!?]?$/.test(text)) return true;
  const conditional = /^if you (?:chose|selected) (.+?),? please specify(?: here)?[.!?]?$/.exec(text);
  if (!conditional) return false;
  // A combined follow-up can mention employee/event options. Only the actual
  // Other selection authorizes using a source description, never a referrer.
  const options = conditional[1].split(/,\s*(?:or\s+)?|\s+or\s+/).map(option => option.trim().replace(/^["']|["']$/g, ""));
  return options.includes("other") && options.every(option => /^[a-z0-9 '&/().-]+$/.test(option));
}

function answerAlternatives(key: string, answer: string | undefined): string[] | undefined {
  if (key === "jobSource") return answer === "ApplyOverflow" ? ["Other", ...otherSourceOptions] : answer === "Other" ? otherSourceOptions : undefined;
  if (answer === "Prefer not to answer" || answer === "I don't wish to answer" || answer === "I do not want to answer") return ["Decline to self-identify", "Decline to self identify", "I decline to self-identify", "I prefer not to say", "I prefer not to answer", "Prefer not to say", "Prefer not to answer", "I don't wish to answer", "I do not wish to answer", "I do not want to answer"];
  if (key === "gender") return ({ Man: ["Male"], Woman: ["Female"] } as Record<string, string[]>)[answer || ""];
  if ((answer === "Yes" || answer === "No") && /^(?:authorized|sponsorship)(?:CA|US)$/.test(key)) {
    const country = key.endsWith("CA") ? "Canada" : "the United States";
    return key.startsWith("authorized")
      ? [`${answer}, I am ${answer === "No" ? "not " : ""}legally authorized to work in ${country}`, `${answer}, I am ${answer === "No" ? "not " : ""}authorized to work in ${country}`, `${answer}, I am${answer === "No" ? " not" : ""}`]
      : [`${answer}, I ${answer === "No" ? "do not " : ""}require sponsorship now or in the future`, `${answer}, I ${answer === "No" ? "do not " : ""}require visa sponsorship now or in the future`, `${answer}, I do${answer === "No" ? " not" : ""}`];
  }
  if ((answer === "Yes" || answer === "No") && ["smsUpdates", "emailUpdates", "talentCommunity", "jobAlerts", "careerNewsletters", "talentCommunityNewsletters"].includes(key)) {
    const alternatives = answer === "Yes" ? ["Yes, please", "Yes, I would like to opt in"] : ["No, thank you", "No, I do not wish to opt in"];
    if (key === "smsUpdates") alternatives.unshift(`${answer} - I ${answer === "No" ? "do not " : ""}consent to receiving text messages`);
    return alternatives;
  }
  if ((answer === "Yes" || answer === "No") && ["travel", "commute", "relocation"].includes(key))
    return [`${answer}, I am${answer === "No" ? " not" : ""} willing to ${key === "relocation" ? "relocate" : key}`];
}
export function applicationAnswerPlan(raw: unknown, labels: string[], url?: string, employmentCountry?: "CA" | "US", employmentLocation?: string) {
  const saved = normalizeApplicationAnswers(raw);
  const context = url && applicationContext(url, true);
  const employers = saved.employers?.filter(e => e.url && applicationContext(e.url, true)?.companyKey === (context && context.companyKey));
  const employer = employers?.length === 1 ? employers[0] : undefined;
  const tenant = context ? context.tenant.replace(/[^a-z0-9]/gi, "").toLowerCase() : undefined;
  const jobLocation = normalizeCommuteLocation(employmentLocation || "");
  const conflictingCountry = Boolean(jobLocation && employmentCountry && !jobLocation.endsWith(`, ${employmentCountry.toLowerCase()}`));
  const countryContext = conflictingCountry ? undefined : employmentCountry;
  const commonKey = (label: string) => {
    const key = applicationAnswerKey(label, countryContext);
    if (key) return key;
    const sourceCompany = /^how did you (?:initially )?(?:hear|learn|find out) about ([^?]+)\??$/.exec(cleanQuestion(label))?.[1];
    if (tenant && sourceCompany?.replace(/[^a-z0-9]/g, "") === tenant) return "jobSource";
  };
  const answers: CommonAnswer[] = [], details: CommonAnswerDetail[] = [];
  labels.forEach((label, index) => {
    const text = cleanQuestion(label), previous = cleanQuestion(labels[index - 1] || "");
    if (reviewOnly(text)) return;
    let key: string | undefined = commonKey(label);
    if (!key && !countryContext) {
      const ca = eligibilityKey(text, "CA"), us = eligibilityKey(text, "US");
      const kind = ca === "authorizedCA" && us === "authorizedUS" ? "authorization" : ca === "sponsorshipCA" && us === "sponsorshipUS" ? "sponsorship" : undefined;
      if (kind) {
        details.push({ label, answerKey: `${kind}Country`, profileLabel: kind === "authorization" ? "Work authorization for the job's country" : "Sponsorship for the job's country",
          reason: "The job's country could not be confirmed. Answer this question on the employer form; saved Canada or United States answers cannot be used without a confirmed country." });
        return;
      }
    }
    let notApplicable = false;
    let unavailableReason: string | undefined;
    let dependsOn: CommonAnswerDependency | undefined;
    let selections: string[] | undefined;
    let answer = key ? saved.values[key as ApplicationAnswerKey] : undefined;
    let profileLabel: string | undefined = [...applicationAnswerFields, ...applicationTextFields].find(f => f.key === key)?.label;
    if (key === "authorizedCountries") {
      profileLabel = "Countries with saved work authorization";
      selections = ([ ["authorizedCA", "Canada"], ["authorizedUS", "United States"] ] as const)
        .filter(([countryKey]) => saved.values[countryKey] === "Yes").map(([, country]) => country);
      answer = selections[0];
      if (!answer) unavailableReason = "No country has an explicit saved Yes for work authorization. Add your authorized countries in Profile, or answer on the employer form. No countries or None will be inferred.";
    }
    if (key === "talentCommunityNewsletters") {
      profileLabel = "Talent community and career newsletters";
      answer = saved.values.talentCommunity && saved.values.talentCommunity === saved.values.careerNewsletters ? saved.values.talentCommunity : undefined;
      if (!answer) unavailableReason = "Talent community and career newsletters need matching explicit choices. Review this combined choice on the form.";
    }
    if (/^desired salary \((?:amount|currency)\)$/.test(text)) {
      answer = undefined;
      const pay = /^(USD|CAD)\s*\$?\s*((?:[1-9]\d{0,2}(?:,\d{3})+|[1-9]\d*)(?:\.\d{1,2})?)\s*(?:\/\s*year|per year|annually|per annum)$/i.exec(saved.values.desiredPay || "");
      key = text.endsWith("(amount)") ? "desiredPayAmount" : "desiredPayCurrency";
      profileLabel = "Desired pay with annual amount and currency";
      if (pay && Number(pay[2].replaceAll(",", "")) <= 1_000_000_000)
        answer = key === "desiredPayAmount" ? pay[2].replaceAll(",", "") : `${pay[1].toUpperCase()} $`;
    }
    const location = commuteLocation(text, conflictingCountry ? undefined : jobLocation);
    if (location || postingCommuteQuestion(text)) {
      key = "commute"; profileLabel = location ? `Commute willingness for ${location}` : "Commute willingness for this posting's location";
      const matches = location ? saved.commutes?.filter(row => normalizeCommuteLocation(row.location) === location) : [];
      answer = matches?.length === 1 ? matches[0].willingness : undefined;
      if (!location) unavailableReason = "A single city and country for this posting could not be confirmed. Answer commute willingness on the form.";
    }
    if (otherSourceFollowup(text) && commonKey(labels[index - 1] || "") === "jobSource") {
      key = "sourceDetails"; profileLabel = "Other job source";
      answer = saved.values.jobSource === "ApplyOverflow" ? "ApplyOverflow" : saved.values.jobSource === "Other" ? saved.values.sourceDetails : undefined;
      dependsOn = { answerKey: "jobSource", answer: "Other", alternatives: otherSourceOptions };
    }
    const employerKey = employerQuestionKey(text, tenant);
    if (employerKey) {
      key = employerKey;
      profileLabel = employerAnswerFields.find(f => f.key === key)?.label;
      answer = employer?.[key as keyof EmployerAnswers];
    }
    if (/^if (?:applicable|yes),? please provide (?:their )?names?(?:\(s\))? and your relationship to them[.!?]?$/.test(text) && employerQuestionKey(previous, tenant) === "employeeRelationship") {
      key = "relationshipDetails"; profileLabel = "Relationship details for this employer";
      answer = employer?.employeeRelationship === "Yes" ? employer.relationshipDetails : undefined;
      notApplicable = employer?.employeeRelationship === "No";
      dependsOn = { answerKey: "employeeRelationship", answer: "Yes" };
    }
    if (/^(?:if you were referred, who should we thank(?: for the introduction)?|(?:referrer's|referring employee'?s?) name)\??$/.test(text)) {
      key = "referralName"; profileLabel = "Referrer at this employer";
      answer = employer?.referral === "Yes" ? employer.referralName : undefined;
      notApplicable = employer?.referral === "No";
      dependsOn = { answerKey: "referral", answer: "Yes" };
    }
    if (/^(?:if yes, for current visa holders, please specify the type of visa\/sponsorship you have and the time remaining|(?:if yes, )?(?:please (?:specify|provide) )?(?:your )?(?:u\.?s\.? )?visa type and (?:remaining validity|time remaining|expiration date|expiry date))[.!?]?$/.test(text) && applicationAnswerKey(labels[index - 1] || "", countryContext) === "sponsorshipUS") {
      key = "visaDetailsUS"; profileLabel = "U.S. visa type and remaining validity";
      answer = saved.values.sponsorshipUS === "Yes" ? saved.values.visaDetailsUS : undefined;
      notApplicable = saved.values.sponsorshipUS === "No";
      dependsOn = { answerKey: "sponsorshipUS", answer: "Yes", alternatives: answerAlternatives("sponsorshipUS", "Yes") };
    }
    if (!key || !profileLabel) return;
    const alternatives = answerAlternatives(key, answer);
    if (key === "desiredPayAmount" && answer) dependsOn = { answerKey: "desiredPayCurrency", answer: `${saved.values.desiredPay!.slice(0, 3).toUpperCase()} $` };
    if (saved.enabled && answer) answers.push({ label, answer, answerKey: key, ...(alternatives ? { alternatives } : {}),
      ...(selections ? { selections } : {}),
      ...(dependsOn ? { dependsOn } : {}) });
    else if (saved.enabled && notApplicable) details.push({ label, profileLabel, answerKey: key, notApplicable: true,
      dependsOn: { answerKey: key === "relationshipDetails" ? "employeeRelationship" : key === "referralName" ? "referral" : "sponsorshipUS", answer: "No" },
      reason: "Not applicable based on your saved answer. Left blank." });
    else details.push({ label, profileLabel, answerKey: key, reason: !saved.enabled
      ? "Enable sharing in Profile > Optional application answers to use your saved choices."
      : unavailableReason || `Add ${profileLabel.toLowerCase()} in Profile, or answer on the form.` });
  });
  return { answers, details };
}

export function commonApplicationAnswers(raw: unknown, labels: string[]) {
  return applicationAnswerPlan(raw, labels).answers.map(({ label, answer }) => ({ label, answer }));
}
