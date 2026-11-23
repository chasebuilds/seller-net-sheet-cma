# Benchmark

Written by `scripts/benchmark.ts` (run `npm run benchmark`). Seeded, so a rerun gives the same numbers. Nothing here is typed by hand.

## What is compared

- **Proration and net totals** are compared with a reference written separately in the script. The reference counts calendar days by stepping through them one at a time, keeps money in whole cents, and rounds half a cent up using integers. The product code counts days by date arithmetic and rounds floating-point numbers.
- **CSV parsing** is run on generated messy files. Each file is built from clean rows whose true values are known, then messed up. The parsed result is compared with the known values.
- The 30/360 rule (every month counts 30 days, a 31st counts as the 30th) and "half a cent rounds up" are definitions both sides share. This checks the code against an independent implementation of those rules. It does not check that a local closing practice uses them.

## Proration (seller share, to the cent)

| Method | Cases | Exact match (days in period, seller days, seller share, effect on net) | Cases whose period holds Feb 29 | Exact on those |
|---|---|---|---|---|
| Actual days | 10000 | 10000 (100.00%) | 1566 | 1566 |
| 360-day | 10000 | 10000 (100.00%) | 1565 | 1565 |
| **Total** | **20000** | **20000 (100.00%)** | **3131** | **3131** |

Cases use calendar years, fiscal years (any start month), single months and quarters, in years 2023 to 2033 (leap years 2024, 2028, 2032 included), with a closing date from 20 days before the period to 20 days after it. Amounts are random whole cents from $0.01 to $40,000.00. Both closing-day owners and both paid states are mixed in.

## Net sheet and buyer cash to close (to the cent)

| Check | Cases | Exact match |
|---|---|---|
| Seller net to the cent, per scenario | 15000 | 15000 (100.00%) |
| Buyer cash to close to the cent, per scenario | 15000 | 15000 (100.00%) |

5000 random jobs, 3 price scenarios each. Each job has 2 payoffs, 3 to 10 seller cost lines and 3 to 10 buyer lines (flat, percent and dollars per $1,000, in all groups), and 2 prorations (either may be switched off), under a random method.

## CSV parser on generated messy files

Mess applied: comma, tab and semicolon separators, CRLF and LF, a byte-order mark, shuffled columns, 0 to 2 unknown columns, header name variants and case, `$` and thousands commas and `k` suffixes, `1,850 sf` style sizes, status synonyms, ISO and M/D/YYYY dates, N/A and blank cells, quoted fields with commas and doubled quotes, padded notes, blank lines, and a blanked days-on-market that must be counted from the dates. Each file also gets 0 to 3 bad rows (no sold price, size typo, unknown status, no list price, no size) that must be skipped with a warning.

| Check | Result |
|---|---|
| Files generated | 2000 |
| Files parsed with every good row exactly right and nothing extra | 2000 (100.00%) |
| Good rows | 43624, exact: 43624 (100.00%) |
| Field values checked | 610736, correct: 610736 (100.00%) |
| Extra rows that should not exist | 0 |
| Bad rows injected | 2997, skipped with a warning naming the row: 2997 (100.00%) |
| Exceptions on generated files | 0 |

## Garbage input

3000 inputs: random characters (quotes, separators, a byte-order mark, a NUL, headers) and generated files cut off at a random length. Exceptions or malformed results: **0**.

## Limits

The reference shares the rules described above. The generated CSV files come from one generator written by the same author as the parser, so they test the mess types listed here and not every spreadsheet export in the wild.
