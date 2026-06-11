import { SVGProps } from 'react';

export function IconH(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      {/* Left panel */}
      <rect x="3" y="3" width="8" height="22" rx="1.5" fill="currentColor" />
      {/* Right panel */}
      <rect x="17" y="3" width="8" height="22" rx="1.5" fill="currentColor" />
      {/* Thin horizontal connector */}
      <rect x="11" y="12.5" width="6" height="3" fill="currentColor" />
    </svg>
  );
}

export function IconM(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M2 10V2L6 6L10 2V10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
