import { SVGProps } from 'react';

export function IconH(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <rect x="4" y="4" width="6" height="20" fill="currentColor" />
      <rect x="18" y="4" width="6" height="20" fill="currentColor" />
      <rect x="10" y="11" width="8" height="6" fill="currentColor" />
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
