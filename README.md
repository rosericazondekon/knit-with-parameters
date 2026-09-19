# Knit with Parameters

Edit YAML parameters and render parameterized R Markdown or Quarto reports in an integrated panel in Positron or VS Code.

![Version](https://img.shields.io/badge/version-0.0.1-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## Requirements

- Positron or VS Code compatible with the VS Code `^1.85.0` API.
- R with `knitr`, `jsonlite`, and `yaml`; also `rmarkdown` for `.Rmd` rendering.
- Quarto CLI for `.qmd` rendering, plus any packages and output tools required by the report.
- A trusted workspace. Parameter discovery uses a separate Rscript process, not the active R console.

## Install

1. Open the [latest release](https://github.com/rosericazondekon/knit-with-parameters/releases/latest) and download the `.vsix` file under **Assets** (not the source-code archive).
2. In **Positron** or **VS Code**, open the Command Palette with **Ctrl+Shift+P** (Windows/Linux) or **Cmd+Shift+P** (macOS).
3. Run **Extensions: Install from VSIX...** and select the downloaded file. Alternatively, open the Extensions view, select **...**, then **Install from VSIX...**.
4. Reload the editor if prompted. Open a saved `.Rmd` or `.qmd` report and run **Knit with Parameters**.

- Install separately in each editor if using both Positron and VS Code.
- To update manually, download the latest `.vsix` and repeat these steps.

## Usage

1. Open a saved `.Rmd` or `.qmd` report with YAML `params`.
2. Select **Knit with Parameters** from the editor toolbar or Command Palette.
3. Edit the resolved parameter values as needed, then select **Knit**.
4. Inspect the rendered output and the **Knit with Parameters** Output channel.

- Supports text, password, numeric, slider, checkbox, date, file, and single/multiple-select controls.
- File parameters provide an editable path and **Browse…** button. Browse opens an in-editor file picker: select folders to navigate, `..` to go up, or **Enter folder path…** to jump to a directory. Select a file to use it. Paths are relative to the report directory; file contents are not uploaded.
- Controls start with the document's resolved values. Every value, including unchanged values, is submitted explicitly; **Use NULL** sends null. Rendering does not rewrite the report's YAML.
- Save and refresh the form after editing the report; **Cancel** stops an active operation.
- Only run trusted reports: parameter expressions and rendering execute code. Password masking cannot prevent report code from exposing secrets.

## Settings

- `knitWithParameters.rscriptPath`: optional Rscript executable path.
- `knitWithParameters.quartoPath`: optional Quarto executable path.
- Leave both empty for automatic discovery. Explicit paths must not include shell quotes or arguments.
- For missing tools or packages, check the resolved executable paths in the Output channel. In remote workspaces, dependencies must be installed on the remote host.

## For developers

Run commands from the extension's project root with a current Node.js LTS release and npm.

- **Install dependencies:** `npm install`
- **Compile:** `npm run compile`
- **Run Node tests:** `npm test` (includes compilation).
- **Run R bridge tests separately:** in R, run `source("tests/bridge-tests.R")`, then `run_bridge_tests()`.
- **Debug:** select **Run Parameter Extension** in Run and Debug, then open a report in the Extension Development Host.
- **Package:** create the `dist` directory if needed, then run `npm run package -- --out dist/knit-with-parameters-0.0.1.vsix`. Packaging compiles automatically; match the filename to the version in [package.json](package.json).
- **Verify:** test `.Rmd` and `.qmd` rendering, cancellation, parameter refresh, and light/dark icons before distributing the VSIX.

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests (`npm test`)
5. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) for details.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.