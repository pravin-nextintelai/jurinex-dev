import { formatDate } from "@/lib/text";

/** "Official source" link to India Code plus the last-updated date. */
export default function SourceLink({ sourceUrl, updatedAt }: { sourceUrl: string | null; updatedAt: string | null | undefined }) {
  if (!sourceUrl && !updatedAt) return null;

  return (
    <aside className="mt-10 flex flex-col gap-2 border-t border-nx-line pt-6 font-body text-sm text-nx-muted sm:flex-row sm:items-center sm:justify-between">
      {sourceUrl ? (
        <a href={sourceUrl} rel="nofollow noopener" target="_blank" className="font-medium text-nx-teal-deep hover:text-nx-teal-ink">
          Official source &nearr;
        </a>
      ) : (
        <span />
      )}
      {updatedAt && <p>Last updated {formatDate(updatedAt)}</p>}
    </aside>
  );
}
