function resolvePath(context, path) {
  const parts = path.trim().split('.');
  let value = context;
  for (const part of parts) {
    if (value == null) return undefined;
    if (part === 'length' && (Array.isArray(value) || typeof value === 'string')) value = value.length;
    else value = value[part];
  }
  return value;
}

function splitArgs(input) {
  const out = [];
  let quote = null, depth = 0, start = 0;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quote) { if (c === quote && input[i - 1] !== '\\') quote = null; }
    else if (c === '"' || c === "'") quote = c;
    else if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) { out.push(input.slice(start, i).trim()); start = i + 1; }
  }
  if (input.slice(start).trim()) out.push(input.slice(start).trim());
  return out;
}

function parseValue(expr, context) {
  expr = expr.trim();
  if ((expr[0] === '"' && expr.at(-1) === '"') || (expr[0] === "'" && expr.at(-1) === "'")) return expr.slice(1, -1);
  if (expr === 'true') return true;
  if (expr === 'false') return false;
  if (expr === 'none' || expr === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(expr)) return Number(expr);
  return resolvePath(context, expr);
}

function applyFilter(value, name, args, context) {
  const first = args.length ? parseValue(args[0], context) : undefined;
  switch (name) {
    case 'default': return value == null || value === '' || value === false ? (first ?? '') : value;
    case 'join': return (Array.isArray(value) ? value : value == null ? [] : [value]).join(first ?? '');
    case 'replace': {
      if (value == null) return '';
      const from = String(first ?? ''), to = String(args[1] == null ? '' : parseValue(args[1], context));
      return String(value).split(from).join(to);
    }
    case 'date': {
      if (value == null || value === '') return '';
      const date = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(date.getTime())) return String(value);
      const format = String(first || '%Y-%m-%d');
      const pad = n => String(n).padStart(2, '0');
      const tokens = { '%Y': date.getFullYear(), '%m': pad(date.getMonth() + 1), '%d': pad(date.getDate()), '%H': pad(date.getHours()), '%M': pad(date.getMinutes()), '%S': pad(date.getSeconds()) };
      return format.replace(/%[YmdHMS]/g, token => tokens[token]);
    }
    default: throw new Error('Unsupported Jinja filter: ' + name);
  }
}

function renderExpression(expression, context) {
  const parts = expression.split('|').map(x => x.trim());
  let value = parseValue(parts.shift(), context);
  for (const filter of parts) {
    const match = filter.match(/^([\w]+)(?:\((.*)\))?$/);
    if (!match) throw new Error('Invalid filter: ' + filter);
    value = applyFilter(value, match[1], match[2] ? splitArgs(match[2]) : [], context);
  }
  if (value == null) return '';
  if (typeof value === 'object') return Array.isArray(value) ? value.join(',') : '[object Object]';
  return String(value);
}

function truthy(value) { return Array.isArray(value) ? value.length > 0 : Boolean(value); }

function renderNodes(template, context) {
  const tokenRe = /({{[\s\S]*?}}|{%[\s\S]*?%})/g;
  const tokens = template.split(tokenRe).filter(Boolean);
  function sequence(index, stops = []) {
    let output = '';
    while (index < tokens.length) {
      const token = tokens[index];
      if (token.startsWith('{{')) { output += renderExpression(token.slice(2, -2), context); index++; continue; }
      if (!token.startsWith('{%')) { output += token; index++; continue; }
      const tag = token.slice(2, -2).trim();
      const keyword = tag.split(/\s+/)[0];
      if (stops.includes(keyword)) return { output, index, tag };
      if (keyword === 'if') {
        const condition = tag.slice(2).trim();
        const branch = evaluateCondition(condition, context);
        let parsed = sequence(index + 1, ['else', 'elif', 'endif']);
        let selected = branch ? parsed.output : '';
        while (parsed.tag && parsed.tag.split(/\s+/)[0] === 'elif') {
          const nextCondition = parsed.tag.slice(4).trim();
          const next = sequence(parsed.index + 1, ['else', 'elif', 'endif']);
          if (!branch && !selected && evaluateCondition(nextCondition, context)) selected = next.output;
          parsed = next;
        }
        if (parsed.tag && parsed.tag.startsWith('else')) {
          const other = sequence(parsed.index + 1, ['endif']);
          if (!branch && !selected) selected = other.output;
          parsed = other;
        }
        output += selected; index = parsed.index + 1; continue;
      }
      if (keyword === 'for') {
        const match = tag.match(/^for\s+(\w+)\s+in\s+(.+)$/);
        if (!match) throw new Error('Invalid for tag: ' + tag);
        const body = sequence(index + 1, ['endfor']);
        const list = resolvePath(context, match[2].trim());
        if (Array.isArray(list) || typeof list === 'string') {
          const items = typeof list === 'string' ? [...list] : list;
          for (let i = 0; i < items.length; i++) {
            const loop = { index: i + 1, index0: i, first: i === 0, last: i === items.length - 1, length: items.length };
            output += renderNodes(tokens.slice(index + 1, body.index).join(''), { ...context, [match[1]]: items[i], loop });
          }
        }
        index = body.index + 1; continue;
      }
      if (keyword === 'else' || keyword === 'endif' || keyword === 'endfor') return { output, index, tag };
      throw new Error('Unsupported Jinja tag: ' + tag);
    }
    return { output, index, tag: null };
  }
  return sequence(0).output;
}

function evaluateCondition(expr, context) {
  expr = expr.trim();
  let m = expr.match(/^(.+?)\s+is\s+defined$/);
  if (m) return resolvePath(context, m[1]) !== undefined;
  m = expr.match(/^(.+?)\s+is\s+not\s+defined$/);
  if (m) return resolvePath(context, m[1]) === undefined;
  m = expr.match(/^(.+?)\s+(==|!=|>=|<=|>|<)\s+(.+)$/);
  if (m) {
    const left = parseValue(m[1], context), right = parseValue(m[3], context);
    switch (m[2]) { case '==': return left === right; case '!=': return left !== right; case '>': return left > right; case '<': return left < right; case '>=': return left >= right; case '<=': return left <= right; }
  }
  m = expr.match(/^not\s+(.+)$/);
  if (m) return !evaluateCondition(m[1], context);
  const alternatives = expr.split(/\s+or\s+/);
  if (alternatives.length > 1) return alternatives.some(x => evaluateCondition(x, context));
  const conjunction = expr.split(/\s+and\s+/);
  if (conjunction.length > 1) return conjunction.every(x => evaluateCondition(x, context));
  return truthy(parseValue(expr, context));
}

function render(template, context = {}) {
  return renderNodes(String(template), context);
}

module.exports = { render, renderExpression };
