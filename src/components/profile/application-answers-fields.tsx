"use client";

import { useId } from "react";
import { applicationAnswerFields, applicationTextFields, commuteLocationError, employerAnswerFields, type ApplicationAnswerKey, type CommuteAnswer, type ProfileApplicationAnswers } from "@/lib/profile-application-answers";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";

export function ApplicationAnswersFields({ value, onChange }: {
  value: ProfileApplicationAnswers;
  onChange: (value: ProfileApplicationAnswers) => void;
}) {
  const errorId = useId();
  const set = (key: ApplicationAnswerKey, answer: string) => onChange({ ...value, values: { ...value.values, [key]: answer } });
  const groups: { title: string; keys: ApplicationAnswerKey[] }[] = [
    { title: "Work eligibility", keys: ["over18", "authorizedCA", "authorizedUS", "sponsorshipCA", "sponsorshipUS", "usPerson", "visaDetailsUS"] },
    { title: "Availability and preferences", keys: ["startDate", "noticePeriod", "availability", "desiredPay", "relocation", "travel", "partTimeReason", "partTimeDuration"] },
    { title: "Job source and communication", keys: ["jobSource", "sourceDetails", "smsUpdates", "emailUpdates", "talentCommunity", "jobAlerts", "careerNewsletters"] },
    { title: "Voluntary self-identification", keys: ["gender", "transgender", "sexualOrientation", "ethnicity", "hispanicLatino", "veteran", "veteranOrActiveUS", "disability", "limitingDisability", "physicalDisability"] },
  ];
  return <details id="application-answers" className="sm:col-span-2 border-t border-border pt-4">
    <summary className="cursor-pointer text-sm font-semibold">Optional application answers</summary>
    <label className="mt-4 flex items-start gap-3 text-sm">
      <input type="checkbox" className="mt-1 size-4 shrink-0" checked={value.enabled}
        onChange={event => onChange({ ...value, enabled: event.target.checked })} />
      <span>Use my saved answers when I click Autofill</span>
    </label>
    <p className="mt-2 text-sm text-muted-foreground">Blank means unanswered, not &quot;No&quot;. These choices are not used for job recommendations or AI drafts. Final certifications and legal agreements remain yours to review.</p>
    {groups.map(group => <details key={group.title} className="mt-4 border-t border-border pt-3">
      <summary className="cursor-pointer text-sm font-medium">{group.title}</summary>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        {group.keys.map(key => {
          const choice = applicationAnswerFields.find(f => f.key === key);
          const text = applicationTextFields.find(f => f.key === key);
          const field = choice || text;
          if (!field) return null;
          return <label key={key} className="min-w-0 space-y-1.5 text-sm">
            <span>{field.label}</span>
            {choice ? <select className="h-10 w-full min-w-0 rounded-lg border border-input bg-background px-3"
              value={value.values[choice.key] ?? ""} onChange={event => set(key, event.target.value)}>
              <option value="">Not provided</option>
              {choice.options.map(option => <option key={option} value={option}>{option}</option>)}
            </select> : text && <Input type={text.type} maxLength={text.maxLength}
              value={value.values[text.key] ?? ""} onChange={event => set(key, event.target.value)} />}
          </label>;
        })}
      </div>
    </details>)}
    <details className="mt-4 border-t border-border pt-3">
      <summary className="cursor-pointer text-sm font-medium">Commute willingness by location</summary>
      {(value.commutes || []).map((commute, index) => {
        const update = (change: Partial<CommuteAnswer>) => onChange({ ...value, commutes: value.commutes!.map((row, i) => i === index ? { ...row, ...change } : row) });
        const error = commuteLocationError(commute.location, commute.willingness);
        const locationErrorId = `${errorId}-commute-${index}`;
        return <div key={index} className="mt-4 grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
          <label className="min-w-0 space-y-1.5 text-sm"><span>Commute location (city, state or province, country)</span>
            <Input value={commute.location} placeholder="Toronto, Ontario, Canada" maxLength={200}
              aria-invalid={error ? true : undefined} aria-describedby={error ? locationErrorId : undefined}
              onChange={event => update({ location: event.target.value })} />
            {error && <span id={locationErrorId} className="block text-sm text-destructive">{error}</span>}
          </label>
          <div className="flex items-end gap-2">
            <label className="min-w-0 flex-1 space-y-1.5 text-sm"><span>Willing and able to regularly commute and work in an office at this location</span>
              <select className="h-10 w-full min-w-0 rounded-lg border border-input bg-background px-3"
                value={commute.willingness ?? ""} onChange={event => update({ willingness: event.target.value as CommuteAnswer["willingness"] })}>
                <option value="">Not provided</option><option>Yes</option><option>No</option>
              </select></label>
            <Button type="button" variant="ghost" size="icon" aria-label={`Remove commute location ${index + 1}`} title="Remove commute location"
              onClick={() => onChange({ ...value, commutes: value.commutes!.filter((_, i) => i !== index) })}><Trash2 className="size-4" /></Button>
          </div>
        </div>;
      })}
      <Button type="button" variant="outline" className="mt-4" disabled={(value.commutes?.length || 0) >= 12}
        onClick={() => onChange({ ...value, commutes: [...(value.commutes || []), { location: "" }] })}><Plus className="mr-2 size-4" />Add commute location</Button>
    </details>
    <details className="mt-4 border-t border-border pt-3">
      <summary className="cursor-pointer text-sm font-medium">Employer-specific answers</summary>
      <p className="mt-2 text-sm text-muted-foreground">Relationships and referrals apply only to the employer whose application link you enter.</p>
      {(value.employers || []).map((employer, index) => {
        const update = (key: string, answer: string) => onChange({ ...value, employers: value.employers!.map((row, i) => i === index ? { ...row, [key]: answer } : row) });
        return <div key={index} className="mt-4 grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
          <div className="flex items-end gap-2 sm:col-span-2">
            <label className="min-w-0 flex-1 space-y-1.5 text-sm"><span>Employer application URL</span>
              <Input type="url" value={employer.url} placeholder="https://job-boards.greenhouse.io/company/jobs/..." maxLength={2000} onChange={event => update("url", event.target.value)} /></label>
            <Button type="button" variant="ghost" size="icon" aria-label={`Remove employer answers ${index + 1}`} title="Remove employer answers"
              onClick={() => onChange({ ...value, employers: value.employers!.filter((_, i) => i !== index) })}><Trash2 className="size-4" /></Button>
          </div>
          {employerAnswerFields.map(field => <label key={field.key} className="min-w-0 space-y-1.5 text-sm"><span>{field.label}</span>
            <select className="h-10 w-full rounded-lg border border-input bg-background px-3" value={employer[field.key] || ""} onChange={event => update(field.key, event.target.value)}>
              <option value="">Not provided</option><option>Yes</option><option>No</option>
            </select></label>)}
          {employer.employeeRelationship === "Yes" && <label className="space-y-1.5 text-sm"><span>Names and relationships</span><Input value={employer.relationshipDetails || ""} maxLength={500} onChange={event => update("relationshipDetails", event.target.value)} /></label>}
          {employer.referral === "Yes" && <label className="space-y-1.5 text-sm"><span>Referring employee&apos;s name</span><Input value={employer.referralName || ""} maxLength={200} onChange={event => update("referralName", event.target.value)} /></label>}
        </div>;
      })}
      <Button type="button" variant="outline" className="mt-4" disabled={(value.employers?.length || 0) >= 12}
        onClick={() => onChange({ ...value, employers: [...(value.employers || []), { url: "" }] })}><Plus className="mr-2 size-4" />Add employer</Button>
    </details>
  </details>;
}
