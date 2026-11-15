const PATHS = {
  arrow: "M19 12H5m6-6-6 6 6 6",
  phone: "M6 3H3v3c0 8.3 6.7 15 15 15h3v-3l-5-2-2 2a15 15 0 0 1-8-8l2-2-2-5Z",
  compare: "M12 3v18M4 6h16M6 6 2 14h8L6 6Zm12 0-4 8h8l-4-8ZM8 21h8",
  info: "M12 11v6M12 7h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z",
  shop: "M3 10v11h18V10M2 10l2-7h16l2 7M2 10h20M9 21v-7h6v7",
  clock: "M12 6v6l4 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z",
  check: "m5 12 4 4L19 6",
  quote: "M4 4h16v12H8l-4 4V4Zm4 4h8M8 12h5",
  sun: "M12 2v2m0 16v2M2 12h2m16 0h2M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
  moon: "M21 13A9 9 0 0 1 11 3 9 9 0 1 0 21 13Z",
};

export function Icon({ name = "info" }) {
  return <svg className="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={PATHS[name] ?? PATHS.info} /></svg>;
}
