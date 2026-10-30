/** Skeleton shown while a page streams in. Fixed heights avoid layout shift. */
export default function Loading() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="Loading">
      <div className="h-4 w-48 rounded bg-nx-pale" />
      <div className="mt-6 h-9 w-3/4 max-w-xl rounded bg-nx-pale" />
      <div className="mt-8 space-y-3">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="h-4 rounded bg-nx-pale" style={{ width: `${92 - (index % 4) * 9}%` }} />
        ))}
      </div>
    </div>
  );
}
