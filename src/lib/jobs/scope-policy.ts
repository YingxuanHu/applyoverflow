export const EXCLUDED_TITLE_PATTERNS = [
  // NOTE: HR/People/Recruiting roles were previously excluded but are now
  // legitimate white-collar pool members. Removed.
  // Healthcare / Medical
  /\b(registered nurse|\bRN\b|nurse practitioner|nursing|physician|surgeon|medical director|pharmacist|pharmacy|dental|dentist|veterinar|therapist|physiotherapist|occupational therapist|radiolog|pathologist|optometrist|chiropract|paramedic|midwife|phlebotom|sonograph|respiratory|speech.lang|audiolog|dietitian|nutritionist|oncology|hematology|cardiolog|neurolog|dermatolog|psychiatr|anesthesi|medical science liaison|clinical research associate|clinical nurse)\b/i,
  // Trades / Manual labour
  /\b(mechanic|electrician|plumber|welder|carpenter|painter|roofer|mason|hvac|installer(?!\s+(?:software|engineer))|pipefitter|millwright|machinist|sheet metal|ironworker|boilermaker|glazier|drywall|framing)\b/i,
  // Driving / Transportation
  /\b(cdl|truck driver|bus driver|delivery driver|forklift|warehouse associate|sorter|picker|packer)\b/i,
  // Childcare / Domestic
  /\b(babysitter|nanny|caregiver|childcare|au pair)\b/i,
  // Food service / Retail frontline
  /\b(?:bakery|deli|produce|meat|grocery)\s+(?:in[ -]?store\s+)?(?:clerk|associate|assistant|team member)\b/i,
  /\bin[ -]?store\s+(?:clerk|associate|cashier|stocker)\b/i,
  /\b(barista|server|cook\b|chef\b|dishwasher|busser|bartender|cashier|stocker|grocery|salad\s+bar|meat\s+clerk|produce\s+clerk|deli\s+clerk|bakery\s+clerk|retail\s+store\s+manager|retail\s+associate|store\s+associate|store\s+clerk)\b/i,
  // Education (non-tech). "dean" alone is too broad — academic deans of
  // operations / career services / student affairs / business admin /
  // research are legitimate white-collar admin roles. Allow those by
  // requiring "dean" NOT be followed by an admin-flavoured noun, mirroring
  // the same lookahead trick used for "principal" above. "associate dean"
  // / "assistant dean" of operations / administration / finance also pass.
  /\b(teacher|professor|lecturer|tutor(?!ial)|principal(?!\s+(?:engineer|architect|consultant|analyst|developer|scientist|designer|manager|director|swe|technical|planning|product|data|security|program|software|cloud|platform|solutions|financial|investment))|superintendent|librarian|dean\b(?!\s+(?:of\s+)?(?:operations|administration|admin|finance|business|career\s+services|student\s+affairs|enrollment|research|admissions|advancement|external\s+affairs|institutional))|provost)\b/i,
  // Skilled trades / Construction
  /\b(crane operator|heavy equipment|excavat|concrete|paving|asphalt|demolition|scaffolding|surveyor)\b/i,
  // Law enforcement / Emergency / Military (not corporate security)
  /\b(police|sheriff|firefighter|paramedic|corrections officer|probation officer|dispatch(?!er\b.*(?:software|tech|logistics)))\b/i,
  // Agriculture / Outdoors
  /\b(farm worker|rancher|horticultur|arborist|landscap|groundskeeper)\b/i,
  // French healthcare / trades / manual exclusions
  /\b(infirmi(?:er|ère)|médecin|chirurgien|pharmacien|dentiste|vétérinaire|ambulancier|sage-femme|préposé aux bénéficiaires|aide-soignant|ouvrier|soudeur|mécanicien|électricien|plombier|charpentier|camionneur|chauffeur(?:\s+de\s+camion)?|enseignant|professeur|journalier|manoeuvre|assembleur|magasinier|opérateur de machinerie|éducateur.*petite enfance|ajusteur|monteur d'avions)\b/i,
  // General spam / non-job patterns
  /\b(door\s+to\s+door|brand\s+ambassador.*activation|remote\s+recruiter.*\$\d|personal\s+development\s+sales)\b/i,
];

/**
 * Product-scope gate for titles that are clearly outside the knowledge-worker
 * job pool. Keep this separate from role-family inference: a broad fallback
 * classifier must never turn an excluded title into a publishable job.
 */
export function isExcludedJobTitle(title: string) {
  if (/\bnurse(?:\s+manager)?\b/i.test(title) && !/\b(informatics|research|analyst)\b/i.test(title)) return true;
  // Non-clinical healthcare and public-sector administration are GENERAL work.
  // Require an office occupation, not just the industry (e.g. dental assistant).
  if (/\b(pharmacy|dental|medical|hospital|healthcare|police|sheriff)\b/i.test(title) &&
      /\b(benefits|billing|records|payroll|revenue\s+cycle|insurance|compliance)\s+(?:\w+\s+){0,2}(analyst|specialist|clerk|coordinator|manager|director|administrator|auditor)\b/i.test(title)) return false;
  // Industry names are not occupations: pharmacy data analysts, server
  // engineers and school administrators belong in the knowledge-worker pool.
  if (/\bsupply chain\s+(analyst|manager|director|specialist|consultant|coordinator)\b/i.test(title)) return false;
  if (/\b(software|data|systems?|platform|cloud|security|network|research|policy|financial|business|marketing|sales|legal|people|human resources|communications|product|project)\s+(?:\w+\s+){0,2}(engineer|developer|analyst|scientist|researcher|designer|manager|director|specialist|consultant|administrator)\b/i.test(title) ||
      /\b(office manager|administrator|administration|admissions|enrollment|fundraising|clinical research associate|medical science liaison)\b/i.test(title) ||
      /\b(?:sql\s+)?server\s+(engineer|developer|dba|administrator)\b/i.test(title)) {
    return false;
  }
  return EXCLUDED_TITLE_PATTERNS.some((pattern) => pattern.test(title));
}
