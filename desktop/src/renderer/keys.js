// Shortcuts follow the key, not the letter it types: with the Arabic (or any
// non-Latin) keyboard on, the key marked P still gives "p" to every shortcut,
// digits on the top row still give 1 to 9, and Shift with the / key still
// gives "?". Typing in a text box is not changed: only what the shortcut code
// reads is. A Latin keyboard (English, French...) keeps its own letters.
// This runs before any other key handler (capture phase, first script).
const CODE_KEYS = { Slash: "/", Equal: "=", Minus: "-", Comma: ",", Period: ".", BracketLeft: "[", BracketRight: "]", Semicolon: ";", Quote: "'", Backquote: "`", Backslash: "\\", NumpadAdd: "+", NumpadSubtract: "-" };
const SHIFTED = { "/": "?", "=": "+", "-": "_", ",": "<", ".": ">", "[": "{", "]": "}", ";": ":" };
function latinKey(e) {
  const c = e.code || "";
  let k = null;
  if (/^Key[A-Z]$/.test(c)) k = c.slice(3).toLowerCase();
  else if (/^Digit\d$/.test(c)) k = c.slice(5);
  else if (/^Numpad\d$/.test(c)) k = c.slice(6);
  else if (CODE_KEYS[c]) k = CODE_KEYS[c];
  if (k === null) return e.key;
  if (e.shiftKey && !/^Numpad/.test(c)) k = SHIFTED[k] ?? (/^[a-z]$/.test(k) ? k.toUpperCase() : k);
  return k;
}
// A printable key that isn't plain Latin (Arabic letters, Arabic digits,
// ؟ ، and the Mac's ⌥ letters like å) is read as the key it sits on.
const nonLatin = (key) => typeof key === "string" && key.length === 1 && !/^[\x20-\x7e]$/.test(key);
window.addEventListener(
  "keydown",
  (e) => {
    if (!nonLatin(e.key)) return;
    const k = latinKey(e);
    if (k === e.key) return;
    Object.defineProperty(e, "typedKey", { value: e.key });
    Object.defineProperty(e, "key", { value: k, configurable: true });
  },
  true,
);
