import {
  isMap,
  isScalar,
  Node,
  parseDocument,
  ScalarTag,
  YAMLMap
} from 'yaml';

const expressionTags: ScalarTag[] = ['python', 'r', 'expr'].map(name => ({
  tag: `!${name}`,
  resolve: source => source
}));

interface FrontMatter {
  opening: string;
  yaml: string;
  closingAndBody: string;
  lineEnding: '\n' | '\r\n';
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

function mapValue(map: YAMLMap, key: string): Node | null | undefined {
  const pair = map.items.find(item => isScalar(item.key) && item.key.value === key);
  return pair?.value as Node | null | undefined;
}

function pythonDefault(param: Node | null | undefined): {map?: YAMLMap; node: Node} | undefined {
  if (param && isScalar(param) && param.tag === '!python') return {node: param};
  if (!param || !isMap(param)) return undefined;

  const value = mapValue(param, 'value');
  return value && isScalar(value) && value.tag === '!python'
    ? {map: param, node: value}
    : undefined;
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
  const front = frontMatter(source);
  if (!front) return source;

  const doc = parseDocument(front.yaml, {customTags: expressionTags});
  if (doc.errors.length) {
    throw new Error(`Could not parse document front matter: ${doc.errors[0].message}`);
  }

  const params = doc.get('params', true);
  if (params == null) return source;
  if (!isMap(params)) throw new Error("YAML field 'params' must be an object.");

  let changed = false;
  for (const pair of params.items) {
    if (!isScalar(pair.key) || typeof pair.key.value !== 'string') continue;
    const name = pair.key.value;
    const found = pythonDefault(pair.value as Node | null | undefined);
    if (!found) continue;
    if (!Object.prototype.hasOwnProperty.call(values, name)) {
      throw new Error(`Missing supplied Python result for parameter: ${name}`);
    }

    const replacement = doc.createNode(values[name]) as Node;
    const original = found.node as Node & {
      anchor?: string;
      comment?: string | null;
      commentBefore?: string | null;
      spaceBefore?: boolean;
    };
    const target = replacement as Node & {
      anchor?: string;
      comment?: string | null;
      commentBefore?: string | null;
      spaceBefore?: boolean;
    };
    if (original.anchor) target.anchor = original.anchor;
    if (original.comment != null) target.comment = original.comment;
    if (original.commentBefore != null) target.commentBefore = original.commentBefore;
    if (original.spaceBefore) target.spaceBefore = true;

    if (found.map) found.map.set('value', replacement);
    else pair.value = replacement;
    changed = true;
  }

  if (!changed) return source;
  const rendered = doc.toString().replace(/\n/g, front.lineEnding);
  return front.opening + rendered + front.closingAndBody;
}
