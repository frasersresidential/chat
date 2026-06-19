import { Icon } from "./Icon";

type Props = {
  icon: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
};

// หัวเรื่องมาตรฐานของแต่ละหน้า
export function PageHeader({ icon, title, description, action }: Props) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-600/15 dark:text-brand-300">
          <Icon name={icon} className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">{title}</h1>
          {description && (
            <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{description}</p>
          )}
        </div>
      </div>
      {action}
    </div>
  );
}
