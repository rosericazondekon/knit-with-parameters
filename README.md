# Knit with Parameters <a href='#'><img src='media/ext-logo.png' align="right" height="139" /></a>

Edit YAML parameters and render parameterized R Markdown or Quarto reports in an integrated panel in Positron or VS Code.

[![Test and Build](https://github.com/rosericazondekon/knit-with-parameters/actions/workflows/check-standard.yml/badge.svg)](https://github.com/rosericazondekon/knit-with-parameters/actions/workflows/check-standard.yml)
![Version](https://img.shields.io/badge/version-0.0.3-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Open VSX Downloads](https://img.shields.io/open-vsx/dt/rosericazondekon/knit-with-parameters)

## Demo

![](https://raw.githubusercontent.com/rosericazondekon/knit-with-parameters/master/_assets/knit-with-parameters.gif)

## Requirements

- Positron or VS Code compatible with the VS Code `^1.85.0` API.
- R with `knitr`, `jsonlite`, and `yaml`; also `rmarkdown` for `.Rmd` rendering.
- Quarto CLI for `.qmd` rendering, plus any packages and output tools required by the report.
- A trusted workspace. Parameter discovery uses a separate Rscript process, not the active R console.

## Install from VSIX

1. Open the [latest release](https://github.com/rosericazondekon/knit-with-parameters/releases/latest) and download the `.vsix` file under **Assets** (not the source-code archive).
2. In **Positron** or **VS Code**, open the Command Palette with **Ctrl+Shift+P** (Windows/Linux) or **Cmd+Shift+P** (macOS).
3. Run **Extensions: Install from VSIX...** and select the downloaded file. Alternatively, open the Extensions view, select **...**, then **Install from VSIX...**.
4. Reload the editor if prompted. Open a saved `.Rmd` or `.qmd` report and run **Knit with Parameters**.

## Usage

1. Open a saved `.Rmd` or `.qmd` report with YAML `params`.
2. Select **Knit with Parameters** from the editor toolbar or Command Palette.
3. Edit the resolved parameter values as needed, then select **Knit**.
4. Inspect the rendered output and the **Knit with Parameters** Output channel.

## Settings

- `knitWithParameters.rscriptPath`: optional Rscript executable path.
- `knitWithParameters.quartoPath`: optional Quarto executable path.
- `knitWithParameters.pythonPath`: optional Python 3 executable used for `!python` defaults. Set an absolute interpreter path to select a specific environment.
- Leave executable settings empty for automatic discovery. Explicit paths must not include shell quotes or arguments.
- For missing tools or packages, check the resolved executable paths in the Output channel. In remote workspaces, dependencies must be installed on the remote host.

## For developers

Run commands from the extension's project root with a current Node.js LTS release and npm.

- **Install dependencies:** `npm install`
- **Compile:** `npm run compile`
- **Run Node tests:** `npm test` (includes compilation).
- **Debug:** select **Run Parameter Extension** in Run and Debug, then open a report in the Extension Development Host.
- **Verify:** test `.Rmd` and `.qmd` rendering, cancellation, parameter refresh.

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