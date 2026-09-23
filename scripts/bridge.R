#!/usr/bin/env Rscript

bridge_require <- function(package) {
  if (!requireNamespace(package, quietly = TRUE)) {
    stop("Required R package is not installed: ", package, call. = FALSE)
  }
}

bridge_read_lines <- function(file) {
  if (!is.character(file) || length(file) != 1L || is.na(file) || !nzchar(file)) {
    stop("Request field 'file' must be a non-empty string.", call. = FALSE)
  }
  readLines(normalizePath(file, mustWork = TRUE), warn = FALSE, encoding = "UTF-8")
}

bridge_has_expressions <- function(x) {
  if (inherits(x, "knit_param_expr")) return(TRUE)
  if (!is.list(x) || length(x) == 0L) return(FALSE)
  if (!is.null(x$expr)) return(TRUE)
  any(vapply(x, bridge_has_expressions, logical(1)))
}

bridge_python_expr <- function(source) {
  if (!is.character(source) || length(source) != 1L || is.na(source)) {
    stop("!python expressions must be YAML scalar text; quote expressions that use YAML collection syntax.", call. = FALSE)
  }
  structure(list(source = source), class = "bridge_python_expr")
}

bridge_front_matter <- function(lines) {
  # Use knitr's parser when possible, but retain a delimiter-based fallback for
  # knitr versions whose helper declines otherwise valid front matter.
  yaml <- getFromNamespace("yaml_front_matter", "knitr")(lines)
  if (!is.null(yaml)) return(yaml)

  delimiters <- grep("^(---|\\.\\.\\.)\\s*$", lines)
  if (length(delimiters) < 2L) return(NULL)
  first <- delimiters[[1L]]
  second <- delimiters[[2L]]
  if (!identical(trimws(lines[[first]]), "---") || second <= first + 1L) return(NULL)
  if (first > 1L && any(nzchar(trimws(lines[seq_len(first - 1L)])))) return(NULL)
  paste(lines[(first + 1L):(second - 1L)], collapse = "\n")
}

bridge_python_locations <- function(value, path = character()) {
  if (inherits(value, "bridge_python_expr")) {
    return(list(list(path = path, source = value$source)))
  }
  if (!is.list(value) || length(value) == 0L) return(list())

  labels <- names(value)
  if (is.null(labels)) labels <- rep("", length(value))
  result <- list()
  for (i in seq_along(value)) {
    label <- labels[[i]]
    if (is.na(label) || !nzchar(label)) label <- paste0("[", i, "]")
    result <- c(result, bridge_python_locations(value[[i]], c(path, label)))
  }
  result
}

bridge_parse_params <- function(file, evaluate, python_values = NULL) {
  bridge_require("knitr")
  bridge_require("yaml")
  yaml_text <- bridge_front_matter(bridge_read_lines(file))
  if (is.null(yaml_text)) {
    return(list(params = list(), pythonExpressions = setNames(list(), character()), hasRExpressions = FALSE))
  }

  handlers <- getFromNamespace("knit_params_handlers", "knitr")(evaluate = evaluate)
  handlers$python <- bridge_python_expr
  document <- yaml::yaml.load(yaml_text, handlers = handlers, eval.expr = FALSE)
  if (is.null(document)) document <- list()
  if (!is.list(document)) stop("Document front matter must be a YAML object.", call. = FALSE)

  locations <- bridge_python_locations(document)
  python_expressions <- setNames(list(), character())
  for (location in locations) {
    path <- location$path
    allowed <- length(path) %in% c(2L, 3L) && length(path) >= 2L &&
      identical(path[[1L]], "params") &&
      (length(path) == 2L || identical(path[[3L]], "value"))
    if (!allowed) {
      rendered_path <- if (length(path)) paste(path, collapse = ".") else "<front matter>"
      stop(
        "!python is only permitted as a parameter default (params.<name> or params.<name>.value); found it at ",
        rendered_path, ".", call. = FALSE
      )
    }
    name <- path[[2L]]
    python_expressions[name] <- list(location$source)
  }

  raw_params <- document$params
  if (is.null(raw_params)) raw_params <- list()
  if (!is.list(raw_params)) stop("YAML field 'params' must be an object.", call. = FALSE)
  has_r_expressions <- bridge_has_expressions(raw_params)

  if (length(python_expressions)) {
    if (evaluate) {
      if (is.null(python_values)) python_values <- list()
      if (!is.list(python_values) || (length(python_values) && is.null(names(python_values)))) {
        stop("Request field 'pythonValues' must be an object.", call. = FALSE)
      }
      missing <- setdiff(names(python_expressions), names(python_values))
      if (length(missing)) {
        stop(
          "Missing supplied Python result for parameter: ", paste(missing, collapse = ", "),
          ". The extension host did not supply the evaluated defaults. Reload the editor window, ",
          "reopen Parameters, and approve expression evaluation. If this persists, reinstall the latest extension build.",
          call. = FALSE
        )
      }
    }

    for (name in names(python_expressions)) {
      param <- raw_params[[name]]
      replacement <- if (evaluate) python_values[[name]] else NULL
      if (inherits(param, "bridge_python_expr")) param <- list()
      param["value"] <- list(replacement)
      raw_params[name] <- list(param)
    }
  }

  params <- getFromNamespace("resolve_params", "knitr")(raw_params, evaluate = evaluate)
  list(
    params = params,
    pythonExpressions = python_expressions,
    hasRExpressions = has_r_expressions
  )
}

bridge_params <- function(file, evaluate, python_values = NULL) {
  parsed <- bridge_parse_params(file, evaluate, python_values)
  params <- parsed$params
  attr(params, "pythonExpressions") <- parsed$pythonExpressions
  attr(params, "hasRExpressions") <- parsed$hasRExpressions
  params
}

bridge_scalar <- function(x, default = NULL) {
  if (is.null(x) || length(x) == 0L) return(default)
  x[[1L]]
}

bridge_input_type <- function(param) {
  input <- tolower(as.character(bridge_scalar(param$input, "")))
  if (identical(input, "number")) input <- "numeric"
  supported <- c("numeric", "date", "text", "password", "select", "checkbox", "slider", "file")
  if (input %in% supported) return(input)
  if (nzchar(input)) stop("Unsupported parameter input type: ", input, call. = FALSE)

  value <- param$value
  if (!is.null(param$choices)) return("select")
  if (inherits(value, "Date")) return("date")
  if (is.logical(value) && length(value) == 1L) return("checkbox")
  if (is.numeric(value)) return("numeric")
  "text"
}

bridge_json_value <- function(value, multiple = FALSE) {
  if (inherits(value, "Date")) value <- format(value, "%Y-%m-%d")
  if (multiple && !is.null(value)) return(I(unname(as.vector(value))))
  if (length(value) > 1L) return(I(unname(as.vector(value))))
  value
}

bridge_choice_value <- function(value) {
  # knitr retains expression metadata for choices even after evaluating them.
  if (inherits(value, "knit_param_expr")) return(bridge_choice_value(value$value))
  if (is.list(value)) return(lapply(value, bridge_choice_value))
  value
}

bridge_choices <- function(choices) {
  choices <- bridge_choice_value(choices)
  if (is.null(choices)) return(list())
  if (is.factor(choices)) choices <- as.character(choices)
  if (!is.list(choices)) choices <- as.list(choices)
  labels <- names(choices)
  if (is.null(labels)) labels <- rep("", length(choices))

  lapply(seq_along(choices), function(i) {
    value <- choices[[i]]
    if (inherits(value, "Date")) value <- format(value, "%Y-%m-%d")
    label <- labels[[i]]
    if (is.null(label) || is.na(label) || !nzchar(label)) {
      label <- if (is.null(value)) "" else paste(as.character(value), collapse = ", ")
    }
    list(label = label, value = bridge_json_value(value, length(value) > 1L))
  })
}

bridge_parameter_schema <- function(param) {
  name <- as.character(bridge_scalar(param$name, ""))
  type <- bridge_input_type(param)
  value <- param$value
  multiple <- isTRUE(param$multiple) || length(value) > 1L
  label <- bridge_scalar(param$label, name)

  list(
    name = name,
    label = as.character(label),
    type = type,
    value = bridge_json_value(value, multiple),
    choices = bridge_choices(param$choices),
    multiple = multiple,
    min = bridge_json_value(param$min),
    max = bridge_json_value(param$max),
    step = bridge_json_value(param$step),
    ticks = bridge_scalar(param$ticks),
    sep = bridge_scalar(param$sep),
    pre = bridge_scalar(param$pre),
    post = bridge_scalar(param$post),
    placeholder = bridge_scalar(param$placeholder),
    description = bridge_scalar(param$description)
  )
}

bridge_inspect <- function(request) {
  parsed <- bridge_parse_params(request$file, evaluate = FALSE)
  has_python <- length(parsed$pythonExpressions) > 0L
  list(
    hasExpressions = parsed$hasRExpressions || has_python,
    hasRExpressions = parsed$hasRExpressions,
    pythonExpressions = parsed$pythonExpressions
  )
}

bridge_resolve <- function(request) {
  raw <- bridge_parse_params(request$file, evaluate = FALSE)
  resolved <- bridge_parse_params(
    request$file,
    evaluate = TRUE,
    python_values = request$pythonValues
  )
  has_python <- length(raw$pythonExpressions) > 0L
  list(
    parameters = unname(lapply(resolved$params, bridge_parameter_schema)),
    hasExpressions = raw$hasRExpressions || has_python,
    hasRExpressions = raw$hasRExpressions,
    pythonExpressions = raw$pythonExpressions
  )
}

bridge_request_values <- function(request) {
  values <- request$values
  if (is.null(values)) return(list())
  if (!is.list(values) || is.null(names(values))) {
    stop("Request field 'values' must be an object.", call. = FALSE)
  }
  values
}

bridge_is_date_param <- function(param) {
  input <- tolower(as.character(bridge_scalar(param$input, "")))
  if (identical(input, "date") || inherits(param$value, "Date")) return(TRUE)
  expr <- bridge_scalar(param$expr, "")
  is.character(expr) && grepl("(^|[^[:alnum:]_.])as\\.Date\\s*\\(", expr)
}

bridge_override_value <- function(value, param) {
  if (is.null(value)) return(NULL)
  multiple <- isTRUE(param$multiple) || length(param$value) > 1L
  if (is.list(value)) {
    if (multiple) {
      value <- if (length(value) == 0L) character() else unlist(value, recursive = TRUE, use.names = FALSE)
    } else if (length(value) == 1L) {
      value <- value[[1L]]
    } else {
      value <- unlist(value, recursive = TRUE, use.names = FALSE)
    }
  }
  if (bridge_is_date_param(param)) {
    if (length(value) != 1L) stop("Date parameter override must be scalar.", call. = FALSE)
    return(as.Date(as.character(value)))
  }
  value
}

bridge_overrides <- function(request) {
  definitions <- bridge_params(request$file, evaluate = FALSE)
  submitted <- bridge_request_values(request)
  unknown <- setdiff(names(submitted), names(definitions))
  if (length(unknown)) {
    stop("Unknown parameter: ", paste(unknown, collapse = ", "), call. = FALSE)
  }

  result <- list()
  for (name in names(submitted)) {
    selection <- submitted[[name]]
    if (!is.list(selection) || !"value" %in% names(selection)) {
      stop("Parameter '", name, "' must specify value.", call. = FALSE)
    }
    value <- bridge_override_value(selection$value, definitions[[name]])
    result[name] <- list(value)
  }
  result
}

bridge_render_rmd <- function(request) {
  bridge_require("rmarkdown")
  file <- normalizePath(request$file, mustWork = TRUE)
  if (!identical(tolower(tools::file_ext(file)), "rmd")) {
    stop("render-rmd requires an .Rmd file.", call. = FALSE)
  }
  output <- rmarkdown::render(
    input = file,
    params = bridge_overrides(request),
    envir = new.env(parent = globalenv()),
    encoding = "UTF-8",
    quiet = TRUE
  )
  list(output = normalizePath(output, mustWork = FALSE))
}

bridge_yaml_values <- function(request, values) {
  definitions <- bridge_params(request$file, evaluate = FALSE)
  result <- values
  for (name in names(values)) {
    value <- values[[name]]
    param <- definitions[[name]]
    multiple <- isTRUE(param$multiple) || length(param$value) > 1L
    if (inherits(value, "Date")) value <- format(value, "%Y-%m-%d")
    if (multiple && !is.null(value) && !is.list(value)) value <- as.list(unname(value))
    result[name] <- list(value)
  }
  result
}

bridge_write_quarto_params <- function(request) {
  bridge_require("yaml")
  output <- request$outputParams
  if (!is.character(output) || length(output) != 1L || is.na(output) || !nzchar(output)) {
    stop("write-quarto-params requires a non-empty outputParams path.", call. = FALSE)
  }
  parent <- dirname(path.expand(output))
  if (!dir.exists(parent)) stop("outputParams directory does not exist.", call. = FALSE)
  values <- bridge_overrides(request)
  yaml::write_yaml(bridge_yaml_values(request, values), path.expand(output))
  list()
}

bridge_dispatch <- function(mode, request) {
  switch(
    mode,
    inspect = bridge_inspect(request),
    resolve = bridge_resolve(request),
    `render-rmd` = bridge_render_rmd(request),
    `write-quarto-params` = bridge_write_quarto_params(request),
    stop("Unknown bridge mode: ", mode, call. = FALSE)
  )
}

bridge_write_json <- function(value, path) {
  bridge_require("jsonlite")
  jsonlite::write_json(
    value,
    path = path,
    auto_unbox = TRUE,
    null = "null",
    na = "null",
    pretty = TRUE,
    digits = NA
  )
}

bridge_main <- function(args = commandArgs(trailingOnly = TRUE)) {
  response_path <- if (length(args) >= 3L) args[[3L]] else NULL
  status <- tryCatch({
    if (length(args) != 3L) {
      stop("Usage: bridge.R <mode> <request.json> <response.json>", call. = FALSE)
    }
    bridge_require("jsonlite")
    request <- jsonlite::fromJSON(args[[2L]], simplifyVector = FALSE)
    if (!is.list(request)) stop("Request JSON must contain an object.", call. = FALSE)
    bridge_write_json(bridge_dispatch(args[[1L]], request), response_path)
    0L
  }, error = function(error) {
    if (!is.null(response_path) && nzchar(response_path)) {
      try(bridge_write_json(list(error = conditionMessage(error)), response_path), silent = TRUE)
    }
    1L
  })
  if (status != 0L) quit(save = "no", status = status, runLast = FALSE)
  invisible(status)
}

if (sys.nframe() == 0L) bridge_main()
