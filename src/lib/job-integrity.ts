const NON_JOB_TITLE_PATTERNS = [
  /^how to\b/i,
  /^what is\b/i,
  /^what's\b/i,
  /^a guide to\b/i,
  /^the .* guide to\b/i,
  /^thank you for\b/i,
  /^merci d['’]avoir\b/i,
  /^gracias por\b/i,
  /^vielen dank\b/i,
  /^what are careers? at .+\?$/i,
  /^what does .+ do\?$/i,
  /^what careers are available\??$/i,
  /^how do i get hired\??$/i,
  /^how do i apply(?: for a position)?\??$/i,
  /^what qualifications do i need\??$/i,
  /^entry[- ]level careers?(?: in tech)?$/i,
  /^is .+ a good place to work\??$/i,
  /^salary and benefits$/i,
  /^social responsibility$/i,
  /^get involved$/i,
  /^announcing\b/i,
  /^careers? blog$/i,
  /^careers?(?: at .+)?$/i,
  /^jobs?(?: at .+)?$/i,
  /^faqs?$/i,
  /^benefits$/i,
  /^benefits and perks$/i,
  /^learn more$/i,
  /^open positions?$/i,
  /^roles we fill$/i,
  /^our services$/i,
  /^our process$/i,
  /^we make work an adventure!?$/i,
  /^work (?:at|with|for) .+$/i,
  /^join (?:us|our team|the team)\b/i,
  /^come work with us\b/i,
  /^join our team and thrive!?$/i,
  /^search careers? at .+$/i,
  /^grow your career(?: with us)?[!.]?$/i,
  /^build your career(?: at .+)?[!.]?$/i,
  /^brilliant thrives here(?: search careers? at .+)?$/i,
  /^current opportunities$/i,
  /^(?:engineering|software engineering|data engineering|platform engineering|product management|business operations|sales|marketing|finance|accounting|legal|operations|design|security|information technology|customer success|customer support|quality assurance|human resources|hr|people)$/i,
  /\bnot an active opening\b/i,
  /\bbuilding (?:a )?talent pipeline\b/i,
  /\[(?:pipeline|talent pool)\]/i,
  /\btalent pool\b/i,
  /\btalent community\b/i,
  /\bgeneral application\b/i,
  /\bopen application\b/i,
  /\bexpression of interest\b/i,
  /\bsubmit your (?:resume|cv)\b/i,
  /\bfuture opportunities\b/i,
  /\bevergreen\b/i,
  /^recruitment scams$/i,
  /^modal-role$/i,
  /^rxnews\b/i,
] satisfies RegExp[];

const LOCATION_ONLY_TITLE_RE =
  /^(?:remote|hybrid|onsite|on-site|canada|united states|usa|toronto|montreal|montréal|vancouver|calgary|ottawa|edmonton|winnipeg|mississauga|waterloo|kitchener|laval|quebec|québec|new york|san francisco|seattle|boston|chicago|austin|dallas|los angeles|washington|london|paris|berlin|singapore)(?:\s+(?:office|area|region|centre|center|city))?$/i;

const GENERIC_CAREER_LANDING_TITLE_PATTERNS = [
  /^careers?(?: at .+)?$/i,
  /^jobs?(?: at .+)?$/i,
  /^open positions?$/i,
  /^current opportunities$/i,
  /^work (?:at|with|for) .+$/i,
  /^join (?:us|our team|the team)\b/i,
  /^join .+\b/i,
  /^come work with us\b/i,
  /^build your career\b/i,
  /^grow your career\b/i,
  /^help us\b/i,
] satisfies RegExp[];

const NON_JOB_CONTENT_PATTERNS = [
  /\broles we fill\b/i,
  /\bour services\b/i,
  /\bour process\b/i,
  /\bfor freelancers\b/i,
  /\bapply as a freelancer\b/i,
  /\bhire now\b/i,
  /\bcareers blog\b/i,
  /\bin-page topics\b/i,
  /\bwhat does [^.?!\n]{1,80} do\??\b/i,
  /\bwhat careers are available\??\b/i,
  /\bhow do i get hired\??\b/i,
  /\bhow do i apply(?: for a position)?\??\b/i,
  /\bwhat qualifications do i need\??\b/i,
  /\bentry[- ]level careers?(?: in tech)?\b/i,
  /\bis [^.?!\n]{1,80} a good place to work\??\b/i,
  /\bsalary and benefits\b/i,
  /\bsocial responsibility\b/i,
  /\bsearch our (?:tech )?careers\b/i,
  /\bwork from anywhere\b/i,
  /\bget paid reliably\b/i,
  /\bjoin our network\b/i,
  /\bsearch careers? at\b/i,
  /\bgrow your career\b/i,
  /\bbuild your career\b/i,
  /\bthrive[s]? here\b/i,
  /\btrusted by\b/i,
  /\bfeatured in\b/i,
  /\banswers to frequently asked questions\b/i,
  /\bthis blog will help you\b/i,
  /\bwatch this video\b/i,
  /\bopen positions\b/i,
  /\bour current job openings\b/i,
  /\bnot an active opening\b/i,
  /\bbuilding (?:a )?talent pipeline\b/i,
  /\[(?:pipeline|talent pool)\]/i,
  /\btalent pool\b/i,
  /\btalent community\b/i,
  /\bgeneral application\b/i,
  /\bopen application\b/i,
  /\bexpression of interest\b/i,
  /\bsubmit your (?:resume|cv)\b/i,
  /\bfuture opportunities\b/i,
  /\bevergreen (?:role|opportunity|opening)\b/i,
  /\bwhat do we offer\??\b/i,
  /\bwho we are\b/i,
  /\bshortcuts\b/i,
  /\blearn more\b/i,
  /\bsee all skills\b/i,
] satisfies RegExp[];

const JOB_POSTING_PATTERNS = [
  /\bjob description\b/i,
  /\bposition summary\b/i,
  /\babout the role\b/i,
  /\babout the job\b/i,
  /\bwhat you(?:'|’)ll do\b/i,
  /\bresponsibilit(?:y|ies)\b/i,
  /\brequirements?\b/i,
  /\bqualifications?\b/i,
  /\bminimum qualifications?\b/i,
  /\bpreferred qualifications?\b/i,
  /\bexperience\b/i,
  /\beducation\b/i,
  /\bcompensation\b/i,
  /\bthe role\b/i,
  /\bwe(?:'|’)re looking for\b/i,
  /\bjob type\b/i,
  /\bfull[- ]time\b/i,
  /\bpart[- ]time\b/i,
  /\bcontract\b/i,
  /\bintern(ship)?\b/i,
  /\brequisition\b/i,
  /\bapplicants?\b/i,
] satisfies RegExp[];

const JOB_URL_HINT_RE =
  /(job|jobs|position|positions|posting|requisition|opening|opportunit|vacanc|role)/i;

export type NonJobClassification = {
  detected: boolean;
  reason: string | null;
  negativeHits: number;
  positiveHits: number;
};

export function classifyNonJobPosting(input: {
  title?: string | null;
  description?: string | null;
  applyUrl?: string | null;
}): NonJobClassification {
  const title = normalizeText(input.title);
  const description = normalizeText(input.description);
  const applyUrl = normalizeText(input.applyUrl);
  const combined = [title, description, applyUrl].filter(Boolean).join("\n");

  if (!combined) {
    return {
      detected: false,
      reason: null,
      negativeHits: 0,
      positiveHits: 0,
    };
  }

  const negativeHits = countMatches(combined, NON_JOB_CONTENT_PATTERNS);
  const positiveHits = countMatches(combined, JOB_POSTING_PATTERNS);
  const genericCareerUrl = looksLikeGenericCareerUrl(applyUrl);
  const articleOrDocsUrl = looksLikeArticleOrDocsUrl(applyUrl);
  const questionLikeCareerTitle =
    Boolean(title) &&
    title.endsWith("?") &&
    /(career|careers|qualifications|salary|benefits|what does|what are|how do i)/i.test(title);

  if (title && NON_JOB_TITLE_PATTERNS.some((pattern) => pattern.test(title))) {
    return {
      detected: true,
      reason: "non_job_title",
      negativeHits,
      positiveHits,
    };
  }

  if (title && LOCATION_ONLY_TITLE_RE.test(title.replace(/[()]/g, "").trim())) {
    return {
      detected: true,
      reason: "location_only_title",
      negativeHits,
      positiveHits,
    };
  }

  if (articleOrDocsUrl) {
    return {
      detected: true,
      reason: "article_or_docs_url",
      negativeHits,
      positiveHits,
    };
  }

  if (
    genericCareerUrl &&
    (!title ||
      positiveHits <= 1 ||
      GENERIC_CAREER_LANDING_TITLE_PATTERNS.some((pattern) => pattern.test(title)))
  ) {
    return {
      detected: true,
      reason: "generic_careers_url",
      negativeHits,
      positiveHits,
    };
  }

  if ((genericCareerUrl || questionLikeCareerTitle) && negativeHits >= 2 && positiveHits === 0) {
    return {
      detected: true,
      reason: genericCareerUrl ? "generic_careers_url" : "career_question_title",
      negativeHits,
      positiveHits,
    };
  }

  if (negativeHits >= 4 && positiveHits <= 1) {
    return {
      detected: true,
      reason: "career_landing_marketing_copy",
      negativeHits,
      positiveHits,
    };
  }

  if (negativeHits >= 6) {
    return {
      detected: true,
      reason: "career_landing_dense_markers",
      negativeHits,
      positiveHits,
    };
  }

  return {
    detected: false,
    reason: null,
    negativeHits,
    positiveHits,
  };
}

export function isClearlyNonJobPosting(input: {
  title?: string | null;
  description?: string | null;
  applyUrl?: string | null;
}) {
  return classifyNonJobPosting(input).detected;
}

function normalizeText(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function countMatches(input: string, patterns: readonly RegExp[]) {
  return patterns.reduce(
    (count, pattern) => (pattern.test(input) ? count + 1 : count),
    0
  );
}

function looksLikeGenericCareerUrl(url: string) {
  if (!url) return false;

  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.toLowerCase().replace(/\/+$/, "") || "/";

    if (
      /(?:^|\/)(careers?|jobs?|open-positions?|job-openings?)$/.test(pathname) ||
      /\/career-search$/.test(pathname) ||
      /\/careers-at-[a-z0-9-]+$/.test(pathname)
    ) {
      return true;
    }

    if (JOB_URL_HINT_RE.test(pathname)) {
      return false;
    }

    return false;
  } catch {
    return false;
  }
}

function looksLikeArticleOrDocsUrl(url: string) {
  if (!url) return false;

  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return [
      "/blog/",
      "/guide/",
      "/guides/",
      "/docs/",
      "/support/",
      "/resources/",
      "/resource/",
      "/case-studies/",
      "/insights/",
      "/news/",
      "/videos/",
      "/faq/",
      "/faqs/",
      "/thank-you",
      "/download",
      "/webinar/",
      "/lesson-center/",
      "/people-ops/",
    ].some((segment) => pathname.includes(segment));
  } catch {
    return false;
  }
}
