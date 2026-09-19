import {
  isMap,
  isScalar,
  isSeq,
  Node,
  parseDocument,
  ScalarTag,
  YAMLMap
} from 'yaml';
import type {Parameter} from './core';

const expressionTags: ScalarTag[] = ['python', 'r', 'expr'].map(name => ({
  tag: `!${name}`,
  resolve: source => source
}));
const expressionTagNames = new Set(expressionTags.map(tag => tag.tag));

interface MaterializationParameter extends Parameter {
  placeholder?: unknown;
  description?: unknown;
}

interface FrontMatter {
  opening: string;
  yaml: string;
  closingAndBody: string;
  lineEnding: '\n' | '\r\n';
}

interface NodeMetadata {
  anchor?: string;
  comment?: string | null;
  commentBefore?: string | null;
  spaceBefore?: boolean;
}

function frontMatter(source: string): FrontMatter | undefined {
  const opening = /^(?:\uFEFF)?---[ \t]*(\r\n|\n)/.exec(source);
  if (!opening) return undefined;

  const lineEnding = opening[1] as '\n' | '\r\n';
  const yamlStart = opening[0].length;
  const delimiter = /^(?:---|\.\.\.)[ \t]*(?:\r\n|\n|$)/gm;
  delimiter.lastIndex = yamlStart;

  let closing: RegExpExecArray | null;
  while ((closing = delimiter.exec(source)) !== null) {
    if (closing.index === yamlStart || source[closing.index - 1] === '\n') {
      return {
        opening: source.slice(0, yamlStart),
        yaml: source.slice(yamlStart, closing.index),
        closingAndBody: source.slice(closing.index),
        lineEnding
      };
    }
  }
  return undefined;
}

function mapPair(map: YAMLMap, key: string) {
  return map.items.find(item => isScalar(item.key) && item.key.value === key);
}

function isExpression(node: Node | null | undefined, tags = expressionTagNames): boolean {
  if (!node) return false;
  if (isScalar(node)) return typeof node.tag === 'string' && tags.has(node.tag);
  if (isSeq(node)) return node.items.some(item => isExpression(item as Node | null, tags));
  if (isMap(node)) {
    return node.items.some(pair =>
      isExpression(pair.key as Node | null, tags) ||
      isExpression(pair.value as Node | null, tags));
  }
  return false;
}

function copyNodeMetadata(original: Node, replacement: Node): void {
  const source = original as Node & NodeMetadata;
  const target = replacement as Node & NodeMetadata;
  if (source.anchor) target.anchor = source.anchor;
  if (source.comment != null) target.comment = source.comment;
  if (source.commentBefore != null) target.commentBefore = source.commentBefore;
  if (source.spaceBefore) target.spaceBefore = true;
}

function replacePairValue(doc: ReturnType<typeof parseDocument>, pair: YAMLMap['items'][number], value: unknown): void {
  const original = pair.value as Node | null | undefined;
  const replacement = doc.createNode(value) as Node;
  if (original) copyNodeMetadata(original, replacement);
  pair.value = replacement;
}

function render(source: string, front: FrontMatter, doc: ReturnType<typeof parseDocument>, changed: boolean): string {
  if (!changed) return source;
  const rendered = doc.toString().replace(/\n/g, front.lineEnding);
  return front.opening + rendered + front.closingAndBody;
}

function parsedFrontMatter(source: string) {
  const front = frontMatter(source);
  if (!front) return undefined;
  const doc = parseDocument(front.yaml, {customTags: expressionTags});
  if (doc.errors.length) {
    throw new Error(`Could not parse document front matter: ${doc.errors[0].message}`);
  }
  const params = doc.get('params', true);
  if (params != null && !isMap(params)) throw new Error("YAML field 'params' must be an object.");
  return {front, doc, params: params as YAMLMap | null | undefined};
}

/**
 * Replace evaluated !python parameter defaults in a QMD front matter block.
 * Other tagged values are parsed but never evaluated, and the document body is
 * copied byte-for-byte.
 */
export function materializePythonDefaults(
  source: string,
  values: Record<string, unknown>
): string {
  const parsed = parsedFrontMatter(source);
  if (!parsed || parsed.params == null) return source;
  const {front, doc, params} = parsed;
  const pythonTag = new Set(['!python']);

  let changed = false;
  for (const pair of params.items) {
    if (!isScalar(pair.key) || typeof pair.key.value !== 'string') continue;
    const name = pair.key.value;
    const param = pair.value as Node | null | undefined;
    const direct = param && isScalar(param) && isExpression(param, pythonTag);
    const valuePair = param && isMap(param) ? mapPair(param, 'value') : undefined;
    const nested = valuePair?.value && isScalar(valuePair.value) && isExpression(valuePair.value as Node, pythonTag);
    if (!direct && !nested) continue;
    if (!Object.prototype.hasOwnProperty.call(values, name)) {
      throw new Error(`Missing supplied Python result for parameter: ${name}`);
    }

    replacePairValue(doc, nested ? valuePair! : pair, values[name]);
    changed = true;
  }

  return render(source, front, doc, changed);
}

const metadataFields: Readonly<Record<string, keyof MaterializationParameter>> = {
  label: 'label',
  input: 'type',
  min: 'min',
  max: 'max',
  step: 'step',
  multiple: 'multiple',
  placeholder: 'placeholder',
  description: 'description'
};

function schemaChoices(parameter: MaterializationParameter, preserveMap: boolean): unknown {
  const choices = parameter.choices ?? [];
  const named = preserveMap || choices.some(choice => choice.label !== String(choice.value));
  if (!named) return choices.map(choice => choice.value);
  return Object.fromEntries(choices.map(choice => [choice.label, choice.value]));
}

/**
 * Replace parameter expressions with submitted defaults and resolved schema
 * metadata. Expressions are recognized through the YAML AST and never run.
 */
export function materializeParameterExpressions(
  source: string,
  values: Record<string, unknown>,
  schema: MaterializationParameter[]
): string {
  const parsed = parsedFrontMatter(source);
  if (!parsed || parsed.params == null) return source;
  const {front, doc, params} = parsed;
  let changed = false;

  for (const pair of params.items) {
    if (!isScalar(pair.key) || typeof pair.key.value !== 'string') continue;
    const name = pair.key.value;
    let param = pair.value as Node | null | undefined;
    if (!isExpression(param)) continue;

    const resolved = schema.find(item => item.name === name);
    if (!resolved) {
      throw new Error(`Missing resolved schema for parameter expression: ${name}`);
    }

    if (!isMap(param)) {
      if (!Object.prototype.hasOwnProperty.call(values, name)) {
        throw new Error(`Missing submitted value for parameter expression: ${name}`);
      }
      replacePairValue(doc, pair, values[name]);
      changed = true;
      continue;
    }

    const valuePair = mapPair(param, 'value');
    if (valuePair && isExpression(valuePair.value as Node | null | undefined)) {
      if (!Object.prototype.hasOwnProperty.call(values, name)) {
        throw new Error(`Missing submitted value for parameter expression: ${name}`);
      }
      replacePairValue(doc, valuePair, values[name]);
      changed = true;
    }

    const choicesPair = mapPair(param, 'choices');
    if (choicesPair && isExpression(choicesPair.value as Node | null | undefined)) {
      replacePairValue(doc, choicesPair, schemaChoices(resolved, isMap(choicesPair.value)));
      changed = true;
    }

    for (const [field, schemaField] of Object.entries(metadataFields)) {
      const metadataPair = mapPair(param, field);
      if (metadataPair && isExpression(metadataPair.value as Node | null | undefined)) {
        replacePairValue(doc, metadataPair, resolved[schemaField]);
        changed = true;
      }
    }

    for (const item of param.items) {
      if (!isExpression(item.key as Node | null) && !isExpression(item.value as Node | null)) continue;
      const field = isScalar(item.key) ? String(item.key.value) : '<non-scalar key>';
      throw new Error(`Unsupported parameter expression metadata for '${name}.${field}'.`);
    }
  }

  return render(source, front, doc, changed);
}
