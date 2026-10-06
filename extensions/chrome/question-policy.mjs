// Shared by the server and browser. Eligibility and personal decisions must not
// be inferred from professional experience, even when a question mixes topics.
export function questionAssistance(label) {
  const text = String(label).normalize("NFKC").toLowerCase().replace(/^\s*(?:\(optional\)|\(required\)|please)\s*/g, "").trim();
  const technicalAuthorization = /\b(?:api|oauth|rbac|access control|authentication)\b/.test(text) && !/\b(?:work|employment|visa|eligible|citizen)\b/.test(text);
  const decisions = text.replace(/\bhigh availability\b/g, "system resilience").replace(/\b(?:job|task) scheduler\b/g, "task orchestrator");
  if (/disab|veteran|gender|race\b(?! conditions?\b)|ethnic|sexual|religio|birth|\bage\b|\b18\b|social security|\bssn\b|criminal|convict|consent|agree|certify|signature|sponsor|visa|citizen|eligible|eligibility|right to work|referr|related to|relative|family|government|political|employed (?:by|with|at)|resident|salary|compensation|pay\b|availability|\bavailable\b|schedule|saturday|sunday|weekdays|relocat|commut|located in|how long|time off|start date/i.test(decisions) ||
      (/authoriz/.test(text) && !technicalAuthorization))
    return "personal";
  // Preferences are editable drafts with user context, never inferred facts.
  if (/(?:how (?:comfortable|confident)|most confident|what would you build|preferred (?:language|framework))/.test(text)) return "context";
  if (/why|explain|describe/i.test(text) && /part[ -]?time|flexib|career (?:break|change)|leaving|leave your/i.test(text)) return "context";
  if (/anything (?:else )?about your (?:experience|background)|additional (?:information|experience).{0,70}(?:fit|candidacy)|(?:experience|background).{0,90}help us evaluate your fit/.test(text)) return "draft";
  if (/^(?:do you have|have you|how many years|what is your experience)/.test(text) && /experience|worked with|built|managed|managing|programming|proficien|familiar with/.test(text)) return "qualification";
  if (/^why (?:this|the) (?:role|job|company)[?*\s]*$|^relevant (?:experience|project)[?*\s]*$/i.test(text)) return "draft";
  if (/(?:why|what).{0,65}(?:interest|join|work (?:at|for|with)|attract|motivat)|(?:tell|describe|explain|share|summari[sz]e|outline).{0,80}(?:experience|project|background|skill|challenge|accomplish|achievement|built|yourself|a time|decision you|problem you|you (?:managed|implemented|designed|led|delivered|developed))|what makes you.{0,35}(?:fit|candidate)|how.{0,40}(?:experience|background|skills).{0,40}(?:relate|prepare|align|apply)/i.test(text)) return "draft";
  if (/^(?:how (?:would|do|can|should) you|what (?:would|is|are)|explain|describe|compare|design|implement|debug|walk (?:me|us) through|outline|discuss|give an example)/.test(text) &&
      /\b(?:system|software|api|database|sql|query|queries|python|typescript|javascript|react|model|machine learning|ai|pipeline|distributed|scalability|scalable|latency|cache|caching|security|authentication|authorization|testing|test|validation|validate|algorithm|architecture|debug|deployment|data|analysis|analys[ei]s|forecast|financial|finance|valuation|budget|accounting|campaign|marketing|experiment|product|customer|stakeholder|process|operations|incident|reliability|monitoring|service|design|tradeoff|trade-off)\b/.test(text))
    return "knowledge";
  return "personal";
}
