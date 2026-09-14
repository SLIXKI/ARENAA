import React from 'react';

interface PageHeaderProps {
  /** Small uppercase label above the title, e.g. the section number or domain. */
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Right-aligned actions (buttons). Wraps below the title on small screens. */
  actions?: React.ReactNode;
  /** Anything extra under the description — tags, badges, filters. */
  children?: React.ReactNode;
  className?: string;
}

/**
 * Consistent screen header across every tab.
 *
 * The tabs each invented their own heading markup, so titles, descriptions and
 * action buttons sat at different sizes and offsets from screen to screen. This
 * gives them one rhythm: eyebrow -> title -> description -> meta, with actions
 * right-aligned on desktop and stacked full-width on mobile.
 */
export const PageHeader: React.FC<PageHeaderProps> = ({
  eyebrow,
  title,
  description,
  actions,
  children,
  className = '',
}) => {
  return (
    <header
      className={`flex flex-col gap-4 border-b border-white/8 pb-5 sm:gap-5 sm:pb-6 lg:flex-row lg:items-end lg:justify-between ${className}`}
    >
      <div className="min-w-0 max-w-2xl space-y-2">
        {eyebrow && <p className="ui-eyebrow flex flex-wrap items-center gap-x-2 gap-y-1">{eyebrow}</p>}
        <h1 className="ui-h1 break-words text-white">{title}</h1>
        {description && (
          <p className="text-[13px] leading-relaxed text-neutral-400 sm:text-sm">{description}</p>
        )}
        {children}
      </div>

      {actions && (
        <div className="flex w-full flex-none flex-wrap items-center gap-2 lg:w-auto lg:justify-end">
          {actions}
        </div>
      )}
    </header>
  );
};
