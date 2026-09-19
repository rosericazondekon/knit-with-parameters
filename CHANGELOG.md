# Changelog

## [0.0.2] - 2026-09-19

- Use a distinct install version to avoid mixing an already-running 0.0.1 host with newly replaced helper scripts; reload the editor after upgrading.
- Add actionable recovery guidance for missing Python results and a real R subprocess regression for `start_date`.

- Add `!python` parameter defaults with explicit execution confirmation on opening or refreshing Parameters.
- Add configurable Python interpreter discovery, date/list/null conversion, and non-executing expression inspection.
- Retain R-expression support and pass evaluated Python defaults explicitly to R Markdown and Quarto rendering.

## [0.0.1] - 2026-09-17

### Features
- Integrated parameter editor for saved R Markdown (`.Rmd`) and Quarto (`.qmd`) documents.
- Text, password, numeric, slider, checkbox, date, and single- and multiple-select parameter controls.
- R Markdown and Quarto rendering with parameter overrides, cancellation, and output preview.
- Automatic Rscript and Quarto discovery with configurable executable paths.
- VS Code editor-title and Positron action-bar commands, plus a Command Palette entry.
- Workspace-trust checks and confirmation before evaluating executable R parameter expressions.
- Theme-specific command and parameter-panel icons for light and dark themes.
