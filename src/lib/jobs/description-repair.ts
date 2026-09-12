import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { needsDescriptionRepair, type DescriptionRepairInput } from "./description-quality";

export function descriptionRepairKey(job: { id: string; description: string; applyUrl: string }, now = new Date()) {
  const version = createHash("sha256").update(job.description).update("\0").update(job.applyUrl).digest("hex");
  return `${job.id}:${version}:${now.toISOString().slice(0, 10)}`;
}

export async function enqueueDescriptionRepair(job: DescriptionRepairInput & { id: string; applyUrl: string }) {
  if (!needsDescriptionRepair(job)) return;
  const idempotencyKey = descriptionRepairKey(job);
  await prisma.pipelineTask.upsert({
    where: { queueName_idempotencyKey: { queueName: "DESCRIPTION_REPAIR", idempotencyKey } },
    create: { queueName: "DESCRIPTION_REPAIR", idempotencyKey, maxAttempts: 3, payloadJson: { canonicalJobId: job.id } },
    update: {},
  });
}
