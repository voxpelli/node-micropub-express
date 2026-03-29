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
 * @typedef MinimalParsedMicropubStructure
 * @property {string[]|undefined} [type]
 * @property {{ [property: string]: import('type-fest').JsonValue[]}} properties
 * @property {{ [property: string]: import('type-fest').JsonValue[]}} mp
 */

/** @typedef {MinimalParsedMicropubStructure & import('type-fest').JsonObject} ParsedMicropubStructure */

/**
 * @template T
 * @param {MaybeArray<T>} value
 * @returns {T[]}
 */
export const ensureArrayAndCloneIt = (value) => Array.isArray(value) ? [...value] : [value];

export const requiredScope = Object.freeze(['create', 'post']);

export const formEncodedKey = /\[([^\]]*)]$/;

export class TokenError extends Error {}
export class TokenScopeError extends TokenError {
  /**
   * @param {string} message
   * @param {string} scope
   */
  constructor (message, scope) {
    super(message);
    this.scope = scope;
  }
}

/** @typedef {string|number|boolean} BasicEncodeableTypes */

/**
 * @param {BasicEncodeableTypes|BasicEncodeableTypes[]|Object<string,any>} data
 * @param {string} [key]
 * @returns {string}
 */
const internalQueryStringEncodeWithArrayBrackets = function (data, key) {
  if (Array.isArray(data)) {
    return data.map(item => internalQueryStringEncodeWithArrayBrackets(item, key + '[]')).join('&');
  } else if (typeof data === 'object' && data !== null) {
    return Object.keys(data)
      .map(dataKey => internalQueryStringEncodeWithArrayBrackets(data[dataKey], key ? key + '[' + dataKey + ']' : dataKey))
      .filter(item => !!item)
      .join('&');
  } else if (!key || typeof data === 'undefined') {
    return '';
  } else if (typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean' || data === null) {
    return encodeURIComponent(key) + (data ? '=' + encodeURIComponent(data) : '');
  } else {
    throw new TypeError(`Invalid data type encountered: ${typeof data}`);
  }
};

/**
 * @param {Object<string,any>} data
 * @returns {string}
 */
export const queryStringEncodeWithArrayBrackets = function (data) {
  return internalQueryStringEncodeWithArrayBrackets(data);
};

/**
 * @param {string} url
 * @returns {string}
 */
export const normalizeUrl = function (url) {
  if (url.slice(-1) !== '/') {
    url += '/';
  }
  return url;
};

export const reservedProperties = Object.freeze([
  'access_token',
  'q',
  'url',
  'update',
  'add',
  'delete'
]);

/**
 * @param {Object<string,any>} result
 */
export const cleanEmptyKeys = function (result) {
  for (const key in result) {
    if (typeof result[key] === 'object' && Object.getOwnPropertyNames(result[key])[0] === undefined) {
      delete result[key];
    }
  }
};

// TODO: Figure out how to import this definition from https://github.com/DefinitelyTyped/DefinitelyTyped/blob/03fddd7a3f2322433a867d9edcee561ac85d950d/types/multer/index.d.ts#L103-L124
/** @typedef {*} MulterFile */

/**
 * @template T
 * @typedef FilesByType
 * @property {T[]} [audio]
 * @property {T[]} [photo]
 * @property {T[]} [video]
 */
/** @typedef {{ filename: string, buffer: Buffer }} ProcessedFile */

/**
 * @param {import('querystring').ParsedUrlQuery} body
 * @returns {ParsedMicropubStructure}
 */
export const processFormEncodedBody = function (body) {
  /** @type {ParsedMicropubStructure} */
  const result = {
    type: body.h ? ['h-' + body.h] : undefined,
    properties: {},
    mp: {}
  };

  if (body.h) {
    delete body.h;
  }

  for (let key in body) {
    const rawValue = body[key];

    if (reservedProperties.includes(key)) {
      result[key] = rawValue;
    } else {
      /** @type {Object<string,any[]>} */
      let targetProperty;
      /** @type {string|string[]|Object<string,any>} */
      let value = rawValue;
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
};

/**
 * @param {Object<string,any>} body
 * @returns {ParsedMicropubStructure}
 */
export const processJsonEncodedBody = function (body) {
  /** @type {ParsedMicropubStructure} */
  const result = {
    properties: {},
    mp: {}
  };

  for (let key in body) {
    const value = body[key];

    if (reservedProperties.includes(key) || ['properties', 'type'].includes(key)) {
      result[key] = value;
    } else if (key.startsWith('mp-')) {
      key = key.slice(3);
      result.mp[key] = [].concat(value);
    }
  }

  for (const key in body.properties) {
    if (['url'].includes(key)) {
      result[key] = result[key] || [].concat(body.properties[key])[0];
      delete body.properties[key];
    }
  }

  cleanEmptyKeys(result);

  return result;
};

/**
 * @template T
 * @param {T} body
 * @param {{ [type: string]: MulterFile[] }} files
 * @param {BunyanLite} logger
 * @returns {T & {files?: FilesByType<ProcessedFile>}}
 */
export const processFiles = function (body, files, logger) {
  /** @type {FilesByType<ProcessedFile>} */
  const allResults = {};

  for (const type of ['video', 'photo', 'audio']) {
    /** @type {ProcessedFile[]} */
    const result = [];
    const typeFiles = [...(files[type] || []), ...(files[type + '[]'] || [])];

    typeFiles.forEach(file => {
      if (file.truncated) {
        logger.warn('File was truncated');
        return;
      }

      result.push({
        filename: file.originalname,
        buffer: file.buffer
      });
    });

    if (result.length) {
      // @ts-ignore
      allResults[type] = result;
    }
  }

  return Object.getOwnPropertyNames(allResults)[0] !== undefined
    ? { ...body, files: allResults }
    : { ...body };
};
