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

  radio_file <- write_document("radio.qmd", c(
    "params:",
    "  style:", "    input: radioButtons", "    value: points", "    inline: true",
    "    choices:", "      Points: points", "      Boxplots: boxplot",
    "  flag:", "    input: radio", "    value: false",
    "    choices:", "      Enabled: true", "      Disabled: false",
    "  amount:", "    input: radiobuttons", "    value: 0", "    choices: [0, 1, 2]"
  ))
  radios <- bridge_resolve(list(file = radio_file))$parameters
  stopifnot(
    all(vapply(radios, function(x) identical(x$type, "radio"), logical(1))),
    identical(radios[[1L]]$inline, TRUE), identical(radios[[2L]]$inline, FALSE),
    identical(radios[[1L]]$choices[[2L]], list(label = "Boxplots", value = "boxplot")),
    identical(radios[[2L]]$value, FALSE), radios[[3L]]$value == 0
  )
  radio_yaml <- file.path(temp, "radio-params.yml")
  bridge_write_quarto_params(list(file = radio_file, outputParams = radio_yaml,
    values = list(style = list(value = "boxplot"), flag = list(value = FALSE), amount = list(value = 2))))
  radio_values <- yaml::read_yaml(radio_yaml)
  stopifnot(identical(radio_values$style, "boxplot"), identical(radio_values$flag, FALSE), radio_values$amount == 2)
  invalid_radio <- tryCatch(bridge_parameter_schema(list(name = "invalid", input = "radioButtons",
    value = c("a", "b"), choices = c("a", "b"))), error = identity)
  stopifnot(inherits(invalid_radio, "error"))

  skeleton <- write_document("expression-choices.Rmd", c(
    "params:", "  state:", "    value: AL", "    input: select",
    "    choices: !r state.abb"
  ))
  skeleton_inspection <- bridge_inspect(list(file = skeleton))
  stopifnot(identical(skeleton_inspection$hasExpressions, TRUE))
  state_schema <- bridge_resolve(list(file = skeleton))$parameters[[1L]]
  stopifnot(
    identical(state_schema$value, "AL"),
    length(state_schema$choices) == 50L,
    identical(vapply(state_schema$choices, `[[`, character(1), "label"), state.abb),
    identical(vapply(state_schema$choices, `[[`, character(1), "value"), state.abb)
  )
  choices_json <- file.path(temp, "choices.json")
  bridge_write_json(state_schema, choices_json)
  choices_roundtrip <- jsonlite::fromJSON(choices_json, simplifyVector = FALSE)$choices
  stopifnot(length(choices_roundtrip) == 50L,
            identical(choices_roundtrip[[1L]], list(label = "AL", value = "AL")))

  native_select <- write_document("native-select.Rmd", c(
    "params:", "  choice:", "    value: one", "    input: select",
    "    choices: [one, two]", "    selectize: false"
  ))
  native_schema <- bridge_resolve(list(file = native_select))$parameters[[1L]]
  stopifnot(identical(native_schema$selectize, FALSE), is.null(state_schema$selectize))
  bridge_write_json(native_schema, choices_json)
  stopifnot(identical(jsonlite::fromJSON(choices_json)$selectize, FALSE))

  named_choices <- write_document("named-expression-choices.qmd", c(
    "params:", "  state:", "    value: AL", "    input: select",
    "    choices: !r setNames(state.abb, state.name)"
  ))
  named_schema <- bridge_resolve(list(file = named_choices))$parameters[[1L]]
  stopifnot(
    identical(vapply(named_schema$choices, `[[`, character(1), "label"), state.name),
    identical(vapply(named_schema$choices, `[[`, character(1), "value"), state.abb)
  )
  nested_choices <- write_document("nested-expression-choices.Rmd", c(
    "params:", "  count:", "    value: 2", "    input: select",
    "    choices:", "      Two: !r 1 + 1", "      Three: 3"
  ))
  nested_schema <- bridge_resolve(list(file = nested_choices))$parameters[[1L]]
  stopifnot(identical(nested_schema$choices[[1L]], list(label = "Two", value = 2)))
  stopifnot(identical(bridge_choices(list(value = "AL", expr = "AK")),
    list(list(label = "value", value = "AL"), list(label = "expr", value = "AK"))))

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
    "    max: 10",
    "    ticks: false",
    "    sep: ''",
    "    pre: '$'",
    "    post: ' USD'"
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
    identical(schemas$threshold$type, "slider"),
    identical(schemas$threshold$ticks, FALSE),
    identical(schemas$threshold$sep, ""),
    identical(schemas$threshold$pre, "$"),
    identical(schemas$threshold$post, " USD")
  )

  schema_json <- file.path(temp, "schema.json")
  bridge_write_json(resolved, schema_json)
  schema_roundtrip <- jsonlite::fromJSON(schema_json, simplifyVector = FALSE)
  stopifnot(length(schema_roundtrip$parameters) == 8L)
  slider_roundtrip <- schema_roundtrip$parameters[[8L]]
  stopifnot(
    identical(slider_roundtrip$ticks, FALSE),
    identical(slider_roundtrip$sep, ""),
    identical(slider_roundtrip$pre, "$"),
    identical(slider_roundtrip$post, " USD")
  )

  slider_fixture <- write_document("slider-display.qmd", c(
    "params:",
    "  formatted:", "    value: 1000", "    input: slider",
    "    min: 0", "    max: 5000",
    "    ticks: true", "    sep: ','", "    pre: ''", "    post: ''",
    "  plain:", "    value: 5", "    input: slider",
    "    min: 0", "    max: 10"
  ))
  slider_schemas <- bridge_resolve(list(file = slider_fixture))$parameters
  display_fields <- c("ticks", "sep", "pre", "post")
  stopifnot(
    identical(slider_schemas[[1L]][display_fields],
      list(ticks = TRUE, sep = ",", pre = "", post = "")),
    all(vapply(slider_schemas[[2L]][display_fields], is.null, logical(1)))
  )
  slider_json <- file.path(temp, "slider-display.json")
  bridge_write_json(slider_schemas, slider_json)
  slider_display_roundtrip <- jsonlite::fromJSON(slider_json, simplifyVector = FALSE)
  stopifnot(
    identical(slider_display_roundtrip[[1L]][display_fields],
      list(ticks = TRUE, sep = ",", pre = "", post = "")),
    all(vapply(slider_display_roundtrip[[2L]][display_fields], is.null, logical(1)))
  )

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
    any(grepl("enabled: true", yaml_text, fixed = TRUE)),
    any(grepl("plain_text: ~", yaml_text, fixed = TRUE)),
    any(grepl("tags:", yaml_text, fixed = TRUE)),
    any(grepl("- three", yaml_text, fixed = TRUE))
  )

  boolean_fixture <- write_document("booleans.Rmd", c(
    "output: md_document", "params:",
    "  checked:", "    value: false", "    input: checkbox",
    "  unchecked:", "    value: true", "    input: checkbox"
  ), c(
    "`r paste(typeof(params$checked), params$checked, sep = ':')`",
    "",
    "`r paste(typeof(params$unchecked), params$unchecked, sep = ':')`"
  ))
  boolean_request <- list(file = boolean_fixture, values = list(
    checked = list(value = TRUE), unchecked = list(value = FALSE)
  ))
  boolean_json <- file.path(temp, "booleans.json")
  bridge_write_json(boolean_request, boolean_json)
  boolean_request <- jsonlite::fromJSON(boolean_json, simplifyVector = FALSE)
  stopifnot(identical(bridge_overrides(boolean_request), list(checked = TRUE, unchecked = FALSE)))
  bridge_write_quarto_params(c(boolean_request, list(outputParams = params_yaml)))
  stopifnot(
    identical(yaml::read_yaml(params_yaml), list(checked = TRUE, unchecked = FALSE)),
    any(grepl("checked: true", readLines(params_yaml), fixed = TRUE)),
    any(grepl("unchecked: false", readLines(params_yaml), fixed = TRUE))
  )
  boolean_render <- bridge_render_rmd(boolean_request)
  boolean_text <- paste(readLines(boolean_render$output, warn = FALSE), collapse = "\n")
  stopifnot(grepl("logical:TRUE", boolean_text, fixed = TRUE),
    grepl("logical:FALSE", boolean_text, fixed = TRUE))

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

  python_side_effect <- file.path(temp, "python-inspect-side-effect")
  r_side_effect <- file.path(temp, "r-inspect-side-effect")
  python_fixture <- write_document("python-params.Rmd", c(
    "params:",
    paste0("  r_default: !r file.create('", r_side_effect, "')"),
    paste0("  direct: !python open('", python_side_effect, "', 'w').write('ran')"),
    "  day: {value: !python \"make_day(2025, 4, 6)\", input: date}",
    "  items:",
    "    value: !python '[first, second]'",
    "    input: select",
    "    multiple: true",
    "  optional: !python None"
  ))
  python_inspection <- bridge_inspect(list(file = python_fixture))
  stopifnot(
    identical(python_inspection$hasExpressions, TRUE),
    identical(python_inspection$hasRExpressions, TRUE),
    identical(names(python_inspection$pythonExpressions), c("direct", "day", "items", "optional")),
    identical(
      python_inspection$pythonExpressions$direct,
      paste0("open('", python_side_effect, "', 'w').write('ran')")
    ),
    identical(python_inspection$pythonExpressions$day, "make_day(2025, 4, 6)"),
    identical(python_inspection$pythonExpressions$items, "[first, second]"),
    identical(python_inspection$pythonExpressions$optional, "None"),
    !file.exists(r_side_effect),
    !file.exists(python_side_effect)
  )

  inspected_params <- bridge_params(python_fixture, evaluate = FALSE)
  stopifnot(
    is.null(inspected_params$direct$value),
    is.null(inspected_params$day$value),
    identical(inspected_params$day$input, "date"),
    !file.exists(r_side_effect),
    !file.exists(python_side_effect)
  )

  python_values <- list(
    direct = 7L,
    day = "2025-04-06",
    items = list("alpha", "beta"),
    optional = NULL
  )
  python_resolved <- bridge_resolve(list(file = python_fixture, pythonValues = python_values))
  python_schemas <- setNames(
    python_resolved$parameters,
    vapply(python_resolved$parameters, `[[`, character(1), "name")
  )
  stopifnot(
    identical(python_resolved$hasExpressions, TRUE),
    identical(python_resolved$hasRExpressions, TRUE),
    identical(python_resolved$pythonExpressions, python_inspection$pythonExpressions),
    identical(python_schemas$r_default$value, TRUE),
    identical(python_schemas$direct$value, 7L),
    identical(python_schemas$day$type, "date"),
    identical(python_schemas$day$value, "2025-04-06"),
    identical(unclass(python_schemas$items$value), list("alpha", "beta")),
    is.null(python_schemas$optional$value),
    file.exists(r_side_effect),
    !file.exists(python_side_effect)
  )
  unlink(r_side_effect)

  missing_python <- tryCatch(
    bridge_resolve(list(
      file = python_fixture,
      pythonValues = python_values[setdiff(names(python_values), "optional")]
    )),
    error = identity
  )
  stopifnot(
    inherits(missing_python, "error"),
    grepl("Missing supplied Python result for parameter: optional", conditionMessage(missing_python), fixed = TRUE)
  )

  bad_python_locations <- list(
    write_document("python-title.Rmd", c("title: !python make_title()", "params:", "  value: 1")),
    write_document("python-choice.Rmd", c(
      "params:", "  value:", "    value: one", "    choices: [!python make_choices()]"
    )),
    write_document("python-nested-default.Rmd", c(
      "params:", "  value:", "    value: [!python nested()]"
    ))
  )
  for (bad_python in bad_python_locations) {
    location_error <- tryCatch(bridge_inspect(list(file = bad_python)), error = identity)
    stopifnot(
      inherits(location_error, "error"),
      grepl("!python is only permitted as a parameter default", conditionMessage(location_error), fixed = TRUE)
    )
  }

  python_only <- write_document("python-only.qmd", c("params:", "  value: !python 40 + 2"))
  python_only_inspection <- bridge_inspect(list(file = python_only))
  stopifnot(
    identical(python_only_inspection$hasExpressions, TRUE),
    identical(python_only_inspection$hasRExpressions, FALSE),
    identical(python_only_inspection$pythonExpressions, list(value = "40 + 2"))
  )

  date_fixture <- write_document("python-start-date.qmd", c(
    "params:", "  start_date:", "    value: !python date.today() - timedelta(days=30)", "    input: date"
  ))
  date_request <- file.path(temp, "date-request.json")
  date_response <- file.path(temp, "date-response.json")
  bridge_write_json(list(file = date_fixture, pythonValues = list(start_date = "2026-08-20")), date_request)
  date_run <- system2(file.path(R.home("bin"), "Rscript"),
    shQuote(c(file.path(root, "scripts", "bridge.R"), "resolve", date_request, date_response)),
    stdout = TRUE, stderr = TRUE)
  stopifnot(is.null(attr(date_run, "status")))
  date_result <- jsonlite::fromJSON(date_response, simplifyVector = FALSE)
  stopifnot(identical(date_result$parameters[[1L]]$name, "start_date"),
            identical(date_result$parameters[[1L]]$value, "2026-08-20"))
  stale_host <- tryCatch(bridge_resolve(list(file = date_fixture)), error = identity)
  stopifnot(inherits(stale_host, "error"),
            grepl("Reload the editor window", conditionMessage(stale_host), fixed = TRUE))

  no_expr <- write_document("plain.Rmd", c("params:", "  value: 1"))
  plain_inspection <- bridge_inspect(list(file = no_expr))
  stopifnot(
    identical(plain_inspection$hasExpressions, FALSE),
    identical(plain_inspection$hasRExpressions, FALSE),
    identical(plain_inspection$pythonExpressions, setNames(list(), character()))
  )
  empty_json <- file.path(temp, "empty-python-expressions.json")
  bridge_write_json(plain_inspection, empty_json)
  stopifnot(any(grepl('"pythonExpressions": {}', readLines(empty_json), fixed = TRUE)))

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
