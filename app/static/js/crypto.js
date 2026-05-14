(function (globalScope) {
  'use strict';

  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder();
  const DEFAULT_ARGON2_OPTIONS = {
    time: 3,
    mem: 65536,
    parallelism: 1,
    hashLen: 64
  };

  function ensureWebCrypto() {
    if (!globalScope.crypto || !globalScope.crypto.subtle) {
      throw new Error('Web Crypto API is unavailable in this environment.');
    }
    return globalScope.crypto.subtle;
  }

  function normalizeUint8(input, label) {
    if (input instanceof Uint8Array) return input;
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    if (typeof input === 'string') return textEncoder.encode(input);
    throw new TypeError(label + ' must be a string, Uint8Array, or ArrayBuffer.');
  }

  function toBase64(input) {
    const bytes = normalizeUint8(input, 'Input');
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
  }

  function fromBase64(base64Value) {
    if (typeof base64Value !== 'string') {
      throw new TypeError('Base64 value must be a string.');
    }
    const binary = atob(base64Value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  function resolveArgon2Type(argon2) {
    if (argon2 && argon2.ArgonType && argon2.ArgonType.Argon2id !== undefined) {
      return argon2.ArgonType.Argon2id;
    }
    if (argon2 && argon2.argon2id !== undefined) {
      return argon2.argon2id;
    }
    return 2;
  }

  function getArgon2Provider(explicitProvider) {
    const provider = explicitProvider || globalScope.argon2;
    if (!provider || typeof provider.hash !== 'function') {
      throw new Error(
        'Argon2 WASM provider not found. Load argon2-browser (window.argon2) or pass one in options.argon2.'
      );
    }
    return provider;
  }

  async function deriveKeys(masterPassword, salt, options) {
    const subtle = ensureWebCrypto();
    const argon2Options = options || {};
    const argon2 = getArgon2Provider(argon2Options.argon2);
    const params = {
      time: argon2Options.time || DEFAULT_ARGON2_OPTIONS.time,
      mem: argon2Options.mem || DEFAULT_ARGON2_OPTIONS.mem,
      parallelism: argon2Options.parallelism || DEFAULT_ARGON2_OPTIONS.parallelism,
      hashLen: argon2Options.hashLen || DEFAULT_ARGON2_OPTIONS.hashLen,
      type: argon2Options.type || resolveArgon2Type(argon2)
    };

    const passwordBytes = normalizeUint8(masterPassword, 'Master password');
    const saltBytes = normalizeUint8(salt, 'Salt');
    const result = await argon2.hash({
      pass: passwordBytes,
      salt: saltBytes,
      time: params.time,
      mem: params.mem,
      hashLen: params.hashLen,
      parallelism: params.parallelism,
      type: params.type
    });

    const combinedKeyBytes = result.hash instanceof Uint8Array ? result.hash : new Uint8Array(result.hash);
    if (combinedKeyBytes.length < 64) {
      throw new Error('Argon2 output must be at least 64 bytes to derive both keys.');
    }

    const authKeyBytes = combinedKeyBytes.slice(0, 32);
    const masterKeyBytes = combinedKeyBytes.slice(32, 64);
    const masterEncryptionKey = await subtle.importKey(
      'raw',
      masterKeyBytes,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );

    return {
      authKey: toBase64(authKeyBytes),
      masterEncryptionKey: masterEncryptionKey
    };
  }

  async function generateRsaOaepKeyPair(options) {
    const subtle = ensureWebCrypto();
    const config = options || {};
    const isExtractable = config.extractable !== undefined ? Boolean(config.extractable) : false;
    return subtle.generateKey(
      {
        name: 'RSA-OAEP',
        modulusLength: config.modulusLength || 4096,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: config.hash || 'SHA-256'
      },
      isExtractable,
      ['wrapKey', 'unwrapKey']
    );
  }

  async function generateVaultKey(options) {
    const subtle = ensureWebCrypto();
    const config = options || {};
    const isExtractable = config.extractable !== undefined ? Boolean(config.extractable) : false;
    return subtle.generateKey(
      {
        name: 'AES-GCM',
        length: config.length || 256
      },
      isExtractable,
      ['encrypt', 'decrypt']
    );
  }

  async function wrapVaultKey(vaultKey, rsaPublicKey) {
    const subtle = ensureWebCrypto();
    const wrapped = await subtle.wrapKey(
      'raw',
      vaultKey,
      rsaPublicKey,
      {
        name: 'RSA-OAEP'
      }
    );
    return toBase64(new Uint8Array(wrapped));
  }

  async function unwrapVaultKey(wrappedVaultKeyBase64, rsaPrivateKey, options) {
    const subtle = ensureWebCrypto();
    const config = options || {};
    const wrappedBytes = fromBase64(wrappedVaultKeyBase64);
    return subtle.unwrapKey(
      'raw',
      wrappedBytes,
      rsaPrivateKey,
      { name: 'RSA-OAEP' },
      { name: 'AES-GCM', length: config.length || 256 },
      config.extractable !== undefined ? config.extractable : false,
      config.keyUsages || ['encrypt', 'decrypt']
    );
  }

  async function encryptAesGcm(plaintext, key, options) {
    const subtle = ensureWebCrypto();
    const config = options || {};
    const iv = config.iv
      ? normalizeUint8(config.iv, 'IV')
      : globalScope.crypto.getRandomValues(new Uint8Array(config.ivLength || 12));
    const additionalData = config.additionalData
      ? normalizeUint8(config.additionalData, 'Additional data')
      : undefined;

    let plaintextBytes;
    if (plaintext instanceof Uint8Array || plaintext instanceof ArrayBuffer) {
      plaintextBytes = normalizeUint8(plaintext, 'Plaintext');
    } else if (typeof plaintext === 'string') {
      plaintextBytes = textEncoder.encode(plaintext);
    } else {
      plaintextBytes = textEncoder.encode(JSON.stringify(plaintext));
    }

    const params = {
      name: 'AES-GCM',
      iv: iv,
      tagLength: config.tagLength || 128
    };
    if (additionalData !== undefined) {
      params.additionalData = additionalData;
    }

    const ciphertext = await subtle.encrypt(params, key, plaintextBytes);

    return {
      iv: toBase64(iv),
      ciphertext: toBase64(new Uint8Array(ciphertext))
    };
  }

  async function decryptAesGcm(payload, key, options) {
    const subtle = ensureWebCrypto();
    const config = options || {};
    if (!payload || typeof payload.iv !== 'string' || typeof payload.ciphertext !== 'string') {
      throw new TypeError('Payload must include Base64 encoded iv and ciphertext fields.');
    }

    const iv = fromBase64(payload.iv);
    const ciphertext = fromBase64(payload.ciphertext);
    const additionalData = config.additionalData
      ? normalizeUint8(config.additionalData, 'Additional data')
      : undefined;

    const params = {
      name: 'AES-GCM',
      iv: iv,
      tagLength: config.tagLength || 128
    };
    if (additionalData !== undefined) {
      params.additionalData = additionalData;
    }

    const plaintextBuffer = await subtle.decrypt(params, key, ciphertext);

    const plaintext = textDecoder.decode(plaintextBuffer);
    if (config.parseJson === false) {
      return plaintext;
    }

    try {
      return JSON.parse(plaintext);
    } catch (error) {
      return plaintext;
    }
  }

  const api = {
    toBase64: toBase64,
    fromBase64: fromBase64,
    deriveKeys: deriveKeys,
    generateRsaOaepKeyPair: generateRsaOaepKeyPair,
    generateVaultKey: generateVaultKey,
    wrapVaultKey: wrapVaultKey,
    unwrapVaultKey: unwrapVaultKey,
    encryptAesGcm: encryptAesGcm,
    decryptAesGcm: decryptAesGcm
  };

  if (typeof globalScope !== 'undefined') {
    globalScope.A2ZCrypto = api;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
