# Changelog

## [0.0.3] - 2026-09-23

- Add CI/CD test and build pipeline, including real VS Code 1.96.2 and stable extension-host smoke tests.
- Fall back to the default browser for HTML reports when older Positron APIs lack `previewHtml`.
- Update extension metadata.
- Remove `USE NULL` checkbox from parameters form.
- Add searchable select dropdowns with labeled choices, removable multi-select chips, keyboard navigation, clear controls, and `selectize: false` native fallback.
- Add Shiny-like numeric sliders with a filled track, moving value label, endpoint labels, and step-based ticks with a bounded scale for large ranges.
- Support slider display options (`ticks`, `sep`, `pre`, `post`) while preserving numeric submissions.

## [0.0.2] - 2026-09-19

- Add support for file Input.
- Add a python bridge.
- Add support for dynamic inline `R` script in the YAML of parameterized R Markdown (`.Rmd`) and Quarto (`.qmd`) documents.
- Add support for dynamic inline `python` script in the YAML of parameterized R Markdown (`.Rmd`) and Quarto (`.qmd`) documents.
- Add `!r` with explicit execution confirmation on opening or refreshing Parameters.
- Add `!python` with explicit execution confirmation on opening or refreshing Parameters.
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
