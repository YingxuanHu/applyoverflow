/** @param {{ url: string, method: string, postData?: string | null }} request */
export function isReadOnlyCatalogRequest({ url, method, postData }) {
  const target = new URL(url);
  const catalog = /\/education\/(?:schools|degrees|disciplines)$|\/(?:autocomplete|search|locations|countries|cities|states|regions)(?:\/|$)/i.test(target.pathname) ||
    (/^[a-z0-9-]+\.wd\d+\.myworkdayjobs\.com$/i.test(target.hostname) &&
      /^\/wday\/calypso\/cxs\/jobapplication\/[a-z0-9_-]+\/values\/sources\/[a-z0-9_-]+(?:\/[a-f0-9]{32}){0,2}$/i.test(target.pathname)) ||
    (target.hostname === "my.greenhouse.io" && target.pathname === "/users/self") ||
    (target.hostname === "maps.googleapis.com" && /^\/maps(?:-api-v3)?\//.test(target.pathname));
  if (method === "GET") return catalog;
  if (method !== "POST" || target.hostname !== "jobs.ashbyhq.com" || target.pathname !== "/api/non-user-graphql" ||
      target.searchParams.get("op") !== "ApiAutocompleteGeoLocation") return false;
  try {
    const payload = JSON.parse(postData);
    return payload.operationName === "ApiAutocompleteGeoLocation" &&
      /^query ApiAutocompleteGeoLocation\(/.test(payload.query) && !/\b(?:mutation|subscription)\b/.test(payload.query) &&
      typeof payload.variables?.text === "string" && payload.variables.text.length <= 200 &&
      Object.keys(payload.variables).every(key => ["text", "locationTypes"].includes(key));
  } catch { return false; }
}
