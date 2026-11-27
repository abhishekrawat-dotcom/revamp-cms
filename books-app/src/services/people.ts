// How a person is named in the editor: the part of their email before the @ (the owner, 26 Nov 2026), and two
// letters for the small marks on page thumbnails.
export function personName(email: string): string {
  const e = String(email || '').trim();
  if (!e) return 'someone else';
  return e.includes('@') ? e.slice(0, e.indexOf('@')) : e;
}

export function initialsOf(email: string): string {
  const n = personName(email);
  const parts = n.split(/[._\-\s]+/).filter(Boolean);
  const two = parts.length >= 2 ? parts[0].charAt(0) + parts[1].charAt(0) : n.slice(0, 2);
  return two.toUpperCase() || '?';
}
