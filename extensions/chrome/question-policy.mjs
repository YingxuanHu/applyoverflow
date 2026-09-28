// Shared by the server and browser. Eligibility and personal decisions must not
// be inferred from professional experience, even when a question mixes topics.
export function questionAssistance(label) {
  const text = String(label).toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, " ").trim();
  // Exclude specific technical senses, not whole professional clauses: a second
  // request for the applicant's race, address or email must still block drafting.
  const personalText = text
    .replace(/\brace[ -]conditions?\b/g, "concurrency faults")
    .replace(/\b(how (?:did|do|would|could|can|will) you|how you) address\b/g, "$1 resolve")
    .replace(/\bemail (?:delivery|notification|processing) (?:pipelines?|systems?|services?)\b/g, "messaging infrastructure");
  // Check the entire label BEFORE professional allowlists, including mixed
  // questions. Word boundaries keep "visualization" from matching "visa".
  const personal = [
    /disab|veteran|gender|\brace\b|ethnic|sexual|\bsex\b|religio|birth|\bage\b|\b18\b|social security|\bssn\b|indigenous|aboriginal|minority|identify as|marital|pregnan|accommodation/,
    /criminal|convict|consent|\bagree\w*|certify|signature|attest|acknowledge|background check|drug test|accept.{0,40}(?:terms|privacy|polic)|confirm.{0,40}(?:accurac|accurate|correct|truth)/,
    /authoriz|sponsor|\bvisas?\b|citizen|eligible|eligibility|right to work|work permit|legally (?:able|allowed)|immigration|passport|nationality/,
    /referr|related to|relatives?\b|family|government|political|employed (?:by|with|at)|conflict of interest|non[ -]?compete|\b(?:spouse|partner|parents?|siblings?|friends?|relationships?)\b|know.{0,35}(?:anyone|employee|staff)|(?:worked|working|work) (?:here|for us|for this company)/,
    /residen|\bcountr(?:y|ies)\b|\b(?:address|zip|postal|phone|email|pronouns?)\b|relocat|commut|located in|based in|live in|(?:your|current|home) (?:city|state|province|location)|where (?:do you|are you|would you)/,
    /salary|compensation|\bpay\b|availability|\bavailable\b|schedule|saturday|sunday|weekdays|weekends|evenings|night shifts|hours per week|work hours|time off|start date|notice period|time ?zone|travel|driver'?s? licen[cs]e/,
    /when (?:can|could|would|will) you (?:start|join)|(?:can|could|would|will) you work\b|you (?:can|could|would|will) work\b|able to work\b|commit.{0,40}(?:hours|work|shift)|how long.{0,50}(?:stay|remain|anticipate|intend|plan)/,
    /\b(?:prefer(?:red|ence|ences)?|favou?rite|willing)\b|\bopen to\b|would you rather|work arrangement|ideal work environment|(?:remote|hybrid|on[ -]?site).{0,40}(?:work|role|position)/,
  ];
  if (personal.some(pattern => pattern.test(personalText))) return "personal";
  // A technical hypothetical can describe a proposal, not a new applicant fact.
  // Confidence prompts may describe demonstrated work, never infer a ranking.
  if (/(?:how (?:comfortable|confident)|most confident|what would you build)/.test(text)) return "context";
  if (/why|explain|describe/i.test(text) && /part[ -]?time|flexib|career (?:break|change)|leaving|leave your/i.test(text)) return "context";
  if (/anything (?:else )?about your (?:experience|background)|additional (?:information|experience).{0,70}(?:fit|candidacy)|(?:experience|background).{0,90}help us evaluate your fit/.test(text)) return "draft";
  const prompt = text.replace(/^(?:(?:\((?:optional|required)\)|\d+[.)]|please|briefly)\s*)+/, "");
  // These facts can be text or an exact offered choice. Missing profile evidence
  // is handled by the server as unknown, never as "No" or an inferred credential.
  if (/\b(?:education(?:al)?|degree|diploma|academic)\b/.test(text) &&
      /\b(?:highest|level|attain|attained|completed|earned|hold|have|qualification)\b/.test(text)) return "qualification";
  if (/\b(?:certifications?|credentials?|certified|professional licen[cs]es?)\b/.test(text)) return "qualification";
  if (/^(?:do you have|have you|how many years|how long have you|what is your experience|are you (?:experienced|proficient|familiar))\b/.test(prompt) && /experience|worked with|built|managed|managing|programming|proficien|familiar with/.test(text)) return "qualification";
  if ((/\b(?:which|what|select|choose|list|indicate)\b/.test(prompt) || /^(?:technical skills|programming languages|technologies|tools|frameworks)\b/.test(prompt)) &&
      /\b(?:skills?|technolog(?:y|ies)|tools?|programming languages?|frameworks?|tech stacks?|platforms?|software)\b/.test(text) &&
      /\b(?:have|use[ds]?|using|worked|experience|know|knowledge|proficien\w*|familiar|skills?)\b/.test(text)) return "qualification";
  if (/^why (?:this|the) (?:role|job|company)[?*\s]*$|^relevant (?:experience|project)[?*\s]*$/i.test(text)) return "draft";
  if (/^(?:(?:professional|relevant|technical) )?(?:projects?|accomplishments?|achievements?)\b/.test(prompt) ||
      /\bwhat (?:have|did) you (?:build|built|deliver|achieve|accomplish)\b|\b(?:thing|product|application|feature|system|solution)\b.{0,50}\byou (?:have )?(?:built|delivered|implemented)\b/.test(text)) return "draft";
  if (/\b(?:what|which|share|describe|tell|outline|summari[sz]e|give|provide|walk)\b/.test(prompt) &&
      /\b(?:projects?|accomplishments?|achievements?|contributions?)\b/.test(text)) return "draft";
  if (/\b(?:tell|describe|explain|share|outline|give|walk)\b/.test(prompt) &&
      /\b(?:architectural|technical|system[ -]design) decisions?\b/.test(text)) return "draft";
  if (/\bhow\b.{0,70}\b(?:built|build|solved|solve|address|addressed|improved|improve|implemented|implement|delivered|deliver|measured|measure|validated|validate)\b/.test(text) &&
      /\b(?:project|work|team|system|application|product|process|results?|impact|outputs?)\b/.test(text)) return "draft";
  if (/(?:why|what).{0,65}(?:interest|join|work (?:at|for|with)|attract|motivat)|(?:tell|describe|explain|share|summari[sz]e|outline).{0,80}(?:experience|project|background|skill|challenge|accomplish|achievement|built|yourself)|what makes you.{0,35}(?:fit|candidate)|how.{0,40}(?:experience|background|skills).{0,40}(?:relate|prepare|align|apply)/i.test(text)) return "draft";
  return "personal";
}
