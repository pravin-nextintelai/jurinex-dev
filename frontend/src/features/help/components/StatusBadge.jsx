import React from "react";
import { STATUS_META } from "./constants";

export default function StatusBadge({ status }) {
  const meta = STATUS_META[status] || STATUS_META.open;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${meta.chip}`}
    >
      {meta.label}
    </span>
  );
}
