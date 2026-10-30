import Link from "next/link";

export interface Crumb {
  label: string;
  /** Route inside this app (already passed through toRoute). Omit for the current page. */
  href?: string;
}

/** Semantic breadcrumb trail. The first crumb is always the Acts index. */
export default function Breadcrumbs({ items }: { items: Crumb[] }) {
  const crumbs: Crumb[] = [{ label: "Acts", href: "/" }, ...items];

  return (
    <nav aria-label="Breadcrumb" className="font-body text-sm text-nx-muted">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          return (
            <li key={`${crumb.label}-${index}`} className="flex items-center gap-2">
              {crumb.href && !last ? (
                <Link href={crumb.href} className="transition-colors hover:text-teal-700">
                  {crumb.label}
                </Link>
              ) : (
                <span aria-current={last ? "page" : undefined} className={last ? "font-medium text-nx-ink" : undefined}>
                  {crumb.label}
                </span>
              )}
              {!last && (
                <span aria-hidden="true" className="text-nx-faint">
                  /
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
