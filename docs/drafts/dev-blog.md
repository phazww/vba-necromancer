---
title: "Resurrecting dead Excel macros in the browser, spec-first with Kiro"
tags: kiro, vba, typescript, hackathon
---

*Written as part of the Kiroween 2026 hackathon. Draft — numbers and screenshots get updated before publishing.*

## The dead
Somewhere in a maintenance contractor's office there is a workbook with a button called «Сформировать акты». Click it on a Windows PC with Excel, and a VBA macro turns a month of work logs into acts, a labour statement and totals. Open the same file in the browser, on a Mac or in Google Sheets, and the button does nothing.

I have written macros like that for real clients. VBA Necromancer is my attempt to bring them back without Excel: drop the `.xlsm` into a web page, and the macros run again in an interpreter written in TypeScript.

## Exhuming the code
A macro-enabled workbook is a ZIP; inside is `vbaProject.bin`, a Compound File Binary container; inside that, each module is compressed with the MS-OVBA algorithm and described by a `dir` stream. None of this is exotic, but every detail matters.

## What spec-first changed
I started with Kiro in spec mode: requirements in EARS format, a design with module boundaries, and 17 small tasks, each with its tests. Then Kiro implemented the tasks one by one through the Kiro CLI, while steering docs kept the VBA rules in front of it (banker's rounding, Integer overflow, 1-based `Cells`).

The surprise was what happened next. Kiro's tests were green, so I added tests that do not come from the implementation:

1. **A known-answer test from the MS-OVBA spec.** Section 3.2.2 lists exact compressed bytes for a sample string. Kiro's decompressor failed it: the table that splits a copy token into offset and length bits was upside down. Its own round-trip test had passed only because its compressor never emitted copy tokens.
2. **An independent reader.** I ran `olevba` from oletools on the generated workbooks. It found nothing. Our writer and our reader agreed with each other and with nobody else: the chunk size field excluded the header, the PROJECT stream was in the wrong storage, and the `dir` parser would have stumbled on the very first PROJECTVERSION record of any real Excel file.
3. **VBA, not intuition.** `Round(2.675, 2)` is 2.67 in VBA, because the double is really 2.67499999…; the first implementation said 2.68 and called it "matching VBA".

Each of these became a Kiro hook or a test that can no longer be "fixed" by editing the expected value: the spec-guard hook asks the agent to justify any change to a hand-written oracle and to revert edits that only make a test pass.

## Honest by design
Anything the interpreter cannot run (UserForms, `Declare`, COM objects, file I/O) goes into a graveyard with module and line. A macro that touched any of them is "partly resurrected", never silently "done".

## Status and what's next
*(update before publishing: interpreter, Dictionary shim, UI, demo link, numbers)*
