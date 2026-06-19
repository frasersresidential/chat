import Link from "next/link";

type Crumb = { label: string; href?: string };

export function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav className="mb-5 flex items-center justify-center gap-2 text-sm text-slate-400">
      {items.map((c, i) => (
        <span key={i} className="flex items-center gap-2">
          {c.href ? (
            <Link href={c.href} className="hover:text-brand-600">
              {c.label}
            </Link>
          ) : (
            <span className="text-slate-600 dark:text-slate-200">{c.label}</span>
          )}
          {i < items.length - 1 && <span className="text-slate-300">/</span>}
        </span>
      ))}
    </nav>
  );
}
