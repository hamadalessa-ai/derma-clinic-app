import * as React from "react";

/** One title per page (22px on phones, 28px on desktop), an optional subtitle and actions. */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[22px] leading-[30px] font-semibold md:text-[28px] md:leading-9">
          {title}
        </h1>
        {subtitle && <p className="text-muted-foreground mt-1 text-[13px] leading-5">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
