// Arabic and English spelling variations, so a search for "Mohamed" finds
// Muhammad and Mohammed, "Youssef" finds Yusuf, and Arabic letters often
// written either way (أ إ آ ا, ة ه, ى ي) match.
export function nameKey(s: string | null | undefined) {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[ً-ٰٟ̀-ͯ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/^(abd|abdel|abdul|abd el|abd al)\s*/g, "abd")
    .replace(/\b(el|al)[- ]/g, "")
    .replace(/ph/g, "f")
    .replace(/ou|oo|u/g, "o")
    .replace(/ee|i|y/g, "e")
    .replace(/kh/g, "k")
    .replace(/(.)\1+/g, "$1")
    .replace(/[aeo]/g, "")
    .replace(/[^a-z؀-ۿ0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function nameMatches(query: string, ...names: (string | null | undefined)[]) {
  const q = nameKey(query);
  if (!q) return false;
  return names.some((n) => nameKey(n).includes(q));
}
