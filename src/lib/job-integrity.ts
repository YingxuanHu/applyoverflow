const NON_JOB_CONTENT_URL_SEGMENTS = [
  "/ai-guidelines",
  "/blog/",
  "/guide/",
  "/guides/",
  "/docs/",
  "/events/",
  "/support/",
  "/resources/",
  "/resource/",
  "/case-studies/",
  "/collections/",
  "/dataset/",
  "/datasets/",
  "/insights/",
  "/media/video/",
  "/media/videos/",
  "/model/",
  "/models/",
  "/news/",
  "/newsroom/",
  "/partner/",
  "/partners/",
  "/papers/",
  "/press/",
  "/press-release/",
  "/protect-yourself",
  "/product/",
  "/products/",
  "/posts/",
  "/spaces/",
  "/videos/",
  "/faq/",
  "/faqs/",
  "/thank-you",
  "/download",
  "/webinar/",
  "/webinars/",
  "/whitepaper/",
  "/whitepapers/",
  "/lesson-center/",
  "/people-ops/",
] as const;

const HARD_NON_JOB_CONTENT_URL_SEGMENTS = [
  "/ai-guidelines",
  "/blog/",
  "/guide/",
  "/guides/",
  "/docs/",
  "/events/",
  "/support/",
  "/resources/",
  "/resource/",
  "/case-studies/",
  "/collections/",
  "/insights/",
  "/media/video/",
  "/media/videos/",
  "/news/",
  "/newsroom/",
  "/papers/",
  "/press/",
  "/press-release/",
  "/protect-yourself",
  "/posts/",
  "/videos/",
  "/faq/",
  "/faqs/",
  "/thank-you",
  "/download",
  "/webinar/",
  "/webinars/",
  "/whitepaper/",
  "/whitepapers/",
  "/lesson-center/",
  "/people-ops/",
] as const;

const JOB_SECTION_URL_RE =
  /\/(?:remote-jobs|jobs?|careers?|job-openings?|openings?|open-positions?|positions?|job-offers?)(?:\/|$)/i;

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
  /^.+\s+careers$/i,
  /^jobs?(?: at .+)?$/i,
  /^.+\s+jobs$/i,
  /^job listings?$/i,
  /^job title$/i,
  /^faqs?$/i,
  /^masscareers$/i,
  /^.+\.pdf$/i,
  /^datasets?\s*:/i,
  /^models?\s*:/i,
  /^spaces?\s*:/i,
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
  /^join (?:the )?.+\s+team$/i,
  /^come work with us\b/i,
  /^join our team and thrive!?$/i,
  /^search careers? at .+$/i,
  /^grow your career(?: with us)?[!.]?$/i,
  /^build your career(?: at .+)?[!.]?$/i,
  /^brilliant thrives here(?: search careers? at .+)?$/i,
  /^current opportunities$/i,
  /^current openings(?: at .+)?$/i,
  /^search jobs?$/i,
  /^team$/i,
  /^internships?$/i,
  /^employee resource groups$/i,
  /^change the future of\b/i,
  /^say yes to$/i,
  /^supporting our communities$/i,
  /^where heroes can call home$/i,
  /^what happens to\b/i,
  /^become a future leader\b/i,
  /\bcareer guide$/i,
  /^top (?:\d+|seven|ten)\b.*\bpositions\b/i,
  /^privacy notice(?: for job applicants)?$/i,
  /^notice on fraudulent job offers$/i,
  /^protect yourself from job scams$/i,
  /\bjob scams?\b/i,
  /\bannounce(?:s|d)?\b.*\bopening\b/i,
  /\bcopy of careers\b/i,
  /^helpful tips for writing\b/i,
  /^kb\d+\b/i,
  /^redirect$/i,
  /^apply$/i,
  /^bewerbung$/i,
  /^initiativbewerbung$/i,
  /^stellen$/i,
  /^search results?[:：]/i,
  /^搜索结果[:：]?/i,
  /^unsuccessful activation/i,
  /^we apologize for the inconvenience/i,
  /^about\s+[a-z0-9 .,&'-]+$/i,
  /^open your own\b.*\bfranchise\b/i,
  /^(?:req|requisition|job)\s*#?\s*\d+$/i,
  /^s\d+\s+e\d+\b/i,
  /^504 gateway time-?out$/i,
  /^gateway time-?out$/i,
  /^access denied$/i,
  /^your input required$/i,
  /^building (?:your career|the future)\b/i,
  /^let'?s go beyond your potential/i,
  /^on-the-job training .*guide$/i,
  /^construction .* software made for/i,
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
  /^(?:remote|hybrid|onsite|on-site|canada|united states|usa|toronto|montreal|montréal|vancouver|calgary|ottawa|edmonton|winnipeg|mississauga|waterloo|kitchener|laval|quebec|québec|new york|san francisco|seattle|boston|chicago|austin|dallas|los angeles|washington|london|paris|berlin|singapore|apac|emea|latam|europe|asia|africa|middle east|united kingdom|uk|india|australia)(?:\s+(?:office|area|region|centre|center|city))?$/i;

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

const DEPARTMENT_BUCKET_TITLE_RE =
  /^(?:engineering|software engineering|data engineering|platform engineering|product management|business operations|sales|marketing|finance|accounting|legal|operations|design|security|information technology|customer success|customer support|quality assurance|human resources|hr|people)$/i;

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
  /\bexplore open roles\b/i,
  /\bgrow your career\b/i,
  /\bbuild your career\b/i,
  /\bthrive[s]? here\b/i,
  /\bwidget title goes here\b/i,
  /\bmeta text goes here\b/i,
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

  const departmentBucketTitle = Boolean(title) && DEPARTMENT_BUCKET_TITLE_RE.test(title);

  if (title && LOCATION_ONLY_TITLE_RE.test(title.replace(/[()]/g, "").trim())) {
    return {
      detected: true,
      reason: "location_only_title",
      negativeHits,
      positiveHits,
    };
  }

  if (
    departmentBucketTitle &&
    (genericCareerUrl || negativeHits >= 2) &&
    positiveHits <= 1
  ) {
    return {
      detected: true,
      reason: genericCareerUrl ? "generic_department_url" : "generic_department_copy",
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
    const hasPostingQueryId =
      parsed.searchParams.has("gh_jid") ||
      parsed.searchParams.has("job_id") ||
      parsed.searchParams.has("jobId") ||
      parsed.searchParams.has("job") ||
      parsed.searchParams.has("requisitionId") ||
      parsed.searchParams.has("reqId");

    if (hasPostingQueryId) {
      return false;
    }

    // Many real ATS apply URLs end in a literal `/job` segment while carrying
    // the actual requisition id in the path or query string:
    //   /open-positions/job?gh_jid=123
    //   /jobs/123/title/job?mode=apply
    // Treat those as item pages, not generic job-board landing pages.
    if (
      /\/job$/.test(pathname) &&
      (parsed.searchParams.has("mode") ||
        parsed.searchParams.has("apply") ||
        /\/jobs?\/\d+\//.test(pathname))
    ) {
      return false;
    }

    if (looksLikeGenericAtsBoardUrl(parsed)) {
      return true;
    }

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

function looksLikeGenericAtsBoardUrl(parsed: URL) {
  const host = parsed.hostname.toLowerCase();
  const parts = parsed.pathname
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);

  if (host === "jobs.lever.co") {
    return parts.length <= 1;
  }

  if (host === "jobs.ashbyhq.com") {
    return parts.length <= 1;
  }

  if (host === "apply.workable.com") {
    return parts.length <= 1;
  }

  if (host === "jobs.smartrecruiters.com") {
    return parts.length <= 1;
  }

  if (host === "boards.greenhouse.io" || host === "job-boards.greenhouse.io") {
    return parts.length <= 1 || /^(?:jobs?|departments?|offices?)$/i.test(parts[1] ?? "");
  }

  if (host.endsWith(".greenhouse.io")) {
    return parts.length <= 1 || /^(?:jobs?|departments?|offices?)$/i.test(parts[1] ?? "");
  }

  return false;
}

function looksLikeArticleOrDocsUrl(url: string) {
  return isClearlyNonJobContentUrl(url);
}

export function isClearlyNonJobContentUrl(url: string | null | undefined) {
  if (!url) return false;
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    if (!NON_JOB_CONTENT_URL_SEGMENTS.some((segment) => pathname.includes(segment))) {
      return false;
    }
    if (JOB_SECTION_URL_RE.test(pathname)) {
      return HARD_NON_JOB_CONTENT_URL_SEGMENTS.some((segment) => pathname.includes(segment));
    }
    return true;
  } catch {
    return false;
  }
}
