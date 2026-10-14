#!/usr/bin/env node
/*
 * Validates tweak rules (Mock, Modify, header and Redirect) in tweak's import format, before they are
 * imported or pushed through window.tweak. Zero dependencies, Node 18+.
 *
 *   node validate-rules.mjs rules.json     # a file: { "configurations": [...] }, an array or one rule
 *   cat rules.json | node validate-rules.mjs
 *
 * Prints every problem it finds and exits 1 on an error; warnings alone exit 0.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/*
 * The same lists as ../reference/rule.schema.json, which tweak generates from its own schema;
 * tweak's test suite fails if the two disagree.
 */
export const METHODS = ['*', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'CONNECT', 'TRACE'];
export const TARGET_TYPES = ['ALL', 'XHR', 'DOCUMENT', 'IFRAME', 'SCRIPT', 'STYLESHEET', 'IMAGE', 'MEDIA', 'FONT'];
export const MATCH_POLICIES = ['ANY', 'EXACT', 'PARTIAL'];
export const SCOPES = ['ACTIVE_TAB', 'GLOBAL'];
export const EDIT_BEFORE_SEND_STAGES = ['REQUEST', 'REQUEST_AND_RESPONSE', 'RESPONSE'];
export const OPERATIONS = ['set', 'append', 'remove'];
// the only request headers a browser lets a header rule append to; anywhere else, no header rule installs
export const APPENDABLE_REQUEST_HEADERS = [
  'Accept',
  'Accept-Encoding',
  'Accept-Language',
  'Access-Control-Request-Headers',
  'Cache-Control',
  'Connection',
  'Content-Language',
  'Cookie',
  'Forwarded',
  'If-Match',
  'If-None-Match',
  'Keep-Alive',
  'Range',
  'TE',
  'Trailer',
  'Transfer-Encoding',
  'Upgrade',
  'User-Agent',
  'Via',
  'Want-Digest',
  'X-Forwarded-For',
];
// request headers a page cannot set, so a Modify rule cannot either (a header rule can)
export const FORBIDDEN_REQUEST_HEADERS = {
  names: [
    'accept-charset',
    'accept-encoding',
    'access-control-request-headers',
    'access-control-request-method',
    'connection',
    'content-length',
    'cookie',
    'cookie2',
    'date',
    'dnt',
    'expect',
    'feature-policy',
    'host',
    'keep-alive',
    'origin',
    'referer',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
    'via',
  ],
  prefixes: ['proxy-', 'sec-'],
};
// headers sites defend each other with: a header rule touching one imports, but window.tweak refuses it
export const GUARDED_HEADERS = {
  request: ['cookie', 'origin', 'referer'],
  requestPrefixes: ['sec-'],
  response: ['set-cookie', 'content-security-policy', 'x-frame-options'],
  responsePrefixes: ['access-control-', 'cross-origin-'],
};
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const COMMON = ['interceptionPolicy', 'label', 'notes', 'url', 'isRgx', 'method', 'status', 'delay'];
const ANSWERING = [
  'requestPayload',
  'requestPayloadMatchPolicy',
  'requestHeaders',
  'isLogpointEnabled',
  'isEditBeforeSendEnabled',
  'editBeforeSendStage',
  'responseHeaders',
  'responsePayload',
  'responseHook',
  'requestHook',
];
export const FIELDS = {
  MOCK: [...COMMON, ...ANSWERING],
  PATCH: [...COMMON, ...ANSWERING, 'outgoingRequestPayload'],
  MODIFY_HEADERS: [...COMMON, 'requestPayload', 'requestHeaders', 'responseHeaders', 'responsePayload', 'headerRuleScope'],
  REDIRECT: [
    ...COMMON,
    'requestPayload',
    'responseHeaders',
    'responsePayload',
    'redirectUrl',
    'redirectTargetType',
    'headerRuleScope',
  ],
};
// where a rule sits in tweak: an exported rule carries these, and tweak drops them on the way in
export const PLACEMENT = [
  'id',
  'index',
  'collectionId',
  'enabled',
  'requestCount',
  'lastInterceptionTimestamp',
  'isExpanded',
  'activeEditorTab',
  'scrollEditorsPositions',
  'plan',
  'statusText',
];
export const LABEL_MAX = 256;
export const NOTES_MAX = 10000;
export const HOOK_MAX = 20000;

const isString = (value) => typeof value === 'string';
const isRow = (row) =>
  !!row && isString(row.header) && isString(row.value) && (row.active === undefined || typeof row.active === 'boolean');
// a field left at its "off" value asks for nothing
export const isInert = (value) =>
  value == null ||
  value === false ||
  value === '' ||
  value === 0 ||
  (typeof value === 'object' && Object.keys(value).length === 0);

const isListed = (name, names, prefixes) =>
  names.includes(name) || prefixes.some((prefix) => name.startsWith(prefix));

/** Unwraps the three shapes a rule list comes in. */
export function readRules(input) {
  if (Array.isArray(input)) {
    return input;
  }

  if (input && typeof input === 'object') {
    return Array.isArray(input.configurations) ? input.configurations : [input];
  }

  return [];
}

function checkRedirect(rule, error, warn) {
  const target = rule.redirectUrl;

  if (!isString(target) || !target.trim()) {
    error('"redirectUrl" is required');
  } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(target) || rule.isRgx === true) {
    if (!/^https?:\/\//i.test(target)) {
      error(`"redirectUrl" must be http(s)${rule.isRgx ? ' and absolute when "isRgx" is true' : ''}`);
    }
  } else if (!/^[/?#]/.test(target)) {
    error('"redirectUrl" must be an http(s) url, or start with "/", "?" or "#"');
  }

  if (rule.redirectTargetType !== undefined && !TARGET_TYPES.includes(rule.redirectTargetType)) {
    error(`"redirectTargetType" must be one of ${TARGET_TYPES.join(', ')}`);
  }

  checkScope(rule, error, warn);

  if (rule.responsePayload !== undefined && !isString(rule.responsePayload)) {
    error('"responsePayload" must be a string (it is not read on a redirect)');
  }
}

function checkScope(rule, error, warn) {
  if (rule.headerRuleScope !== undefined && !SCOPES.includes(rule.headerRuleScope)) {
    error('"headerRuleScope" must be ACTIVE_TAB or GLOBAL');
  } else if (rule.headerRuleScope === 'GLOBAL') {
    warn('"headerRuleScope" GLOBAL imports from a file, but window.tweak refuses it');
  }
}

function checkHeaderRows(rule, key, error, warn) {
  const isRequest = key === 'requestHeaders';
  const rows = rule[key];

  if (rows === undefined && isRequest) {
    return [];
  }

  if (!Array.isArray(rows)) {
    error(`"${key}" must be an array of { header, value, operation }`);

    return [];
  }

  rows.forEach((row, i) => {
    const where = `${key}[${i}]`;

    if (!isRow(row)) {
      error(`${where} must be { "header": string, "value": string, "operation": "set" | "append" | "remove" }`);

      return;
    }

    const name = row.header.trim().toLowerCase();
    const operation = row.operation ?? 'set';

    if (!HEADER_NAME.test(row.header)) {
      error(`${where} "header" must be a header name: letters, digits and !#$%&'*+-.^_\`|~ only`);
    }
    if (!OPERATIONS.includes(operation)) {
      error(`${where} "operation" must be one of ${OPERATIONS.join(', ')}`);
    } else if (operation !== 'remove' && !row.value.trim()) {
      error(`${where}: a value is required; "operation": "remove" strips the header`);
    } else if (operation === 'append' && isRequest && !APPENDABLE_REQUEST_HEADERS.some((h) => h.toLowerCase() === name)) {
      error(`${where} "${row.header}" cannot be appended to: the browser appends only to ${APPENDABLE_REQUEST_HEADERS.join(', ')}`);
    }

    const guarded = isRequest
      ? isListed(name, GUARDED_HEADERS.request, GUARDED_HEADERS.requestPrefixes)
      : isListed(name, GUARDED_HEADERS.response, GUARDED_HEADERS.responsePrefixes);

    if (guarded) {
      warn(`${where} "${row.header}" guards how sites trust each other: it imports from a file, but window.tweak refuses it`);
    }
  });

  return rows;
}

function checkHeaders(rule, error, warn) {
  const rows = [...checkHeaderRows(rule, 'requestHeaders', error, warn), ...checkHeaderRows(rule, 'responseHeaders', error, warn)];

  if (!rows.some((row) => row && row.active !== false)) {
    error('"requestHeaders" or "responseHeaders" needs at least one active header row');
  }

  checkScope(rule, error, warn);

  if (rule.responsePayload !== undefined && !isString(rule.responsePayload)) {
    error('"responsePayload" must be a string (it is not read on a header rule)');
  }
}

function checkMock(rule, error, warn) {
  const isModify = rule.interceptionPolicy === 'PATCH';
  const policy = rule.requestPayloadMatchPolicy;

  if (policy !== undefined && !MATCH_POLICIES.includes(policy)) {
    error('"requestPayloadMatchPolicy" must be ANY, EXACT or PARTIAL');
  } else if (policy === 'ANY') {
    warn(
      '"requestPayloadMatchPolicy" ANY is refused by older tweak versions; an empty "requestPayload" matches any body',
    );
  } else if (policy === 'PARTIAL') {
    warn('"requestPayloadMatchPolicy" PARTIAL needs tweak premium; a free plan matches the body exactly');
  }

  if (isString(rule.requestPayload) && policy === 'PARTIAL' && /^\s*(\{\s*\}|\[\s*\])\s*$/.test(rule.requestPayload)) {
    warn('"requestPayload" {} or [] under PARTIAL matches every JSON body');
  }

  // a Mock never sends its request: only a Content-Type row means anything (form matching).
  // A Modify rule sends it from the page, which cannot set the forbidden headers
  if (rule.requestHeaders !== undefined) {
    if (!Array.isArray(rule.requestHeaders)) {
      error('"requestHeaders" must be an array of { header, value }');
    } else {
      rule.requestHeaders.forEach((row, i) => {
        const name = isRow(row) ? row.header.trim().toLowerCase() : '';

        if (!isRow(row) || (isModify && !name)) {
          error(`requestHeaders[${i}] must be { "header": string, "value": string }`);
        } else if (!isModify && name !== 'content-type') {
          error(`requestHeaders[${i}] "${row.header}" does nothing on a Mock; only Content-Type is read`);
        } else if (isModify && isListed(name, FORBIDDEN_REQUEST_HEADERS.names, FORBIDDEN_REQUEST_HEADERS.prefixes)) {
          error(`requestHeaders[${i}] "${row.header}" cannot be set by a page; a MODIFY_HEADERS rule can set it`);
        }
      });
    }
  }

  if (isModify) {
    warn('a Modify (PATCH) rule needs tweak premium; a free plan imports it as a Mock');

    if (rule.outgoingRequestPayload !== undefined && !isString(rule.outgoingRequestPayload)) {
      error('"outgoingRequestPayload" must be a string (JSON goes in as text)');
    }

    const changes =
      rule.status !== 0 ||
      rule.delay > 0 ||
      !!rule.responsePayload ||
      !!rule.outgoingRequestPayload ||
      (Array.isArray(rule.responseHeaders) && rule.responseHeaders.length > 0) ||
      // the request is sent, so even a Content-Type row is a header the rule sets
      (Array.isArray(rule.requestHeaders) && rule.requestHeaders.length > 0) ||
      ['responseHook', 'requestHook'].some((key) => isString(rule[key]) && rule[key].trim()) ||
      // the user changes it by hand, live
      rule.isEditBeforeSendEnabled === true;

    if (!changes) {
      error(
        'a Modify rule must change something: "status", "delay", "responsePayload", "outgoingRequestPayload", a header row, a hook or Edit before send'
      );
    }
  }

  if (rule.isEditBeforeSendEnabled !== undefined && typeof rule.isEditBeforeSendEnabled !== 'boolean') {
    error('"isEditBeforeSendEnabled" must be true or false');
  } else if (rule.isEditBeforeSendEnabled === true) {
    warn('"isEditBeforeSendEnabled" needs tweak premium; a free plan never pauses');
  }

  if (rule.editBeforeSendStage !== undefined && !EDIT_BEFORE_SEND_STAGES.includes(rule.editBeforeSendStage)) {
    error(`"editBeforeSendStage" must be one of ${EDIT_BEFORE_SEND_STAGES.join(', ')}`);
  } else if (rule.editBeforeSendStage !== undefined && rule.isEditBeforeSendEnabled !== true) {
    warn('"editBeforeSendStage" does nothing unless "isEditBeforeSendEnabled" is true');
  }

  if (rule.isLogpointEnabled !== undefined && typeof rule.isLogpointEnabled !== 'boolean') {
    error('"isLogpointEnabled" must be true or false');
  } else if (rule.isLogpointEnabled === false) {
    warn('"isLogpointEnabled" false needs tweak premium; a free plan logs every interception');
  }

  ['responseHook', 'requestHook'].forEach((key) => {
    if (rule[key] !== undefined && !isString(rule[key])) {
      error(`"${key}" must be a string: the body of a function`);
    } else if (isString(rule[key]) && rule[key].length > HOOK_MAX) {
      error(`"${key}" is longer than ${HOOK_MAX} characters`);
    } else if (isString(rule[key]) && rule[key].trim()) {
      warn(`"${key}" needs tweak premium; a free plan drops it on import`);
    }
  });

  if (!isString(rule.responsePayload)) {
    error('"responsePayload" must be a string (JSON goes in as text)');

    return;
  }

  const contentType = (Array.isArray(rule.responseHeaders) ? rule.responseHeaders : []).find(
    (row) => row && isString(row.header) && row.header.toLowerCase() === 'content-type'
  );

  if (contentType && /json/i.test(contentType.value) && rule.responsePayload.trim()) {
    try {
      JSON.parse(rule.responsePayload);
    } catch {
      warn('"responsePayload" is not valid JSON but Content-Type says JSON; fine only if that is the point');
    }
  }
}

/** Every problem in one rule, as { errors, warnings }. */
export function validateRule(rule, where = 'rule') {
  const errors = [];
  const warnings = [];
  const error = (message) => errors.push(`${where}: ${message}`);
  const warn = (message) => warnings.push(`${where}: ${message}`);

  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
    error('must be an object');

    return { errors, warnings };
  }

  const type = rule.interceptionPolicy;

  if (!Object.keys(FIELDS).includes(type)) {
    error(`"interceptionPolicy" must be one of ${Object.keys(FIELDS).join(', ')}`);

    return { errors, warnings };
  }

  // the fields tweak's import page refuses a file without
  if (!isString(rule.url) || !rule.url.trim()) error('"url" is required');
  if (typeof rule.isRgx !== 'boolean') error('"isRgx" must be true or false');
  if (!METHODS.includes(rule.method)) error(`"method" must be one of ${METHODS.join(', ')}`);
  if (!Number.isInteger(rule.status) || ((rule.status < 100 || rule.status > 599) && !(type === 'PATCH' && rule.status === 0))) {
    error(type === 'PATCH' ? '"status" must be 0 (the server\'s own) or 100-599' : '"status" must be 100-599');
  }
  if (typeof rule.delay !== 'number' || rule.delay < 0) error('"delay" must be a number of ms, 0 or more');
  if (!isString(rule.requestPayload)) error('"requestPayload" must be a string ("" matches any body)');

  if (!Array.isArray(rule.responseHeaders)) {
    error('"responseHeaders" must be an array');
  } else if (type !== 'MODIFY_HEADERS') {
    rule.responseHeaders.forEach((row, i) => {
      if (!isRow(row) || !row.header.trim()) {
        error(`responseHeaders[${i}] must be { "header": string, "value": string, "active": true }`);
      }
    });
  }

  if (rule.isRgx === true && isString(rule.url)) {
    try {
      new RegExp(rule.url);
    } catch {
      error('"url" is not a valid regular expression');
    }
  }

  ['label', 'notes'].forEach((key) => {
    const max = key === 'label' ? LABEL_MAX : NOTES_MAX;

    if (rule[key] !== undefined && (!isString(rule[key]) || rule[key].length > max)) {
      error(`"${key}" is text, ${max} max`);
    }
  });

  // window.tweak drops an export's leftovers without a word, and refuses any other field
  Object.keys(rule)
    .filter((key) => !FIELDS[type].includes(key))
    .forEach((key) =>
      PLACEMENT.includes(key) || isInert(rule[key])
        ? warn(`"${key}" is not part of a ${type} rule these skills write; it will be ignored`)
        : error(`"${key}" is not part of a ${type} rule; window.tweak refuses it`)
    );

  ({ MOCK: checkMock, PATCH: checkMock, MODIFY_HEADERS: checkHeaders, REDIRECT: checkRedirect })[type](rule, error, warn);

  return { errors, warnings };
}

/** Every problem in a rule list. */
export function validateRules(input) {
  const rules = readRules(input);

  if (!rules.length) {
    return { errors: ['expected { "configurations": [...] }, an array of rules or one rule'], warnings: [] };
  }

  return rules
    .map((rule, i) => validateRule(rule, `configurations[${i}]`))
    .reduce((all, { errors, warnings }) => ({
      errors: [...all.errors, ...errors],
      warnings: [...all.warnings, ...warnings],
    }));
}

function main() {
  const path = process.argv[2];
  let input;

  try {
    input = JSON.parse(readFileSync(path || 0, 'utf8'));
  } catch (err) {
    console.error(`not JSON: ${err.message}`);
    process.exit(1);
  }

  const { errors, warnings } = validateRules(input);

  warnings.forEach((message) => console.warn(`warning  ${message}`));
  errors.forEach((message) => console.error(`error    ${message}`));

  if (errors.length) {
    process.exit(1);
  }

  console.log(`OK: ${readRules(input).length} rule(s)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
