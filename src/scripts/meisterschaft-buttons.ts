const base = 'inline-flex min-h-11 items-center justify-center rounded-xl border px-5 py-2.5 text-center text-sm font-semibold leading-tight no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#173a2e] disabled:cursor-not-allowed disabled:opacity-50 motion-safe:transition-colors';

export const championshipButton = {
  primary: `${base} border-transparent bg-[#173a2e] text-white! hover:bg-[#234e40]`,
  secondary: `${base} border-[#aebdb2] bg-white text-[#173a2e] hover:bg-[#e9ece0]`,
  danger: `${base} border-red-200 bg-white text-red-800 hover:bg-red-50`,
};
