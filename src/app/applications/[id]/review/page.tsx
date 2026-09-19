import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ExternalLink, UserRound } from "lucide-react";
import { QuestionReview } from "@/components/applications/question-review";
import { ProfileReference } from "@/components/applications/profile-reference";
import { getOptionalSessionUser } from "@/lib/current-user";
import { getApplicationQuestionReview } from "@/lib/queries/application-assistant";

export default async function ApplicationQuestionReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getOptionalSessionUser();
  if (!user)
    redirect(
      `/sign-in?callbackUrl=${encodeURIComponent(`/applications/${id}/review`)}`,
    );
  const review = await getApplicationQuestionReview(user.id, id);
  if (!review) notFound();
  return (
    <div className="app-page max-w-4xl space-y-5">
      <Link
        href={`/applications/${id}`}
        className="text-sm text-muted-foreground"
      >
        &larr; Application workspace
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-5">
        <div className="min-w-0">
          <h1 className="page-title break-words">Review application</h1>
          <p className="mt-2 break-words text-muted-foreground">
            {review.roleTitle} · {review.company}
          </p>
        </div>
        {review.state && (
          <a
            className="inline-flex items-center gap-2 text-sm text-primary"
            href={review.state.sourceUrl}
            target="_blank"
            rel="noreferrer"
          >
            Employer form <ExternalLink className="size-4" />
          </a>
        )}
      </header>
      <div className="flex flex-wrap gap-5 text-sm text-muted-foreground">
        <Link
          className="inline-flex items-center gap-2 hover:text-foreground"
          href="/profile"
        >
          <UserRound className="size-4" />
          Contact details
        </Link>
        <Link className="hover:text-foreground" href={`/applications/${id}`}>
          Resume &amp; documents
        </Link>
        <Link className="hover:text-foreground" href="/settings/extension">
          Remembered answers
        </Link>
      </div>
      <ProfileReference reference={review.reference} />
      {review.state ? (
        <QuestionReview
          id={id}
          state={review.state}
          suggestions={review.suggestions}
        />
      ) : (
        <p className="py-8 text-sm text-muted-foreground">
          No questions captured for this application yet.
        </p>
      )}
    </div>
  );
}
