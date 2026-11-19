# Demo video script (under 3:00)

Recorded on a Mac in Chrome, to prove the point: no Windows, no Excel. Voice-over in English (or Russian voice with English subtitles). No third-party music.

| Time | On screen | Voice-over |
|---|---|---|
| 0:00–0:15 | An old workbook `acts_2019.xlsm` opened in Google Sheets: the button does nothing, a warning that macros are not supported. | "Millions of business workbooks still run on VBA macros. Open one in the browser, on a Mac or in Google Sheets, and the macros are dead." |
| 0:15–0:30 | The VBA Necromancer page. Drag the same file onto the drop zone ("Exhume"). | "VBA Necromancer brings them back. Everything runs locally in the browser, nothing is uploaded." |
| 0:30–0:50 | The app lists sheets, modules and macros, and the «Сформировать акты» button found on the sheet. | "It reads the VBA project straight from the file: the compressed module streams, the code page, which button calls which macro." |
| 0:50–1:20 | Click the button. The «Акты» sheet fills in. Totals appear. Side by side: the same numbers from Excel on Windows (screenshot taken earlier). | "The macro runs again, in an interpreter we wrote in TypeScript. Same numbers as desktop Excel, down to the kopeck." |
| 1:20–1:45 | Open the trace: each cell read and written, before and after values; click a row to jump to the VBA line. | "Every run leaves a trace: what the macro read, what it wrote, and from which line." |
| 1:45–2:05 | Drop the graveyard workbook. Status «partly resurrected», the graveyard lists Declare, CreateObject, Open with line numbers. | "And it is honest. Anything it cannot run yet goes to the graveyard, with module and line, instead of being silently skipped." |
| 2:05–2:40 | Kiro: the spec folder, a hook running tests, a property-based test failing and then passing (banker's rounding). | "Built spec-first with Kiro: requirements, design and tasks, steering for VBA semantics, hooks that rerun the fixtures, property tests that caught rounding bugs." |
| 2:40–2:55 | Download the resulting `.xlsx`; open it anywhere. | "Download the result as a normal workbook. The macro lived again, just long enough to finish its job." |

## Before recording
- Fixtures and the demo workbook pass end to end.
- The Excel-on-Windows screenshot of the same results is made in advance (or replaced by the hand-checked numbers if no Windows machine is available; then say so in the voice-over, do not imply it).
- The test link is public and loads in under 3 seconds.

## Known gap against this script
- **0:30 to 0:50, "the button found on the sheet".** The UI does not read shapes or form-control buttons yet (`BACKLOG.md` item 2; out of scope for the `resurrection-ui` spec). What the app shows instead is the macro list in the Exhume panel: `Module1.BuildActs` with "Predicted: fully resurrected" and a Run button. Either record that screen and change the voice-over to say the macros are listed from the VBA project, or do not record this row until button reading exists. The voice-over above has not been changed.
- **0:50 to 1:20, "totals appear".** The run itself is real. The comparison with Excel on Windows is still a screenshot made outside the app.

