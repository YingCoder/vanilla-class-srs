// Sample CSV for the student-roster import (shared by admin and teacher
// Class Detail pages' "Import CSV" modal) — one row, matches the
// name,username,email header the server's parseEnrollCsv expects. Username is
// required for students without an email; email may be left blank.
export const STUDENT_IMPORT_TEMPLATE_CSV = `name,username,email
Zhang San,zhang_san01,zhang.san@example.edu
Li Si,li_si01,
`

export const STUDENT_IMPORT_TEMPLATE_FILENAME = 'student-import-template.csv'
