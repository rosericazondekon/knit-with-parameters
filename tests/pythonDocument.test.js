const {test} = require('node:test');
const assert = require('node:assert/strict');
const {materializePythonDefaults} = require('../out/pythonDocument');

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
