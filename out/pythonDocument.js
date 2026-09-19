"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.materializePythonDefaults = materializePythonDefaults;
const yaml_1 = require("yaml");
const expressionTags = ['python', 'r', 'expr'].map(name => ({
    tag: `!${name}`,
    resolve: source => source
}));
function frontMatter(source) {
    const opening = /^(?:\uFEFF)?---[ \t]*(\r\n|\n)/.exec(source);
    if (!opening)
        return undefined;
    const lineEnding = opening[1];
    const yamlStart = opening[0].length;
    const delimiter = /^(?:---|\.\.\.)[ \t]*(?:\r\n|\n|$)/gm;
    delimiter.lastIndex = yamlStart;
    let closing;
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
function mapValue(map, key) {
    const pair = map.items.find(item => (0, yaml_1.isScalar)(item.key) && item.key.value === key);
    return pair?.value;
}
function pythonDefault(param) {
    if (param && (0, yaml_1.isScalar)(param) && param.tag === '!python')
        return { node: param };
    if (!param || !(0, yaml_1.isMap)(param))
        return undefined;
    const value = mapValue(param, 'value');
    return value && (0, yaml_1.isScalar)(value) && value.tag === '!python'
        ? { map: param, node: value }
        : undefined;
}
/**
 * Replace evaluated !python parameter defaults in a QMD front matter block.
 * Other tagged values are parsed but never evaluated, and the document body is
 * copied byte-for-byte.
 */
function materializePythonDefaults(source, values) {
    const front = frontMatter(source);
    if (!front)
        return source;
    const doc = (0, yaml_1.parseDocument)(front.yaml, { customTags: expressionTags });
    if (doc.errors.length) {
        throw new Error(`Could not parse document front matter: ${doc.errors[0].message}`);
    }
    const params = doc.get('params', true);
    if (params == null)
        return source;
    if (!(0, yaml_1.isMap)(params))
        throw new Error("YAML field 'params' must be an object.");
    let changed = false;
    for (const pair of params.items) {
        if (!(0, yaml_1.isScalar)(pair.key) || typeof pair.key.value !== 'string')
            continue;
        const name = pair.key.value;
        const found = pythonDefault(pair.value);
        if (!found)
            continue;
        if (!Object.prototype.hasOwnProperty.call(values, name)) {
            throw new Error(`Missing supplied Python result for parameter: ${name}`);
        }
        const replacement = doc.createNode(values[name]);
        const original = found.node;
        const target = replacement;
        if (original.anchor)
            target.anchor = original.anchor;
        if (original.comment != null)
            target.comment = original.comment;
        if (original.commentBefore != null)
            target.commentBefore = original.commentBefore;
        if (original.spaceBefore)
            target.spaceBefore = true;
        if (found.map)
            found.map.set('value', replacement);
        else
            pair.value = replacement;
        changed = true;
    }
    if (!changed)
        return source;
    const rendered = doc.toString().replace(/\n/g, front.lineEnding);
    return front.opening + rendered + front.closingAndBody;
}
//# sourceMappingURL=pythonDocument.js.map