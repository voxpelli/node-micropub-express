// @ts-check
/// <reference types="node" />

/** @typedef {import('bunyan-adaptor').BunyanLite} BunyanLite */

/**
 * @template T
 * @typedef {T|T[]} MaybeArray
 */
/**
 * @template T
 * @typedef {T|Promise<T>} MaybePromised
 */

/**
 * @typedef TokenReference
 * @property {string} me
 * @property {string} endpoint
 */

/**
 * @typedef ParsedMicropubStructure
 * @property {string[]} [type]
 * @property {{ [property: string]: import('type-fest').JsonValue[] }} properties
 * @property {{ [property: string]: import('type-fest').JsonValue[] }} mp
 * @property {string} [url]
 * @property {string} [access_token]
 * @property {import('type-fest').JsonValue} [q]
 * @property {import('type-fest').JsonValue} [update]
 * @property {import('type-fest').JsonValue} [add]
 * @property {import('type-fest').JsonValue} [delete]
 */

/**
 * @template T
 * @param {MaybeArray<T>} value
 * @returns {T[]}
 */
export const ensureArrayAndCloneIt = (value) => Array.isArray(value) ? [...value] : [value];

export const requiredScope = Object.freeze(['create', 'post']);

export const formEncodedKey = /\[([^\]]*)\]$/;

export class TokenError extends Error {}
export class TokenScopeError extends TokenError {
  /**
   * @param {string} message
   * @param {string} scope
   */
  constructor (message, scope) {
    super(message);
    /** @type {string} */
    this.scope = scope;
  }
}

/** @typedef {string|number|boolean} BasicEncodeableTypes */

/**
 * @param {BasicEncodeableTypes|BasicEncodeableTypes[]|Object<string,any>} data
 * @param {string} [key]
 * @returns {string}
 */
function internalQueryStringEncodeWithArrayBrackets (data, key) {
  if (Array.isArray(data)) {
    return data.map(
      /** @type {(item: BasicEncodeableTypes|BasicEncodeableTypes[]|Record<string, any>) => string} */
      (item) => internalQueryStringEncodeWithArrayBrackets(item, key + '[]')
    ).join('&');
  } else if (typeof data === 'object' && data !== null) {
    return Object.keys(data)
      .map(dataKey => internalQueryStringEncodeWithArrayBrackets(data[dataKey], key ? key + '[' + dataKey + ']' : dataKey))
      .filter(item => !!item)
      .join('&');
  } else if (!key || data === undefined) {
    return '';
  } else if (typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean' || data === null) {
    return encodeURIComponent(key) + (data ? '=' + encodeURIComponent(data) : '');
  } else {
    throw new TypeError(`Invalid data type encountered: ${typeof data}`);
  }
}

/**
 * @param {Object<string,any>} data
 * @returns {string}
 */
export function queryStringEncodeWithArrayBrackets (data) {
  return internalQueryStringEncodeWithArrayBrackets(data);
}

/**
 * @param {string} url
 * @returns {string}
 */
export function normalizeUrl (url) {
  if (url.slice(-1) !== '/') {
    url += '/';
  }
  return url;
}

export const reservedProperties = Object.freeze([
  'access_token',
  'q',
  'url',
  'update',
  'add',
  'delete',
]);

/**
 * @param {Object<string,any>} result
 */
export function cleanEmptyKeys (result) {
  for (const key in result) {
    if (typeof result[key] === 'object' && Object.getOwnPropertyNames(result[key])[0] === undefined) {
      delete result[key];
    }
  }
}

/** @typedef {Express.Multer.File & { truncated?: boolean }} MulterFile */

/**
 * @template T
 * @typedef FilesByType
 * @property {T[]} [audio]
 * @property {T[]} [photo]
 * @property {T[]} [video]
 */
/** @typedef {{ filename: string, buffer: Buffer }} ProcessedFile */

/**
 * @param {Record<string, string | string[] | undefined>} body
 * @returns {ParsedMicropubStructure}
 */
export function processFormEncodedBody (body) {
  /** @type {ParsedMicropubStructure} */
  const result = {
    ...(body['h'] ? { type: ['h-' + body['h']] } : {}),
    properties: {},
    mp: {},
  };

  if (body['h']) {
    delete body['h'];
  }

  for (let key in body) {
    const rawValue = body[key];

    if (reservedProperties.includes(key)) {
      // @ts-expect-error -- dynamic assignment to known reserved keys
      result[key] = rawValue;
    } else {
      /** @type {Record<string, any[]>} */
      let targetProperty;
      /** @type {string|string[]|Record<string, any>} */
      let value = rawValue || '';
      /** @type {RegExpExecArray | null} */
      let subKey;

      while ((subKey = formEncodedKey.exec(key))) {
        if (subKey[1]) {
          /** @type {Object<string,any>} */
          const tmp = {};
          tmp[subKey[1]] = value;
          value = tmp;
        } else {
          value = ensureArrayAndCloneIt(value);
        }
        key = key.slice(0, subKey.index);
      }

      if (key.startsWith('mp-')) {
        key = key.slice(3);
        targetProperty = result.mp;
      } else {
        targetProperty = result.properties;
      }

      targetProperty[key] = ensureArrayAndCloneIt(value);
    }
  }

  cleanEmptyKeys(result);

  return result;
}

/**
 * @param {Record<string, any>} body
 * @returns {ParsedMicropubStructure}
 */
export function processJsonEncodedBody (body) {
  /** @type {ParsedMicropubStructure} */
  const result = {
    properties: {},
    mp: {},
  };

  for (let key in body) {
    /** @type {unknown} */
    const value = body[key];

    if (reservedProperties.includes(key) || ['properties', 'type'].includes(key)) {
      // @ts-expect-error -- dynamic assignment to known keys
      result[key] = value;
    } else if (key.startsWith('mp-')) {
      key = key.slice(3);
      result.mp[key] = [/** @type {any} */(value)].flat();
    }
  }

  for (const key in body['properties']) {
    if (['url'].includes(key)) {
      // @ts-expect-error -- dynamic assignment to known keys
      result[key] = result[key] || [body['properties'][key]].flat()[0];
      delete body['properties'][key];
    }
  }

  cleanEmptyKeys(result);

  return result;
}

/**
 * @template T
 * @param {T} body
 * @param {{ [type: string]: MulterFile[] }} files
 * @param {BunyanLite} logger
 * @returns {T & {files?: FilesByType<ProcessedFile>}}
 */
export function processFiles (body, files, logger) {
  /** @type {FilesByType<ProcessedFile>} */
  const allResults = {};

  for (const type of ['video', 'photo', 'audio']) {
    /** @type {ProcessedFile[]} */
    const result = [];
    const typeFiles = [...(files[type] || []), ...(files[type + '[]'] || [])];

    for (const file of typeFiles) {
      if (file.truncated) {
        logger.warn('File was truncated');
        continue;
      }

      result.push({
        filename: file.originalname,
        buffer: file.buffer,
      });
    }

    if (result.length) {
      /** @type {Record<string, ProcessedFile[]>} */ (allResults)[type] = result;
    }
  }

  return Object.getOwnPropertyNames(allResults)[0] !== undefined
    ? /** @type {T & { files?: FilesByType<ProcessedFile> }} */ ({ ...body, files: allResults })
    : /** @type {T & { files?: FilesByType<ProcessedFile> }} */ ({ ...body });
}
