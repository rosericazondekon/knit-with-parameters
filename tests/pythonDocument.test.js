const {test} = require('node:test');
const assert = require('node:assert/strict');
const {
  materializeParameterExpressions,
  materializePythonDefaults
} = require('../out/pythonDocument');

function frontMatter(text) {
  const match = /^(?:\uFEFF)?---[^\r\n]*(?:\r\n|\n)([\s\S]*?)^(?:---|\.\.\.)[^\r\n]*(?:\r\n|\n|$)/m.exec(text);
  return match && match[1];
}

test('materializes direct and nested Python defaults while preserving metadata and body', () => {
  const body = '## Body\n\n```{python}\nprint("!python remains body text")\n```\n';
  const source = `---
title: Python parameters
params:
  start: !python "date(2025, 1, 2)"
  states:
    value: !python "['CA', 'NY']" # evaluated
    label: States
    input: select
    choices: !r state.abb
  enabled:
    value: true
    label: Enabled
format: html
---
${body}`;

  const result = materializePythonDefaults(source, {
    start: '2025-01-02',
    states: ['CA', 'NY']
  });
  const yaml = frontMatter(result);
  assert.match(yaml, /start: 2025-01-02/);
  assert.match(yaml, /value:\n\s+- CA\n\s+- NY\s+# evaluated/);
  assert.match(yaml, /label: States/);
  assert.match(yaml, /input: select/);
  assert.match(yaml, /choices: !r state\.abb/);
  assert.equal(result.slice(result.indexOf('## Body')), body);
});

test('materializes strings, numbers, booleans, lists and null without evaluating tags', () => {
  const source = `---
params:
  text: !python source_text
  count: !python source_count
  active: !python source_active
  items: !python source_items
  empty: !python source_empty
other: !expr dangerous_call()
---
body
`;
  const result = materializePythonDefaults(source, {
    text: '!python literal', count: 3.5, active: false,
    items: [1, 'two', null], empty: null
  });
  const yaml = frontMatter(result);
  assert.match(yaml, /text: "!python literal"/);
  assert.match(yaml, /count: 3\.5/);
  assert.match(yaml, /active: false/);
  assert.match(yaml, /items:\n\s+- 1\n\s+- two\n\s+- null/);
  assert.match(yaml, /empty: null/);
  assert.match(yaml, /other: !expr dangerous_call\(\)/);
});

test('does not mistake literal !python strings or unrelated tags for defaults', () => {
  const source = `---
title: "!python literal"
params:
  literal: "!python not_a_tag"
  states:
    value: Alabama
    choices: !r state.abb
---
Body !python text
`;
  assert.equal(materializePythonDefaults(source, {literal: 'changed'}), source);
});

test('requires an own supplied value for every Python parameter', () => {
  const source = '---\nparams:\n  answer: !python 6 * 7\n---\nbody\n';
  assert.throws(() => materializePythonDefaults(source, {}), /Missing supplied Python result for parameter: answer/);
  assert.throws(() => materializePythonDefaults(source, Object.create({answer: 42})), /Missing supplied Python result/);
});

test('preserves CRLF body and supports document end marker', () => {
  const body = 'First\r\n---\r\nSecond\r\n';
  const source = '---\r\nparams:\r\n  when: !python today()\r\n...\r\n' + body;
  const result = materializePythonDefaults(source, {when: '2025-09-19'});
  assert.ok(!result.includes('\n') || !result.replaceAll('\r\n', '').includes('\n'));
  assert.equal(result.slice(result.indexOf('First')), body);
  assert.match(result, /when: 2025-09-19/);
});

test('returns documents without front matter unchanged and reports malformed YAML clearly', () => {
  const plain = '# Heading\n\n!python literal\n';
  assert.equal(materializePythonDefaults(plain, {x: 1}), plain);
  assert.throws(
    () => materializePythonDefaults('---\nparams: [\n---\nbody\n', {}),
    /Could not parse document front matter/
  );
});

test('preserves an anchor attached to a replaced Python scalar', () => {
  const source = '---\nparams:\n  first: &default !python 1 + 1\n  second: *default\n---\nbody\n';
  const result = materializePythonDefaults(source, {first: 2});
  assert.match(result, /first: &default 2/);
  assert.match(result, /second: \*default/);
});

function parameter(name, overrides = {}) {
  return {
    name, label: name, type: 'text', value: null, choices: [], multiple: false,
    ...overrides
  };
}

test('materializes R date and state expressions from submitted values and resolved schema', () => {
  const body = '# Body\n\nOriginal !r input remains here.\n';
  const source = `---
title: Static title
params:
  report_date:
    value: !r Sys.Date()
    label: !r paste("Report", "date")
    input: !r "date"
    min: !expr as.Date("2025-01-01")
    max: !r as.Date("2025-12-31")
    step: !r 1
    multiple: !r FALSE
    placeholder: !r "YYYY-MM-DD"
    description: !r "Reporting date"
    static-note: retained
  state:
    value: !expr state.abb[[1]]
    choices: !r state.abb
    input: select
format: html
---
${body}`;
  const originalSource = source;
  const states = Array.from({length: 50}, (_, index) => {
    const value = `S${String(index + 1).padStart(2, '0')}`;
    return {label: value, value};
  });
  const result = materializeParameterExpressions(source, {
    report_date: '2025-06-15', state: 'S05'
  }, [
    parameter('report_date', {
      label: 'Report date', type: 'date', value: '2025-06-15',
      min: '2025-01-01', max: '2025-12-31', step: 1,
      placeholder: 'YYYY-MM-DD', description: 'Reporting date'
    }),
    parameter('state', {type: 'select', value: 'S05', choices: states})
  ]);
  const yaml = frontMatter(result);
  assert.match(yaml, /value: 2025-06-15/);
  assert.match(yaml, /label: Report date/);
  assert.match(yaml, /input: date/);
  assert.match(yaml, /min: 2025-01-01/);
  assert.match(yaml, /max: 2025-12-31/);
  assert.match(yaml, /step: 1/);
  assert.match(yaml, /multiple: false/);
  assert.match(yaml, /placeholder: YYYY-MM-DD/);
  assert.match(yaml, /description: Reporting date/);
  assert.match(yaml, /static-note: retained/);
  assert.match(yaml, /choices:\n\s+- S01[\s\S]*- S50/);
  assert.match(yaml, /title: Static title/);
  assert.match(yaml, /format: html/);
  assert.equal(result.slice(result.indexOf('# Body')), body);
  assert.equal(source, originalSource);
});

test('preserves named choices and replaces choices containing nested expressions', () => {
  const source = `---
params:
  named:
    value: A
    choices: !r c(First = "A", Second = "B")
  nested:
    value: x
    choices:
      Group:
        - x
        - !expr make_choice()
---
body
`;
  const result = materializeParameterExpressions(source, {}, [
    parameter('named', {type: 'select', choices: [
      {label: 'First', value: 'A'}, {label: 'Second', value: 'B'}
    ]}),
    parameter('nested', {type: 'select', choices: [
      {label: 'x', value: 'x'}, {label: 'y', value: 'y'}
    ]})
  ]);
  const yaml = frontMatter(result);
  assert.match(yaml, /choices:\n\s+First: A\n\s+Second: B/);
  assert.match(yaml, /nested:[\s\S]*choices:\n\s+x: x\n\s+y: y/);
  assert.doesNotMatch(yaml, /!(?:r|expr)/);
});

test('materializes mixed Python, R and expr defaults including expressions nested in arrays', () => {
  const source = `---
params:
  python: !python make_python()
  r: !r make_r()
  expr:
    value: !expr make_expr()
  array:
    value:
      - static
      - !r make_nested()
other: !r unrelated()
---
body
`;
  const result = materializeParameterExpressions(source, {
    python: 1, r: 2, expr: 3, array: ['resolved', 'whole-array']
  }, ['python', 'r', 'expr', 'array'].map(name => parameter(name)));
  const yaml = frontMatter(result);
  assert.match(yaml, /python: 1/);
  assert.match(yaml, /r: 2/);
  assert.match(yaml, /expr:\n\s+value: 3/);
  assert.match(yaml, /array:\n\s+value:\n\s+- resolved\n\s+- whole-array/);
  assert.match(yaml, /other: !r unrelated\(\)/);
});

test('reports missing schema and unsupported expression metadata clearly', () => {
  assert.throws(
    () => materializeParameterExpressions('---\nparams:\n  x: !r make_x()\n---\n', {x: 1}, []),
    /Missing resolved schema for parameter expression: x/
  );
  assert.throws(
    () => materializeParameterExpressions(
      '---\nparams:\n  x:\n    value: 1\n    custom: !r make_custom()\n---\n', {}, [parameter('x')]
    ),
    /Unsupported parameter expression metadata for 'x\.custom'/
  );
});
