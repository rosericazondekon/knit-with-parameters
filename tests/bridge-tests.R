run_bridge_tests <- function(root = ".") {
  root <- normalizePath(root, mustWork = TRUE)
  source(file.path(root, "scripts", "bridge.R"), local = environment())

  temp <- tempfile("bridge-tests-")
  dir.create(temp)
  on.exit(unlink(temp, recursive = TRUE, force = TRUE), add = TRUE)

  write_document <- function(name, yaml, body = character()) {
    path <- file.path(temp, name)
    writeLines(c("---", yaml, "---", body), path, useBytes = TRUE)
    path
  }

  skeleton <- write_document("expression-choices.Rmd", c(
    "params:", "  state:", "    value: AL", "    input: select",
    "    choices: !r state.abb"
  ))
  skeleton_inspection <- bridge_inspect(list(file = skeleton))
  stopifnot(identical(skeleton_inspection$hasExpressions, TRUE))

  fixture <- write_document("controls.Rmd", c(
    "title: Bridge controls",
    "output: md_document",
    "params:",
    "  numeric_alias:",
    "    label: Number alias",
    "    value: 4",
    "    input: number",
    "    min: 1",
    "    max: 9",
    "    step: 2",
    "    description: Pick a number",
    "  event_date:",
    "    value: !r as.Date('2024-02-03')",
    "    input: date",
    "  plain_text:",
    "    value: hello",
    "    placeholder: Type here",
    "  secret:",
    "    value: ''",
    "    input: password",
    "  region:",
    "    value: west",
    "    choices:",
    "      Western: west",
    "      Eastern: east",
    "  tags:",
    "    value: [one, two]",
    "    input: select",
    "    multiple: true",
    "    choices: [one, two, three]",
    "  enabled:",
    "    value: true",
    "  threshold:",
    "    value: 5",
    "    input: slider",
    "    min: 0",
    "    max: 10"
  ))

  inspection <- bridge_inspect(list(file = fixture))
  # Both expression defaults and nested expression choices require consent.
  stopifnot(identical(inspection$hasExpressions, TRUE))

  resolved <- bridge_resolve(list(file = fixture))
  stopifnot(identical(resolved$hasExpressions, TRUE), length(resolved$parameters) == 8L)
  schemas <- setNames(resolved$parameters, vapply(resolved$parameters, `[[`, character(1), "name"))
  stopifnot(
    identical(schemas$numeric_alias$type, "numeric"),
    identical(schemas$numeric_alias$min, 1L),
    identical(schemas$numeric_alias$max, 9L),
    identical(schemas$numeric_alias$step, 2L),
    identical(schemas$numeric_alias$description, "Pick a number"),
    identical(schemas$event_date$type, "date"),
    identical(schemas$event_date$value, "2024-02-03"),
    identical(schemas$plain_text$type, "text"),
    identical(schemas$plain_text$placeholder, "Type here"),
    identical(schemas$secret$type, "password"),
    identical(schemas$region$type, "select"),
    identical(schemas$region$choices[[1L]], list(label = "Western", value = "west")),
    identical(schemas$region$multiple, FALSE),
    identical(schemas$tags$multiple, TRUE),
    identical(unclass(schemas$tags$value), c("one", "two")),
    identical(schemas$enabled$type, "checkbox"),
    identical(schemas$threshold$type, "slider")
  )

  schema_json <- file.path(temp, "schema.json")
  bridge_write_json(resolved, schema_json)
  schema_roundtrip <- jsonlite::fromJSON(schema_json, simplifyVector = FALSE)
  stopifnot(length(schema_roundtrip$parameters) == 8L)

  override_request <- list(
    file = fixture,
    values = list(
      numeric_alias = list(value = 4),
      event_date = list(value = "2025-01-15"),
      plain_text = list(value = NULL),
      secret = list(value = ""),
      region = list(value = "east"),
      tags = list(value = list("three")),
      enabled = list(value = TRUE),
      threshold = list(value = 5)
    )
  )
  overrides <- bridge_overrides(override_request)
  stopifnot(
    identical(overrides$numeric_alias, 4),
    inherits(overrides$event_date, "Date"),
    identical(format(overrides$event_date), "2025-01-15"),
    "plain_text" %in% names(overrides),
    is.null(overrides$plain_text),
    identical(overrides$region, "east"),
    identical(overrides$tags, "three"),
    identical(overrides$enabled, TRUE),
    identical(overrides$threshold, 5)
  )
  missing_value <- tryCatch(
    bridge_overrides(list(file = fixture, values = list(numeric_alias = list()))),
    error = identity
  )
  stopifnot(inherits(missing_value, "error"))

  params_yaml <- file.path(temp, "params.yml")
  quarto_response <- bridge_write_quarto_params(c(override_request, list(outputParams = params_yaml)))
  yaml_text <- readLines(params_yaml, warn = FALSE)
  stopifnot(
    identical(quarto_response, list()),
    any(grepl("numeric_alias: 4", yaml_text, fixed = TRUE)),
    any(grepl("event_date: '2025-01-15'", yaml_text, fixed = TRUE)),
    any(grepl("enabled: yes", yaml_text, fixed = TRUE)),
    any(grepl("plain_text: ~", yaml_text, fixed = TRUE)),
    any(grepl("tags:", yaml_text, fixed = TRUE)),
    any(grepl("- three", yaml_text, fixed = TRUE))
  )

  render_fixture <- write_document("render.Rmd", c(
    "title: Render bridge",
    "output: md_document",
    "params:",
    "  day:",
    "    value: !r as.Date('2020-01-01')",
    "    input: date",
    "  optional:",
    "    value: fallback"
  ), c(
    "`r paste(class(params$day), format(params$day), sep = ':')`",
    "",
    "`r if (is.null(params$optional)) 'EXPLICIT_NULL' else params$optional`"
  ))
  render_result <- bridge_render_rmd(list(
    file = render_fixture,
    values = list(
      day = list(value = "2025-03-04"),
      optional = list(value = NULL)
    )
  ))
  stopifnot(file.exists(render_result$output))
  rendered <- paste(readLines(render_result$output, warn = FALSE), collapse = "\n")
  stopifnot(
    grepl("Date:2025-03-04", rendered, fixed = TRUE),
    grepl("EXPLICIT\\_NULL", rendered, fixed = TRUE)
  )

  file_fixture <- write_document("file-input.Rmd", c(
    "output: md_document", "params:", "  data:",
    "    label: 'Input dataset:'", "    value: results.csv", "    input: file"
  ), "`r read.csv(params$data)$value[1]`")
  file_schema <- bridge_resolve(list(file = file_fixture))$parameters[[1L]]
  stopifnot(identical(file_schema$type, "file"), identical(file_schema$value, "results.csv"))
  writeLines(c("value", "FILEINPUTOK"), file.path(temp, "selected data.csv"))
  file_request <- list(file = file_fixture, values = list(data = list(value = "selected data.csv")))
  stopifnot(identical(bridge_overrides(file_request)$data, "selected data.csv"))
  file_output <- bridge_render_rmd(file_request)$output
  stopifnot(any(grepl("FILEINPUTOK", readLines(file_output), fixed = TRUE)))
  file_yaml <- file.path(temp, "file-params.yml")
  bridge_write_quarto_params(c(file_request, list(outputParams = file_yaml)))
  stopifnot(identical(yaml::read_yaml(file_yaml)$data, "selected data.csv"))

  no_expr <- write_document("plain.Rmd", c("params:", "  value: 1"))
  stopifnot(identical(bridge_inspect(list(file = no_expr))$hasExpressions, FALSE))

  error_file <- file.path(temp, "error.json")
  secret <- "DO_NOT_ECHO_THIS_SECRET"
  captured <- tryCatch(
    bridge_dispatch("unknown-mode", list(file = fixture, values = list(password = list(value = secret)))),
    error = identity
  )
  stopifnot(inherits(captured, "error"), !grepl(secret, conditionMessage(captured), fixed = TRUE))

  invisible(TRUE)
}

`%||%` <- function(x, y) if (is.null(x)) y else x

if (sys.nframe() == 0L) {
  run_bridge_tests()
  cat("bridge tests passed\n")
}
