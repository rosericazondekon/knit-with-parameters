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

bridge_params <- function(file, evaluate) {
  bridge_require("knitr")
  knitr::knit_params(bridge_read_lines(file), evaluate = evaluate)
}

bridge_scalar <- function(x, default = NULL) {
  if (is.null(x) || length(x) == 0L) return(default)
  x[[1L]]
}

bridge_input_type <- function(param) {
  input <- tolower(as.character(bridge_scalar(param$input, "")))
  if (identical(input, "number")) input <- "numeric"
  supported <- c("numeric", "date", "text", "password", "select", "checkbox", "slider")
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

bridge_choices <- function(choices) {
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
    placeholder = bridge_scalar(param$placeholder),
    description = bridge_scalar(param$description)
  )
}

bridge_inspect <- function(request) {
  params <- bridge_params(request$file, evaluate = FALSE)
  list(hasExpressions = bridge_has_expressions(params))
}

bridge_resolve <- function(request) {
  params <- bridge_params(request$file, evaluate = TRUE)
  raw_params <- bridge_params(request$file, evaluate = FALSE)
  list(
    parameters = unname(lapply(params, bridge_parameter_schema)),
    hasExpressions = bridge_has_expressions(raw_params)
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
    if (!is.list(selection) || is.null(selection$useDefault) || length(selection$useDefault) != 1L) {
      stop("Parameter '", name, "' must specify useDefault.", call. = FALSE)
    }
    if (isTRUE(selection$useDefault)) next
    if (!"value" %in% names(selection)) {
      stop("Parameter '", name, "' must specify value when useDefault is false.", call. = FALSE)
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
