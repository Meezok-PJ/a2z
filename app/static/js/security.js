(function (globalScope) {
  "use strict";

  function overwriteString(value) {
    if (typeof value !== "string") {
      return null;
    }
    if (!value.length) {
      return null;
    }
    return "\0".repeat(value.length);
  }

  function zeroizeTypedArray(value) {
    if (ArrayBuffer.isView(value) && typeof value.fill === "function") {
      value.fill(0);
      return null;
    }
    return value;
  }

  function zeroizeArrayBuffer(value) {
    if (!(value instanceof ArrayBuffer)) {
      return value;
    }
    new Uint8Array(value).fill(0);
    return null;
  }

  function wipeValue(value, seen) {
    if (value === null || value === undefined) {
      return null;
    }

    if (typeof value === "string") {
      return overwriteString(value);
    }

    if (typeof value === "number" || typeof value === "boolean") {
      return null;
    }

    const zeroizedView = zeroizeTypedArray(value);
    if (zeroizedView === null) {
      return null;
    }

    const zeroizedBuffer = zeroizeArrayBuffer(value);
    if (zeroizedBuffer === null) {
      return null;
    }

    if (typeof value === "object") {
      if (seen.has(value)) {
        return null;
      }
      seen.add(value);

      if (Array.isArray(value)) {
        for (let index = 0; index < value.length; index += 1) {
          value[index] = wipeValue(value[index], seen);
        }
        value.length = 0;
        return null;
      }

      const keys = Object.keys(value);
      for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index];
        value[key] = wipeValue(value[key], seen);
      }
      return null;
    }

    return null;
  }

  function wipeStateObject(stateObject) {
    if (!stateObject || typeof stateObject !== "object") {
      return;
    }
    wipeValue(stateObject, new WeakSet());
  }

  function wipeInputValue(inputElement) {
    if (!inputElement || typeof inputElement.value !== "string") {
      return;
    }
    const masked = overwriteString(inputElement.value);
    inputElement.value = masked || "";
    inputElement.value = "";
  }

  function wipeTextContent(node) {
    if (!node || typeof node.textContent !== "string") {
      return;
    }
    const masked = overwriteString(node.textContent);
    node.textContent = masked || "";
    node.textContent = "";
  }

  function wipeVolatileState(config) {
    const settings = config || {};
    const stateObjects = settings.stateObjects || [];
    const inputElements = settings.inputElements || [];
    const textNodes = settings.textNodes || [];

    for (let i = 0; i < stateObjects.length; i += 1) {
      wipeStateObject(stateObjects[i]);
    }
    for (let j = 0; j < inputElements.length; j += 1) {
      wipeInputValue(inputElements[j]);
    }
    for (let k = 0; k < textNodes.length; k += 1) {
      wipeTextContent(textNodes[k]);
    }
  }

  globalScope.A2ZSecurity = {
    wipeStateObject: wipeStateObject,
    wipeInputValue: wipeInputValue,
    wipeVolatileState: wipeVolatileState
  };
})(typeof window !== "undefined" ? window : globalThis);
