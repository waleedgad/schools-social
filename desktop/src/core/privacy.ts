// Who can't appear (release 0.9, B-54). One rule for every place that
// decides: a face named as a student who can't appear, or a face the app
// suggests is one of them (a likely match counts until someone says it isn't
// them). Used for the web copy (blocked or blurred), the library badge and
// filter, and the check of photos uploaded on the website.

//
// Since 0.11 far and blurred faces, and matches below "Likely", are no
// longer shown as suggestions, but for this check they still count: a
// student who can't appear standing far back in a photo, matched at 50% or
// more, is kept off the website (B-85). 50% is where suggestions started
// before 0.11.
export const PRIVACY_FROM = 0.5;

// A SQL condition on a faces row `f` (needs no join).
export const noPostFace = (f = "f") =>
  `exists (select 1 from students np where np.can_post = 0 and (
     (np.id = ${f}.student_id and ${f}.status in ('confirmed', 'manual'))
     or (np.id = ${f}.suggest_id and ${f}.status = 'suggested')
     or (np.id = ${f}.suggest_id and ${f}.status = 'unknown' and ${f}.suggest_score >= ${PRIVACY_FROM})))`;

// A SQL condition on a photos row `p`: one of its faces can't appear.
export const noPostPhoto = (p = "p") => `exists (select 1 from faces npf where npf.photo_id = ${p}.id and ${noPostFace("npf")})`;

type Q = { prepare: (sql: string) => { get: (...a: (string | number)[]) => unknown } };

// A photo uploaded on the website, now in the library: can its check be
// finished, and does it show someone who can't appear? An exact copy of a
// library photo is never looked at for faces itself: its faces are the
// library photo's (before, it waited for ever). A photo the face finder
// couldn't read stays blocked: it was never checked (B-91).
export function webCheck(db: Q, photoId: number, facesOn: boolean): { ready: boolean; optedOut: boolean } {
  const p = db.prepare("select id, faces_scanned, dup_of from photos where id = ?").get(photoId) as { id: number; faces_scanned: number; dup_of: number | null } | undefined;
  if (!p) return { ready: false, optedOut: false };
  const checked = (p.dup_of ? (db.prepare("select id, faces_scanned, dup_of from photos where id = ?").get(p.dup_of) as typeof p | undefined) : undefined) ?? p;
  if (facesOn && checked.faces_scanned === 0) return { ready: false, optedOut: false };
  const n = (db.prepare(`select count(*) n from faces f where f.photo_id = ? and ${noPostFace("f")}`).get(checked.id) as { n: number }).n;
  return { ready: true, optedOut: n > 0 || (facesOn && checked.faces_scanned === -1) };
}
