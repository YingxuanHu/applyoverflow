import { applicantLivesIn } from "./location-search";

export type ApplicantLocation = { city?: string; region?: string; country?: string };

export function profileLocationAnswer(label: string, location: ApplicantLocation) {
  const text = label.normalize("NFKC").replace(/[*:]/g, "").trim().replace(/\s+/g, " ").toLowerCase();
  const residence = /^(?:are you (?:currently )?(?:located|based|living|residing)|do you (?:currently )?(?:live|reside)) in (?:the )?([^?]{1,180})\??$/.exec(text);
  const city = /^(?:if (?:you (?:are|live|reside) )?in (?:the )?([^,?]{1,100}),? )?(?:in )?(?:what|which) city (?:are you (?:currently )?(?:located|based)|do you (?:currently )?(?:live|reside)(?: in)?)\??$/.exec(text);
  if (!residence && !city) return;
  const areas = residence?.[1] || city?.[1];
  const matches = areas?.split(/\s+or\s+|\s*;\s*/).map(area => applicantLivesIn(area, location));
  const member = !areas || matches?.some(value => value === true) ? true : matches?.every(value => value === false) ? false : undefined;
  return {
    key: residence ? "currentResidence" : "applicantCity",
    answer: residence ? member === undefined ? undefined : member ? "Yes" : "No" : member && location.city ? location.city : undefined,
    reason: member === false && city ? "This city question does not apply to your saved residence. Left blank." :
      "Your saved city, province/state and country could not establish this location. Review it on the form.",
  };
}
