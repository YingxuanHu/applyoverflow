// Shared by the server and browser. Eligibility and personal decisions must not
// be inferred from professional experience, even when a question mixes topics.
export function questionAssistance(label) {
  const text = String(label).toLowerCase();
  if (/disab|veteran|gender|race\b|ethnic|sexual|religio|birth|\bage\b|\b18\b|social security|\bssn\b|criminal|convict|consent|agree|certify|signature|authoriz|sponsor|visa|citizen|eligible|eligibility|right to work|referr|related to|relative|family|government|political|employed (?:by|with|at)|resident|salary|compensation|pay\b|availability|available|schedule|saturday|sunday|weekdays|relocat|commut|located in|how long|time off|start date/i.test(text))
    return "personal";
  if (/why|explain|describe/i.test(text) && /part[ -]?time|flexib|career (?:break|change)|leaving|leave your/i.test(text)) return "context";
  if (/^why (?:this|the) (?:role|job|company)[?*\s]*$|^relevant (?:experience|project)[?*\s]*$/i.test(text)) return "draft";
  if (/(?:why|what).{0,65}(?:interest|join|work (?:at|for|with)|attract|motivat)|(?:tell|describe|explain|share|summari[sz]e|outline).{0,80}(?:experience|project|background|skill|challenge|accomplish|achievement|built|yourself)|what makes you.{0,35}(?:fit|candidate)|how.{0,40}(?:experience|background|skills).{0,40}(?:relate|prepare|align|apply)/i.test(text)) return "draft";
  return "personal";
}
