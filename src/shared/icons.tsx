import type { ReactElement, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

export function BookIcon(props: IconProps): ReactElement {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path d="M3.5 5.5c2.2-.9 4.8-.5 6.5 1v11c-1.7-1.5-4.3-1.9-6.5-1v-11Z" />
      <path d="M20.5 5.5c-2.2-.9-4.8-.5-6.5 1v11c1.7-1.5 4.3-1.9 6.5-1v-11Z" />
      <path d="M12 6.5v11" />
    </svg>
  );
}

export function ArrowIcon(props: IconProps): ReactElement {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path d="M5 12h13M13 6l6 6-6 6" />
    </svg>
  );
}

export function LockIcon(props: IconProps): ReactElement {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <rect x="5" y="10" width="14" height="10" rx="1.8" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v2" />
    </svg>
  );
}
