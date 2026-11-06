// Who can't appear (release 0.9, B-54). One rule for every place that
// decides: a face named as a student who can't appear, or a face the app
// suggests is one of them (a likely match counts until someone says it isn't
// them). Used for the web copy (blocked or blurred), the library badge and
// filter, and the check of photos uploaded on the website.

// A SQL condition on a faces row `f` (needs no join).
export const noPostFace = (f = "f") =>
  `exists (select 1 from students np where np.can_post = 0 and (
     (np.id = ${f}.student_id and ${f}.status in ('confirmed', 'manual'))
     or (np.id = ${f}.suggest_id and ${f}.status = 'suggested')))`;

// A SQL condition on a photos row `p`: one of its faces can't appear.
export const noPostPhoto = (p = "p") => `exists (select 1 from faces npf where npf.photo_id = ${p}.id and ${noPostFace("npf")})`;
