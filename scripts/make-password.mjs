/**
 * Make an owner password and the hash to paste into Vercel.
 *
 *   node scripts/make-password.mjs              # invent a strong one
 *   node scripts/make-password.mjs "my phrase"  # hash one you chose
 *
 * Prints the password once and the hash to store. The hash is what goes in
 * OWNER_PASSWORD_HASH; the password itself is never written anywhere, which
 * is the point — lose it and you make a new one, nobody recovers the old one.
 *
 * Unlike everything else in scripts/, this touches no database, so it has no
 * loopback guard: it is safe to run anywhere, including on your own laptop.
 */
import { randomInt } from "node:crypto";
import { hashPassword } from "../src/lib/owner-password.ts";

/** Word-shaped and long, because you will type this on a phone. Five words
 * from this list is ~64 bits — far past anything guessable through a login
 * form, and still readable off a screen. */
const WORDS = [
  "amber", "anchor", "atlas", "basil", "beacon", "birch", "bramble", "canyon",
  "cedar", "cinder", "cobalt", "compass", "copper", "coral", "crimson", "dahlia",
  "delta", "domino", "ember", "fable", "falcon", "fennel", "ferry", "flint",
  "garnet", "gable", "harbor", "hazel", "heron", "indigo", "ivory", "juniper",
  "kestrel", "lantern", "larch", "lichen", "lumen", "maple", "marble", "meadow",
  "mesa", "morrow", "nectar", "nimbus", "oakum", "onyx", "opal", "orchard",
  "pebble", "pewter", "pilot", "pine", "quarry", "quill", "ramble", "raven",
  "ripple", "rowan", "saffron", "sable", "sierra", "signal", "slate", "sorrel",
  "spruce", "summit", "tallow", "tamarind", "thistle", "timber", "topaz",
  "trellis", "tundra", "umber", "valley", "vellum", "verdant", "walnut",
  "willow", "winter", "yarrow", "zenith",
];

const supplied = process.argv.slice(2).join(" ").trim();

const password =
  supplied ||
  Array.from({ length: 5 }, () => WORDS[randomInt(WORDS.length)]).join("-");

if (supplied && supplied.length < 12) {
  console.error(
    `\n  That's ${supplied.length} characters. This is the only lock on your\n` +
      `  calendar and there's no second factor behind it — use at least 12,\n` +
      `  or run this with no arguments and let it invent one.\n`,
  );
  process.exit(1);
}

const hash = hashPassword(password);

console.log(`
  Password  (type this to sign in — save it in your password manager)

      ${password}

  OWNER_PASSWORD_HASH  (paste this into Vercel → Settings → Environment Variables)

      ${hash}

  The password is not stored anywhere. If you lose it, run this again and
  replace the hash in Vercel.
`);
