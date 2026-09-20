"use client";

import { useId, useMemo, type MouseEvent } from "react";
import { buildDescriptionPresentation } from "@/lib/jobs/description-presentation";
import { hasUsableSourceDescription } from "@/lib/jobs/description-quality";
import { capabilityEvidence, extractCapabilities } from "@/lib/jobs/capabilities";
import { descriptionMetadata } from "@/lib/jobs/description-text-structure";

function InlineDescriptionText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*\n]+\*\*|__[^_\n]+__)/g);
  return parts.map((part, index) => {
    const emphasized = part.match(/^(?:\*\*|__)(.+)(?:\*\*|__)$/);
    return emphasized ? <strong className="font-semibold text-foreground" key={index}>{emphasized[1]}</strong> : part;
  });
}

export function JobDescriptionContent({ description, profileSkills = [] }: { description: string; profileSkills?: string[] }) {
  const id = useId();
  const { sections, highlights } = useMemo(() => buildDescriptionPresentation(description), [description]);
  const isCompleteEnough = useMemo(() => hasUsableSourceDescription(description), [description]);
  const sectionId = (index: number) => `${id}-section-${index}`;
  const evidence = useMemo(() => capabilityEvidence(description), [description]);
  const profileCapabilities = new Set(extractCapabilities(profileSkills.join("; ")));
  const qualifications = evidence.filter((fact, index) => ["requirements", "preferred"].includes(fact.category) && evidence.findIndex((other) => other.skill === fact.skill && other.category === fact.category) === index);
  const blockId = (section: number, block: number, item = 0) => `${sectionId(section)}-block-${block}-${item}`;
  function jump(event: MouseEvent<HTMLAnchorElement>, index: number, block?: number, item?: number) {
    const target = document.getElementById(block === undefined ? sectionId(index) : blockId(index, block, item));
    if (!target) return;
    event.preventDefault();
    const scroller = target.closest<HTMLElement>("[data-description-scroll]");
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth";
    if (scroller && (scroller.scrollHeight > scroller.clientHeight || window.matchMedia("(min-width: 1024px)").matches)) {
      scroller.scrollTo({ top: scroller.scrollTop + target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 16, behavior });
    } else {
      target.scrollIntoView({ block: "start", behavior });
    }
    target.focus({ preventScroll: true });
  }
  const namedSections = sections.map((section, index) => ({ ...section, index })).filter((section) => section.heading);

  return (
    <div className="max-w-[76ch] min-w-0 break-words text-base leading-7 text-foreground/85 [overflow-wrap:anywhere]" data-job-description>
      {!isCompleteEnough ? <p className="mb-5 border-l-2 border-border pl-3 text-sm leading-6 text-muted-foreground">{sections.length ? "This source excerpt may be incomplete. Check the original posting for the full requirements." : "The source description is not available yet. Check the original posting for the full requirements."}</p> : null}
      {qualifications.length ? <section aria-label="Qualification evidence" className="mb-6 border-y border-border/60 py-4">
        <h3 className="mb-3 text-base font-semibold text-foreground">Qualification evidence</h3>
        <dl className="space-y-3">
          {qualifications.slice(0, 8).map((fact) => <div key={`${fact.category}:${fact.skill}`} className="text-sm leading-6">
            <dt className="flex flex-wrap items-baseline gap-x-2 font-medium">{fact.skill}<span className="text-xs font-normal text-muted-foreground">{fact.category === "preferred" ? "Preferred" : "Requirements section"}{profileSkills.length ? profileCapabilities.has(fact.skill) ? " · Listed in your profile" : " · Not listed in your profile" : ""}</span></dt>
            <dd className="text-muted-foreground"><a className="underline decoration-border underline-offset-4 hover:text-primary" href={`#${blockId(fact.sectionIndex, fact.blockIndex, fact.itemIndex)}`} onClick={(event) => jump(event, fact.sectionIndex, fact.blockIndex, fact.itemIndex)}>{fact.text.length <= 400 ? fact.text : "View the full source passage"}</a></dd>
          </div>)}
        </dl>
      </section> : null}
      {highlights.length ? (
        <section aria-label="At a glance" className="mb-6 border-y border-border/60 py-4">
          <h3 className="mb-3 text-base font-semibold text-foreground">At a glance</h3>
          <dl className="space-y-3">
            {highlights.map((highlight) => (
              <div key={highlight.sectionIndex} className="grid gap-1 sm:grid-cols-[minmax(7rem,1fr)_3fr] sm:gap-4">
                <dt className="text-sm font-medium leading-6 text-muted-foreground">
                  <a href={`#${sectionId(highlight.sectionIndex)}`} onClick={(event) => jump(event, highlight.sectionIndex)} className="underline decoration-border underline-offset-4 hover:text-primary">{highlight.label}</a>
                </dt>
                <dd className="text-sm leading-6"><InlineDescriptionText text={highlight.text} /></dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
      {namedSections.length > 1 ? (
        <nav aria-label="Description sections" className="mb-6 flex flex-wrap gap-x-4 gap-y-2 border-b border-border/60 pb-4 text-sm leading-6">
          {namedSections.map((section) => (
            <a key={section.index} href={`#${sectionId(section.index)}`} onClick={(event) => jump(event, section.index)} className="text-muted-foreground underline decoration-border underline-offset-4 hover:text-primary">{section.heading}</a>
          ))}
        </nav>
      ) : null}
      <div className="space-y-7">
        {sections.map((section, index) => (
          <section key={index} className="space-y-3" aria-labelledby={section.heading ? sectionId(index) : undefined}>
            {section.heading ? <h3 id={sectionId(index)} tabIndex={-1} className="scroll-mt-24 text-lg font-semibold leading-7 text-foreground focus-visible:outline-2 focus-visible:outline-primary">{section.heading}</h3> : null}
            {section.blocks.map((block, blockIndex) => {
              if (block.kind === "paragraph") {
                const fact = descriptionMetadata(block.text);
                if (!fact) return <p id={blockId(index, blockIndex)} tabIndex={-1} key={blockIndex}><InlineDescriptionText text={block.text} /></p>;
                const previous = section.blocks[blockIndex - 1];
                if (previous?.kind === "paragraph" && descriptionMetadata(previous.text)) return null;
                const facts = [];
                for (let next = blockIndex; next < section.blocks.length; next += 1) {
                  const candidate = section.blocks[next];
                  const metadata = candidate.kind === "paragraph" ? descriptionMetadata(candidate.text) : null;
                  if (!metadata) break;
                  facts.push({ ...metadata, index: next });
                }
                return <dl key={blockIndex} className="grid gap-x-6 gap-y-3 py-2 text-sm sm:grid-cols-2">
                  {facts.map((metadata) => <div key={metadata.index} id={blockId(index, metadata.index)} tabIndex={-1}>
                    <dt className="text-xs font-medium text-muted-foreground">{metadata.label}</dt>
                    <dd className="text-foreground"><InlineDescriptionText text={metadata.value} /></dd>
                  </div>)}
                </dl>;
              }
              if (block.kind !== "list") return null;
              const ordered = block.items.every((item) => /^\d+\.\s/.test(item));
              return ordered ? (
                <ol key={blockIndex} className="list-decimal space-y-2 pl-5 marker:text-muted-foreground">
                  {block.items.map((item, itemIndex) => <li id={blockId(index, blockIndex, itemIndex)} tabIndex={-1} key={itemIndex} value={Number.parseInt(item, 10)} className="pl-0.5"><InlineDescriptionText text={item.replace(/^\d+\.\s+/, "")} /></li>)}
                </ol>
              ) : (
                <ul key={blockIndex} className="list-disc space-y-2 pl-5 marker:text-primary/70">
                  {block.items.map((item, itemIndex) => <li id={blockId(index, blockIndex, itemIndex)} tabIndex={-1} key={itemIndex} className="pl-0.5"><InlineDescriptionText text={item} /></li>)}
                </ul>
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
}
