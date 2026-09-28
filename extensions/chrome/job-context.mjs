// Only posting-owned location evidence is eligible. In particular, organization
// addresses, applicantLocationRequirements and page/body prose are not job sites.
// Schema: https://schema.org/JobPosting (jobLocation is distinct from applicants).
export function createJobContext() {
  const aliases = new Map([
    ["ca", "CA"], ["can", "CA"], ["canada", "CA"],
    ["us", "US"], ["usa", "US"], ["u.s.", "US"], ["u.s.a.", "US"],
    ["united states", "US"], ["united states of america", "US"],
  ]);
  const norm = value => typeof value === "string" ? value.trim().toLowerCase() : "";
  const country = value => {
    if (typeof value === "string") return aliases.get(norm(value));
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const values = [value.name, value.identifier, value.alternateName].filter(value => value !== undefined);
    const codes = values.map(value => typeof value === "string" ? aliases.get(norm(value)) : undefined);
    return codes.length && codes.every(code => code && code === codes[0]) ? codes[0] : undefined;
  };
  const consensus = values => values.length && values.every(value => value && value === values[0]) ? values[0] : undefined;
  const component = value => typeof value === "string" && value.length <= 100 &&
    !/[;,/|&\n\r]/.test(value) && !/\b(?:or|and|remote|worldwide|anywhere|multiple)\b/i.test(value)
    ? value.trim().replace(/\s+/g, " ") : "";
  const locationKey = (city, region, code) => {
    const locality = component(city), area = region === undefined ? "" : component(region);
    const key = locality && code && (region === undefined || area) ? [locality, area, code].filter(Boolean).join(", ") : "";
    return key && key.length <= 200 ? key : undefined;
  };
  const sameLocation = values => values.length && values.every(value => value && norm(value) === norm(values[0])) ? values[0] : undefined;
  const array = value => value === undefined ? [] : Array.isArray(value) ? value : [value];
  const jobType = value => array(value).some(type => typeof type === "string" && /^(?:https?:\/\/schema\.org\/)?JobPosting$/.test(type));
  let countryNames;
  function locationText(raw) {
    if (typeof raw !== "string" || raw.length > 240) return undefined;
    const value = raw.replace(/^(?:job |work |employment )?location\s*:\s*/i, "")
      .replace(/\s*\((?:remote|hybrid|on[- ]?site)\)\s*$/i, "").trim();
    if (/\b(?:and|or|worldwide|anywhere|global|multiple)\b|[;/|&]/i.test(value)) return undefined;
    const parts = value.split(",").map(norm);
    // CA in unstructured text can mean California. ISO codes are accepted only
    // in addressCountry, never as a trailing US state or an arbitrary substring.
    const code = aliases.get(parts.at(-1));
    if (!countryNames) {
      countryNames = new Set(["uk", "usa", "us", "united kingdom", "united states of america"]);
      const display = new Intl.DisplayNames(["en"], { type: "region" });
      for (const region of "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(" "))
        countryNames.add(norm(display.of(region)));
    }
    const canadianRegion = parts.length === 3 && /^(?:ab|bc|mb|nb|nl|ns|nt|nu|on|pe|qc|sk|yt)$/.test(parts[1]);
    if (!code || (["ca", "can"].includes(parts.at(-1)) && !canadianRegion) || parts.length > 3) return undefined;
    if (parts.slice(0, -1).some(part => !part || (countryNames.has(part) && aliases.get(part) !== code))) return undefined;
    return code;
  }
  const regionCountries = new Map([
    ..."Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|District of Columbia|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming".split("|").map(name => [norm(name), "US"]),
    ..."Alberta|British Columbia|Manitoba|New Brunswick|Newfoundland and Labrador|Northwest Territories|Nova Scotia|Nunavut|Ontario|Prince Edward Island|Quebec|Saskatchewan|Yukon".split("|").map(name => [norm(name), "CA"]),
  ]);
  function postingCountry(raw) {
    if (typeof raw !== "string" || raw.length > 240) return undefined;
    const parts = raw.replace(/^(?:job |work |employment )?location\s*:\s*/i, "").split(/[;|]/)
      .map(value => value.trim().replace(/^remote(?: opportunity)?\s*(?:[-:\u2013\u2014]\s*|in\s+)/i, "")
        .replace(/\s*\((?:remote|hybrid|on[- ]?site)\)\s*$/i, ""));
    if (parts.length > 8 || parts.some(value => !value)) return undefined;
    const explicit = parts.map(locationText);
    if (parts.length === 1) return explicit[0];
    // An explicit country may be corroborated by a fully named state/province,
    // never by an unknown city or applicant data. Every listed site must agree.
    if (!consensus(explicit.filter(Boolean))) return undefined;
    return consensus(parts.map((value, index) => {
      if (explicit[index]) return explicit[index];
      const address = value.split(",").map(norm);
      if (address.length !== 2 || !component(address[0]) || countryNames.has(address[0]) || countryNames.has(address[1])) return undefined;
      return regionCountries.get(address[1]);
    }));
  }
  function pageKey(raw, base) {
    try {
      const url = new URL(raw, base);
      if (!/^https?:$/.test(url.protocol)) return "";
      url.hash = "";
      if (url.pathname.split("/").filter(Boolean).length > 1) url.pathname = url.pathname.replace(/\/(?:apply|application)\/?$/, "");
      url.pathname = url.pathname.replace(/\/$/, "");
      for (const key of [...url.searchParams.keys()])
        if (/^(?:utm_.*|source|ref|referrer|gclid|fbclid)$/.test(key)) url.searchParams.delete(key);
      url.searchParams.sort();
      return url.href;
    } catch { return ""; }
  }
  function headerLocation(raw) {
    if (/\bremote\b/i.test(raw)) return undefined;
    const code = locationText(raw);
    const parts = raw.replace(/^(?:job |work |employment )?location\s*:\s*/i, "")
      .replace(/\s*\((?:remote|hybrid|on[- ]?site)\)\s*$/i, "").split(",").map(value => value.trim());
    return code && parts.length >= 2 && !aliases.has(norm(parts[0]))
      ? locationKey(parts[0], parts.length === 3 ? parts[1] : undefined, code) : undefined;
  }
  function readJson(elements, url) {
    const scripts = elements.filter(node => node.matches('script[type="application/ld+json"]'));
    if (scripts.length > 16) return { ambiguous: true };
    const objects = [], jobs = [], ids = new Map();
    let bytes = 0;
    for (const script of scripts) {
      const raw = script.textContent || "";
      bytes += raw.length;
      if (raw.length > 131072 || bytes > 262144) return { ambiguous: true };
      let data;
      try { data = JSON.parse(raw); } catch { return { ambiguous: true }; }
      const queue = [[data, 0]];
      for (let i = 0; i < queue.length; i++) {
        const [item, depth] = queue[i];
        if (!item || typeof item !== "object") continue;
        if (depth > 16 || objects.length + queue.length > 4000) return { ambiguous: true };
        if (!Array.isArray(item)) {
          objects.push(item);
          if (jobType(item["@type"])) jobs.push(item);
          if (typeof item["@id"] === "string") {
            // Bare references are not conflicting definitions.
            if (Object.keys(item).length > 1) ids.set(item["@id"], ids.has(item["@id"]) ? null : item);
          }
        }
        for (const child of Object.values(item))
          if (child && typeof child === "object") queue.push([child, depth + 1]);
      }
    }
    const current = pageKey(url, url);
    const urls = job => [job.url, job.mainEntityOfPage?.["@id"], typeof job.mainEntityOfPage === "string" ? job.mainEntityOfPage : undefined,
      job["@id"]?.startsWith("#") ? undefined : job["@id"]].filter(value => typeof value === "string");
    const matched = jobs.filter(job => urls(job).some(value => pageKey(value, url) === current));
    const selected = matched.length === 1 ? matched[0] : jobs.length === 1 && !urls(jobs[0]).length ? jobs[0] : undefined;
    if (jobs.length && !selected) return { ambiguous: true };
    function dereference(value, seen = new Set()) {
      if (!value || typeof value !== "object" || !value["@id"] || Object.keys(value).length > 1) return value;
      if (seen.has(value["@id"]) || seen.size > 6) return undefined;
      seen.add(value["@id"]);
      return dereference(ids.get(value["@id"]), seen);
    }
    const locations = [];
    const values = array(selected?.jobLocation).map(item => {
      const place = dereference(item);
      if (typeof place === "string") {
        locations.push(headerLocation(place));
        return postingCountry(place);
      }
      const address = dereference(place?.address);
      if (!address || typeof address !== "object") { locations.push(undefined); return undefined; }
      const code = consensus(array(address.addressCountry).map(value => country(dereference(value))));
      locations.push(locationKey(address.addressLocality, address.addressRegion, code));
      return code;
    });
    return { present: Boolean(selected), values, locations,
      ambiguousLocation: (locations.length > 1 && !sameLocation(locations)) ||
        array(selected?.jobLocation).some(value => typeof value === "string" && /\bremote\b|[;|]/i.test(value)) ||
        array(selected?.jobLocationType).some(value => /telecommute|remote/i.test(value)),
      ambiguous: values.length > 0 && !consensus(values) };
  }
  function inspect(elements, url, detection, form) {
    const json = readJson(elements, url);
    if (json.ambiguous) return {};
    const evidence = [...(json.values || [])];
    const locationEvidence = (json.locations || []).filter(Boolean);
    let ambiguousLocation = json.ambiguousLocation;
    const addHeaderLocation = value => {
      if (/\bremote\b|[;|]/i.test(value)) ambiguousLocation = true;
      const code = postingCountry(value);
      // A city-only header does not contradict an explicit structured country.
      // Conflicting/unsupported countries and unresolved location lists do.
      const words = norm(value).replace(/[.,()]/g, " ").replace(/\s+/g, " ");
      if (code || /\b(?:and|or|worldwide|anywhere|global|multiple)\b|[;/|&]/i.test(value) ||
          [...(countryNames || [])].some(name => ` ${words} `.includes(` ${name} `))) evidence.push(code);
      const place = headerLocation(value);
      if (place) locationEvidence.push(place);
    };
    const editable = 'input,textarea,select,[contenteditable]:not([contenteditable="false"])';
    const outsideApplicant = node => !node.closest('form,[role="form"],footer,nav,aside,address') &&
      !form?.contains(node) && !node.matches(editable) && !node.querySelector(editable);
    const postingSelector = '[itemscope][itemtype~="https://schema.org/JobPosting"],[itemscope][itemtype~="http://schema.org/JobPosting"]';
    const postings = elements.filter(node => node.matches(postingSelector));
    if (postings.length > 1) return {};
    if (postings.length === 1) {
      const locations = [...postings[0].querySelectorAll('[itemprop~="jobLocation"]')]
        .filter(node => node.closest(postingSelector) === postings[0] && outsideApplicant(node));
      for (const place of locations) {
        const addresses = [...place.querySelectorAll('[itemprop~="address"]')].filter(node =>
          !node.closest('[itemprop~="hiringOrganization"],[itemprop~="applicantLocationRequirements"],[itemtype$="/Organization"]'));
        const address = addresses.length === 1 ? addresses[0] : null;
        const countries = [...(address?.querySelectorAll('[itemprop~="addressCountry"]') || [])];
        const code = countries.length ? consensus(countries.map(node => country(node.getAttribute("content") || detection.text(node)))) : undefined;
        evidence.push(code);
        const property = name => {
          const nodes = address?.querySelectorAll(`[itemprop~="${name}"]`) || [];
          return nodes.length === 1 ? nodes[0].getAttribute("content") || detection.text(nodes[0]) : undefined;
        };
        const location = locationKey(property("addressLocality"), property("addressRegion"), code);
        if (location) locationEvidence.push(location);
        else if (locations.length > 1) ambiguousLocation = true;
      }
    }
    const headerSelector = 'header,.job-header,[data-job-header],[data-testid="job-header"],careers-ui-job-ad-header,.posting-headline,.job__title';
    const locations = elements.filter(node => node.matches('[data-job-location],[data-testid="job-location"],.job-location,.job-ad-subtitle,.posting-categories .location,.job__location'));
    for (const node of locations) {
      const header = node.closest(headerSelector);
      if (!header || !outsideApplicant(node) || !detection.visible(node)) continue;
      if (header.matches('header') && !header.querySelector('h1,h2')) continue;
      // HiBob's observed subtitle also includes employment type and work mode.
      const raw = detection.text(node, 240);
      const value = node.matches('careers-ui-job-ad-header .job-ad-subtitle') ? raw.split("\u00b7")[0].trim() : raw;
      addHeaderLocation(value);
    }
    // A structured definition-list header is common on company-owned job pages.
    for (const node of elements.filter(node => node.matches('dt'))) {
      if (!node.closest(headerSelector) || !/^(?:job |work |employment )?location:?$/i.test(detection.text(node))) continue;
      const value = node.nextElementSibling;
      if (value?.matches('dd') && outsideApplicant(value) && detection.visible(value)) addHeaderLocation(detection.text(value, 240));
    }
    const employmentCountry = consensus(evidence);
    return { employmentCountry,
      employmentLocation: employmentCountry && !ambiguousLocation ? sameLocation(locationEvidence) : undefined,
      hasJobPosting: json.present || postings.length === 1 };
  }
  return { inspect };
}
