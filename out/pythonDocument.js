"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.materializePythonDefaults = materializePythonDefaults;
exports.materializeParameterExpressions = materializeParameterExpressions;
const yaml_1 = require("yaml");
const expressionTags = ['python', 'r', 'expr'].map(name => ({
    tag: `!${name}`,
    resolve: source => source
}));
const expressionTagNames = new Set(expressionTags.map(tag => tag.tag));
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
function mapPair(map, key) {
    return map.items.find(item => (0, yaml_1.isScalar)(item.key) && item.key.value === key);
}
function isExpression(node, tags = expressionTagNames) {
    if (!node)
        return false;
    if ((0, yaml_1.isScalar)(node))
        return typeof node.tag === 'string' && tags.has(node.tag);
    if ((0, yaml_1.isSeq)(node))
        return node.items.some(item => isExpression(item, tags));
    if ((0, yaml_1.isMap)(node)) {
        return node.items.some(pair => isExpression(pair.key, tags) ||
            isExpression(pair.value, tags));
    }
    return false;
}
function copyNodeMetadata(original, replacement) {
    const source = original;
    const target = replacement;
    if (source.anchor)
        target.anchor = source.anchor;
    if (source.comment != null)
        target.comment = source.comment;
    if (source.commentBefore != null)
        target.commentBefore = source.commentBefore;
    if (source.spaceBefore)
        target.spaceBefore = true;
}
function replacePairValue(doc, pair, value) {
    const original = pair.value;
    const replacement = doc.createNode(value);
    if (original)
        copyNodeMetadata(original, replacement);
    pair.value = replacement;
}
function render(source, front, doc, changed) {
    if (!changed)
        return source;
    const rendered = doc.toString().replace(/\n/g, front.lineEnding);
    return front.opening + rendered + front.closingAndBody;
}
function parsedFrontMatter(source) {
    const front = frontMatter(source);
    if (!front)
        return undefined;
    const doc = (0, yaml_1.parseDocument)(front.yaml, { customTags: expressionTags });
    if (doc.errors.length) {
        throw new Error(`Could not parse document front matter: ${doc.errors[0].message}`);
    }
    const params = doc.get('params', true);
    if (params != null && !(0, yaml_1.isMap)(params))
        throw new Error("YAML field 'params' must be an object.");
    return { front, doc, params: params };
}
/**
 * Replace evaluated !python parameter defaults in a QMD front matter block.
 * Other tagged values are parsed but never evaluated, and the document body is
 * copied byte-for-byte.
 */
function materializePythonDefaults(source, values) {
    const parsed = parsedFrontMatter(source);
    if (!parsed || parsed.params == null)
        return source;
    const { front, doc, params } = parsed;
    const pythonTag = new Set(['!python']);
    let changed = false;
    for (const pair of params.items) {
        if (!(0, yaml_1.isScalar)(pair.key) || typeof pair.key.value !== 'string')
            continue;
        const name = pair.key.value;
        const param = pair.value;
        const direct = param && (0, yaml_1.isScalar)(param) && isExpression(param, pythonTag);
        const valuePair = param && (0, yaml_1.isMap)(param) ? mapPair(param, 'value') : undefined;
        const nested = valuePair?.value && (0, yaml_1.isScalar)(valuePair.value) && isExpression(valuePair.value, pythonTag);
        if (!direct && !nested)
            continue;
        if (!Object.prototype.hasOwnProperty.call(values, name)) {
            throw new Error(`Missing supplied Python result for parameter: ${name}`);
        }
        replacePairValue(doc, nested ? valuePair : pair, values[name]);
        changed = true;
    }
    return render(source, front, doc, changed);
}
const metadataFields = {
    label: 'label',
    input: 'type',
    min: 'min',
    max: 'max',
    step: 'step',
    multiple: 'multiple',
    placeholder: 'placeholder',
    description: 'description'
};
function schemaChoices(parameter, preserveMap) {
    const choices = parameter.choices ?? [];
    const named = preserveMap || choices.some(choice => choice.label !== String(choice.value));
    if (!named)
        return choices.map(choice => choice.value);
    return Object.fromEntries(choices.map(choice => [choice.label, choice.value]));
}
/**
 * Replace parameter expressions with submitted defaults and resolved schema
 * metadata. Expressions are recognized through the YAML AST and never run.
 */
function materializeParameterExpressions(source, values, schema) {
    const parsed = parsedFrontMatter(source);
    if (!parsed || parsed.params == null)
        return source;
    const { front, doc, params } = parsed;
    let changed = false;
    for (const pair of params.items) {
        if (!(0, yaml_1.isScalar)(pair.key) || typeof pair.key.value !== 'string')
            continue;
        const name = pair.key.value;
        let param = pair.value;
        if (!isExpression(param))
            continue;
        const resolved = schema.find(item => item.name === name);
        if (!resolved) {
            throw new Error(`Missing resolved schema for parameter expression: ${name}`);
        }
        if (!(0, yaml_1.isMap)(param)) {
            if (!Object.prototype.hasOwnProperty.call(values, name)) {
                throw new Error(`Missing submitted value for parameter expression: ${name}`);
            }
            replacePairValue(doc, pair, values[name]);
            changed = true;
            continue;
        }
        const valuePair = mapPair(param, 'value');
        if (valuePair && isExpression(valuePair.value)) {
            if (!Object.prototype.hasOwnProperty.call(values, name)) {
                throw new Error(`Missing submitted value for parameter expression: ${name}`);
            }
            replacePairValue(doc, valuePair, values[name]);
            changed = true;
        }
        const choicesPair = mapPair(param, 'choices');
        if (choicesPair && isExpression(choicesPair.value)) {
            replacePairValue(doc, choicesPair, schemaChoices(resolved, (0, yaml_1.isMap)(choicesPair.value)));
            changed = true;
        }
        for (const [field, schemaField] of Object.entries(metadataFields)) {
            const metadataPair = mapPair(param, field);
            if (metadataPair && isExpression(metadataPair.value)) {
                replacePairValue(doc, metadataPair, resolved[schemaField]);
                changed = true;
            }
        }
        for (const item of param.items) {
            if (!isExpression(item.key) && !isExpression(item.value))
                continue;
            const field = (0, yaml_1.isScalar)(item.key) ? String(item.key.value) : '<non-scalar key>';
            throw new Error(`Unsupported parameter expression metadata for '${name}.${field}'.`);
        }
    }
    return render(source, front, doc, changed);
}
//# sourceMappingURL=pythonDocument.js.map