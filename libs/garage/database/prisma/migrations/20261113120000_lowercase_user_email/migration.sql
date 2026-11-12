-- Hand-written, no schema change: e-mails are compared lower-cased from now on
-- (sign-in lower-cases the claim, the employee sync always did), but
-- `User.email` is a case-sensitive unique, so a row stored as `Jane.Doe@…`
-- would never be matched again. Lower-case every address whose lower-cased
-- form is not shared by another row; such a pair is left as it is for an
-- admin to merge by hand (the sync warns about it).
UPDATE "User" AS u
SET "email" = lower(btrim(u."email"))
WHERE u."email" <> lower(btrim(u."email"))
  AND NOT EXISTS (
    SELECT 1 FROM "User" AS other
    WHERE other."id" <> u."id"
      AND lower(btrim(other."email")) = lower(btrim(u."email"))
  );
