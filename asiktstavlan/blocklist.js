// Ordfilter – första moderingslagret.
// Träffar här skickar inlägget till godkännandekön (de raderas inte automatiskt).
// Lägg gärna till egna ord. Skriv dem i gemener utan specialtecken.
//
// WHOLE_WORDS: matchas bara som hela ord (korta ord som annars ger falsklarm).
// FRAGMENTS:   matchas var som helst, även ihopskrivet ("dumjävelhora").

export const WHOLE_WORDS = [
  // vulgärt (sv)
  "kuk", "fitta", "fittan", "fittor", "hora", "horan", "horor", "knulla", "knullar", "knull",
  "runka", "runkar", "kuksugare", "slyna", "slynor", "mutta",
  // vulgärt (en)
  "fuck", "fucking", "fucker", "cunt", "dick", "cock", "pussy", "whore", "slut", "bitch", "wanker",
  // nedsättande
  "mongo", "cp", "retard", "fag", "paki", "kike", "chink", "spic",
];

export const FRAGMENTS = [
  // rasistiska/nedsättande ord om folkgrupper
  "neger", "negrer", "nigger", "nigga", "negro", "blatte", "svartskalle", "svartskallar",
  "zigenarjävel", "zigge", "tattare", "jävlajude", "judejävel", "judesvin", "muslimjävel",
  "muzzie", "apmänniska", "bögjävel", "flata", "transjävel", "faggot",
  // nazistiskt / hot mot grupper
  "siegheil", "heilhitler", "whitepower", "whitegenocide", "folkutbyte", "gasajudar",
  "gasthejews", "killall", "dödaalla", "skjutaalla", "utrota",
  // vulgärt sammansatt
  "fittjävel", "kukjävel", "horunge", "motherfucker", "fittansmor",
];
