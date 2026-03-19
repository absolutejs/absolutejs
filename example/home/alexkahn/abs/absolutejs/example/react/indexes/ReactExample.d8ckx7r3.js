import"../../../../../../../absolutejs/chunk-p8z78vkd.js";

// types/client.ts
var hmrState = {
  isConnected: false,
  isFirstHMRUpdate: true,
  isHMRUpdating: false,
  pingInterval: null,
  reconnectTimeout: null
};

// src/dev/client/constants.ts
var ANGULAR_INIT_TIMEOUT_MS = 500;
var CSS_ERROR_RESOLVE_DELAY_MS = 50;
var CSS_MAX_CHECK_ATTEMPTS = 10;
var CSS_MAX_PARSE_TIMEOUT_MS = 500;
var CSS_SHEET_READY_TIMEOUT_MS = 100;
var DOM_UPDATE_DELAY_MS = 50;
var FOCUS_ID_PREFIX_LENGTH = 3;
var FOCUS_IDX_PREFIX_LENGTH = 4;
var FOCUS_NAME_PREFIX_LENGTH = 5;
var HMR_UPDATE_TIMEOUT_MS = 2000;
var MAX_RECONNECT_ATTEMPTS = 60;
var OVERLAY_FADE_DURATION_MS = 150;
var PING_INTERVAL_MS = 30000;
var RAF_BATCH_COUNT = 3;
var REBUILD_RELOAD_DELAY_MS = 200;
var RECONNECT_INITIAL_DELAY_MS = 500;
var RECONNECT_POLL_INTERVAL_MS = 300;
var SVELTE_CSS_LOAD_TIMEOUT_MS = 500;
var UNFOUND_INDEX = -1;
var WEBSOCKET_NORMAL_CLOSURE = 1000;

// src/dev/client/frameworkDetect.ts
var detectCurrentFramework = () => {
  if (window.__HMR_FRAMEWORK__)
    return window.__HMR_FRAMEWORK__;
  const path = window.location.pathname;
  if (path === "/vue" || path.startsWith("/vue/"))
    return "vue";
  if (path === "/svelte" || path.startsWith("/svelte/"))
    return "svelte";
  if (path === "/angular" || path.startsWith("/angular/"))
    return "angular";
  if (path === "/htmx" || path.startsWith("/htmx/"))
    return "htmx";
  if (path === "/html" || path.startsWith("/html/"))
    return "html";
  if (path === "/")
    return "html";
  if (path === "/react" || path.startsWith("/react/"))
    return "react";
  if (window.__REACT_ROOT__)
    return "react";
  return null;
};
var findIndexPath = (manifest, sourceFile, framework) => {
  if (!manifest)
    return null;
  if (sourceFile) {
    const componentName = getComponentNameFromPath(sourceFile);
    const indexKey = componentName ? `${componentName}Index` : null;
    if (indexKey && manifest[indexKey]) {
      return manifest[indexKey];
    }
  }
  const frameworkPatterns = {
    angular: /angular/i,
    react: /react/i,
    svelte: /svelte/i,
    vue: /vue/i
  };
  const pattern = frameworkPatterns[framework];
  for (const key in manifest) {
    const value = manifest[key];
    if (key.endsWith("Index") && value && (!pattern || pattern.test(key) || value.includes(`/${framework}/`))) {
      return value;
    }
  }
  return null;
};
var getComponentNameFromPath = (filePath) => {
  if (!filePath)
    return null;
  const parts = filePath.replace(/\\/g, "/").split("/");
  const fileName = parts[parts.length - 1] || "";
  const baseName = fileName.replace(/\.(tsx?|jsx?|vue|svelte|html)$/, "");
  return baseName.split(/[-_]/).map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join("");
};

// src/dev/client/errorOverlay.ts
var errorOverlayElement = null;
var currentOverlayKind = null;
var frameworkLabels = {
  angular: "Angular",
  assets: "Assets",
  html: "HTML",
  htmx: "HTMX",
  react: "React",
  svelte: "Svelte",
  unknown: "Unknown",
  vue: "Vue"
};
var frameworkColors = {
  angular: "#dd0031",
  assets: "#563d7c",
  html: "#e34c26",
  htmx: "#1a365d",
  react: "#61dafb",
  svelte: "#ff3e00",
  unknown: "#94a3b8",
  vue: "#42b883"
};
var removeOverlayElement = () => {
  if (errorOverlayElement && errorOverlayElement.parentNode) {
    errorOverlayElement.parentNode.removeChild(errorOverlayElement);
  }
  errorOverlayElement = null;
  currentOverlayKind = null;
};
var hideErrorOverlay = () => {
  const elm = errorOverlayElement;
  if (!elm || !elm.parentNode) {
    removeOverlayElement();
    return;
  }
  elm.style.transition = "opacity 150ms ease-out";
  elm.style.opacity = "0";
  errorOverlayElement = null;
  currentOverlayKind = null;
  setTimeout(() => {
    if (elm.parentNode)
      elm.parentNode.removeChild(elm);
  }, OVERLAY_FADE_DURATION_MS);
};
var isRuntimeErrorOverlay = () => currentOverlayKind === "runtime";
var buildLocationSection = (file, line, column, lineText) => {
  if (!file && line === undefined && column === undefined && !lineText) {
    return null;
  }
  const locSection = document.createElement("div");
  locSection.style.cssText = "margin-bottom:20px;";
  const locLabel = document.createElement("div");
  locLabel.style.cssText = "font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:#94a3b8;margin-bottom:8px;";
  locLabel.textContent = "Where";
  locSection.appendChild(locLabel);
  const locParts = [];
  if (file)
    locParts.push(file);
  if (line !== undefined)
    locParts.push(String(line));
  if (column !== undefined)
    locParts.push(String(column));
  const loc = locParts.join(":") || "Unknown location";
  const locEl = document.createElement("div");
  locEl.style.cssText = "padding:12px 20px;background:rgba(71,85,105,0.3);border-radius:10px;border:1px solid rgba(71,85,105,0.4);color:#cbd5e1;font-size:13px;";
  locEl.textContent = loc;
  locSection.appendChild(locEl);
  if (lineText) {
    const codeBlock = document.createElement("pre");
    codeBlock.style.cssText = "margin:8px 0 0;padding:14px 20px;background:rgba(15,23,42,0.8);border-radius:10px;border:1px solid rgba(71,85,105,0.4);color:#94a3b8;font-size:13px;overflow-x:auto;white-space:pre;";
    codeBlock.textContent = lineText;
    locSection.appendChild(codeBlock);
  }
  return locSection;
};
var showErrorOverlay = (opts) => {
  const message = opts.message || "Build failed";
  const { file } = opts;
  const { line } = opts;
  const { column } = opts;
  const { lineText } = opts;
  const framework = (opts.framework || "unknown").toLowerCase();
  const frameworkLabel = frameworkLabels[framework] || framework;
  const accent = frameworkColors[framework] || "#94a3b8";
  removeOverlayElement();
  currentOverlayKind = opts.kind || "compilation";
  const overlay = document.createElement("div");
  overlay.id = "absolutejs-error-overlay";
  overlay.setAttribute("data-hmr-overlay", "true");
  overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:linear-gradient(135deg,rgba(15,23,42,0.98) 0%,rgba(30,41,59,0.98) 100%);backdrop-filter:blur(12px);color:#e2e8f0;font-family:"JetBrains Mono","Fira Code",ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:14px;line-height:1.6;overflow:auto;padding:32px;box-sizing:border-box;display:flex;align-items:flex-start;justify-content:center;';
  const card = document.createElement("div");
  card.style.cssText = "max-width:720px;width:100%;background:rgba(30,41,59,0.6);border:1px solid rgba(71,85,105,0.5);border-radius:16px;box-shadow:0 25px 50px -12px rgba(0,0,0,0.5),0 0 0 1px rgba(255,255,255,0.05);overflow:hidden;";
  const header = document.createElement("div");
  header.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:16px;padding:20px 24px;background:rgba(15,23,42,0.5);border-bottom:1px solid rgba(71,85,105,0.4);";
  header.innerHTML = `<div style="display:flex;align-items:center;gap:12px;"><span style="font-weight:700;font-size:20px;color:#fff;letter-spacing:-0.02em;">AbsoluteJS</span><span style="padding:5px 10px;border-radius:8px;font-size:12px;font-weight:600;background:${accent};color:#fff;opacity:0.95;box-shadow:0 2px 4px rgba(0,0,0,0.2);">${frameworkLabel}</span></div><span style="color:#94a3b8;font-size:13px;font-weight:500;">${opts.kind === "runtime" ? "Runtime Error" : "Compilation Error"}</span>`;
  card.appendChild(header);
  const content = document.createElement("div");
  content.style.cssText = "padding:24px;";
  const errorSection = document.createElement("div");
  errorSection.style.cssText = "margin-bottom:20px;";
  const errorLabel = document.createElement("div");
  errorLabel.style.cssText = "font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:#94a3b8;margin-bottom:8px;";
  errorLabel.textContent = "What went wrong";
  errorSection.appendChild(errorLabel);
  const msgEl = document.createElement("pre");
  msgEl.style.cssText = "margin:0;padding:16px 20px;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.25);border-radius:10px;overflow-x:auto;white-space:pre-wrap;word-break:break-word;color:#fca5a5;font-size:13px;line-height:1.5;";
  msgEl.textContent = message;
  errorSection.appendChild(msgEl);
  content.appendChild(errorSection);
  const locSection = buildLocationSection(file, line, column, lineText);
  if (locSection) {
    content.appendChild(locSection);
  }
  const footer = document.createElement("div");
  footer.style.cssText = "display:flex;justify-content:flex-end;padding-top:8px;";
  const dismiss = document.createElement("button");
  dismiss.textContent = "Dismiss";
  dismiss.style.cssText = `padding:10px 20px;background:${accent};color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.2);transition:opacity 0.15s,transform 0.15s;`;
  dismiss.onmouseover = function() {
    dismiss.style.opacity = "0.9";
    dismiss.style.transform = "translateY(-1px)";
  };
  dismiss.onmouseout = function() {
    dismiss.style.opacity = "1";
    dismiss.style.transform = "translateY(0)";
  };
  dismiss.onclick = hideErrorOverlay;
  footer.appendChild(dismiss);
  content.appendChild(footer);
  card.appendChild(content);
  overlay.appendChild(card);
  if (!document.body)
    return;
  document.body.appendChild(overlay);
  errorOverlayElement = overlay;
};

// src/dev/client/domState.ts
var trySetSelectionRange = (element, start, end) => {
  try {
    element.setSelectionRange(start, end);
  } catch {}
};
var restoreSelectionRange = (element, entry) => {
  if (entry.selStart === undefined || entry.selEnd === undefined || !element.setSelectionRange)
    return;
  trySetSelectionRange(element, entry.selStart, entry.selEnd);
};
var restoreInputEntry = (target, entry) => {
  if (!(target instanceof HTMLInputElement))
    return;
  const input = target;
  const type = entry.type || input.getAttribute("type") || "text";
  if (type === "checkbox" || type === "radio") {
    if (entry.checked !== undefined)
      input.checked = entry.checked;
  } else if (entry.value !== undefined) {
    input.value = entry.value;
  }
  restoreSelectionRange(input, entry);
};
var restoreTextareaEntry = (target, entry) => {
  if (!(target instanceof HTMLTextAreaElement))
    return;
  const textarea = target;
  if (entry.value !== undefined)
    textarea.value = entry.value;
  restoreSelectionRange(textarea, entry);
};
var restoreSelectEntry = (target, entry) => {
  if (!Array.isArray(entry.values))
    return;
  if (!(target instanceof HTMLSelectElement))
    return;
  const select = target;
  const { values } = entry;
  Array.from(select.options).forEach((opt) => {
    opt.selected = values.indexOf(opt.value) !== UNFOUND_INDEX;
  });
};
var restoreEntry = (target, entry) => {
  if (target.tagName === "INPUT") {
    restoreInputEntry(target, entry);
    return;
  }
  if (target.tagName === "TEXTAREA") {
    restoreTextareaEntry(target, entry);
    return;
  }
  if (target.tagName === "SELECT") {
    restoreSelectEntry(target, entry);
    return;
  }
  if (target.tagName === "OPTION") {
    if (entry.selected !== undefined && target instanceof HTMLOptionElement)
      target.selected = entry.selected;
    return;
  }
  if (target.tagName === "DETAILS") {
    if (entry.open !== undefined && target instanceof HTMLDetailsElement)
      target.open = entry.open;
    return;
  }
  if (target.getAttribute("contenteditable") === "true") {
    if (entry.text !== undefined)
      target.textContent = entry.text;
  }
};
var findEntryTarget = (root, elements, entry) => {
  if (entry.id)
    return root.querySelector(`#${CSS.escape(entry.id)}`);
  if (entry.name)
    return root.querySelector(`[name="${CSS.escape(entry.name)}"]`);
  if (elements[entry.idx])
    return elements[entry.idx] ?? null;
  return null;
};
var resolveFocusElement = (root, elements, activeKey) => {
  if (activeKey.startsWith("id:"))
    return root.querySelector(`#${CSS.escape(activeKey.slice(FOCUS_ID_PREFIX_LENGTH))}`);
  if (activeKey.startsWith("name:"))
    return root.querySelector(`[name="${CSS.escape(activeKey.slice(FOCUS_NAME_PREFIX_LENGTH))}"]`);
  if (!activeKey.startsWith("idx:"))
    return null;
  const idx = parseInt(activeKey.slice(FOCUS_IDX_PREFIX_LENGTH), 10);
  if (isNaN(idx) || !elements[idx])
    return null;
  return elements[idx];
};
var restoreDOMState = (root, snapshot) => {
  if (!snapshot || !snapshot.items)
    return;
  const selector = 'input, textarea, select, option, [contenteditable="true"], details';
  const elements = root.querySelectorAll(selector);
  snapshot.items.forEach((entry) => {
    const target = findEntryTarget(root, elements, entry);
    if (!target)
      return;
    restoreEntry(target, entry);
  });
  if (!snapshot.activeKey)
    return;
  const focusEl = resolveFocusElement(root, elements, snapshot.activeKey);
  if (focusEl instanceof HTMLElement) {
    focusEl.focus();
  }
};
var resolveFormElement = (isStandalone, form, name) => {
  if (isStandalone) {
    const element = document.querySelector(`input[name="${name}"], textarea[name="${name}"], select[name="${name}"]`);
    if (element)
      return element;
    const byId = document.getElementById(name);
    if (byId instanceof HTMLInputElement)
      return byId;
    return null;
  }
  if (!form)
    return null;
  const found = form.querySelector(`[name="${name}"], #${name}`);
  if (found instanceof HTMLInputElement || found instanceof HTMLTextAreaElement || found instanceof HTMLSelectElement)
    return found;
  return null;
};
var applyFormValue = (element, value) => {
  if (element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio")) {
    element.checked = value === true;
    return;
  }
  element.value = String(value);
};
var resolveForm = (formId) => {
  const formIndex = parseInt(formId.replace("form-", ""));
  const form = document.getElementById(formId);
  if (form)
    return form;
  if (isNaN(formIndex))
    return null;
  try {
    return document.querySelector(`form:nth-of-type(${formIndex + 1})`);
  } catch {
    return null;
  }
};
var restoreRadioGroup = (isStandalone, form, groupName, selectedValue) => {
  const scope = isStandalone ? document : form;
  if (!scope)
    return;
  const escapedName = CSS.escape(groupName);
  const escapedValue = CSS.escape(selectedValue);
  const radio = scope.querySelector(`input[type="radio"][name="${escapedName}"][value="${escapedValue}"]`);
  if (radio) {
    radio.checked = true;
  }
};
var RADIO_PREFIX = "__radio__";
var restoreFormState = (formState) => {
  Object.keys(formState).forEach((formId) => {
    const isStandalone = formId === "__standalone__";
    const form = isStandalone ? null : resolveForm(formId);
    const formData = formState[formId];
    if (!formData)
      return;
    Object.keys(formData).forEach((name) => {
      if (name.startsWith(RADIO_PREFIX)) {
        const groupName = name.slice(RADIO_PREFIX.length);
        const value2 = formData[name];
        if (value2 === undefined)
          return;
        restoreRadioGroup(isStandalone, form, groupName, String(value2));
        return;
      }
      const element = resolveFormElement(isStandalone, form, name);
      if (!element)
        return;
      const value = formData[name];
      if (value === undefined)
        return;
      applyFormValue(element, value);
    });
  });
};
var restoreScrollState = (scrollState) => {
  if (scrollState && scrollState.window) {
    window.scrollTo(scrollState.window.x, scrollState.window.y);
  }
};
var saveInputEntry = (elem, entry) => {
  if (!(elem instanceof HTMLInputElement))
    return;
  const input = elem;
  const type = input.getAttribute("type") || "text";
  entry.type = type;
  if (type === "checkbox" || type === "radio") {
    entry.checked = input.checked;
  } else {
    entry.value = input.value;
  }
  if (input.selectionStart !== null && input.selectionEnd !== null) {
    entry.selStart = input.selectionStart;
    entry.selEnd = input.selectionEnd;
  }
};
var saveTextareaEntry = (elem, entry) => {
  if (!(elem instanceof HTMLTextAreaElement))
    return;
  const textarea = elem;
  entry.value = textarea.value;
  if (textarea.selectionStart !== null && textarea.selectionEnd !== null) {
    entry.selStart = textarea.selectionStart;
    entry.selEnd = textarea.selectionEnd;
  }
};
var saveSelectEntry = (elem, entry) => {
  if (!(elem instanceof HTMLSelectElement))
    return;
  const select = elem;
  const vals = [];
  Array.from(select.options).forEach((opt) => {
    if (opt.selected)
      vals.push(opt.value);
  });
  entry.values = vals;
};
var saveElementEntry = (elem, entry) => {
  if (elem.tagName === "INPUT") {
    saveInputEntry(elem, entry);
    return;
  }
  if (elem.tagName === "TEXTAREA") {
    saveTextareaEntry(elem, entry);
    return;
  }
  if (elem.tagName === "SELECT") {
    saveSelectEntry(elem, entry);
    return;
  }
  if (elem.tagName === "OPTION") {
    if (elem instanceof HTMLOptionElement)
      entry.selected = elem.selected;
    return;
  }
  if (elem.tagName === "DETAILS") {
    if (elem instanceof HTMLDetailsElement)
      entry.open = elem.open;
    return;
  }
  if (elem.getAttribute("contenteditable") === "true") {
    entry.text = elem.textContent || undefined;
  }
};
var saveDOMState = (root) => {
  const snapshot = { activeKey: null, items: [] };
  const selector = 'input, textarea, select, option, [contenteditable="true"], details';
  const elements = root.querySelectorAll(selector);
  elements.forEach((el, idx) => {
    const entry = {
      idx,
      tag: el.tagName.toLowerCase()
    };
    const id2 = el.getAttribute("id");
    const name2 = el.getAttribute("name");
    if (id2)
      entry.id = id2;
    else if (name2)
      entry.name = name2;
    saveElementEntry(el, entry);
    snapshot.items.push(entry);
  });
  const active = document.activeElement;
  if (!active || !root.contains(active))
    return snapshot;
  const id = active.getAttribute("id");
  const name = active.getAttribute("name");
  if (id)
    snapshot.activeKey = `id:${id}`;
  else if (name)
    snapshot.activeKey = `name:${name}`;
  else
    snapshot.activeKey = `idx:${Array.prototype.indexOf.call(elements, active)}`;
  return snapshot;
};
var collectInputState = (element, name, target) => {
  if (element.type === "radio") {
    if (element.checked)
      target[`__radio__${name}`] = element.value;
    return;
  }
  if (element.type === "checkbox") {
    target[name] = element.checked;
    return;
  }
  target[name] = element.value;
};
var saveFormState = () => {
  const formState = {};
  const forms = document.querySelectorAll("form");
  forms.forEach((form, formIndex) => {
    const formId = form.id || `form-${formIndex}`;
    const formData = {};
    formState[formId] = formData;
    const inputs = form.querySelectorAll("input, textarea, select");
    inputs.forEach((input) => {
      if (!(input instanceof HTMLInputElement))
        return;
      const name = input.name || input.id || `input-${formIndex}-${inputs.length}`;
      collectInputState(input, name, formData);
    });
  });
  const standaloneInputs = document.querySelectorAll("input:not(form input), textarea:not(form textarea), select:not(form select)");
  if (standaloneInputs.length <= 0)
    return formState;
  const standaloneData = {};
  formState["__standalone__"] = standaloneData;
  standaloneInputs.forEach((input) => {
    if (!(input instanceof HTMLInputElement))
      return;
    const name = input.name || input.id || `standalone-${standaloneInputs.length}`;
    collectInputState(input, name, standaloneData);
  });
  return formState;
};
var saveScrollState = () => {
  const scrollX = window.scrollX || window.pageXOffset;
  const scrollY = window.scrollY || window.pageYOffset;
  return {
    window: { x: scrollX, y: scrollY }
  };
};

// src/dev/client/handlers/angular.ts
var swapStylesheet = (cssUrl, cssBaseName, framework) => {
  let existingLink = null;
  document.querySelectorAll('link[rel="stylesheet"]').forEach((link) => {
    const linkEl = link instanceof HTMLLinkElement ? link : null;
    const href = linkEl?.getAttribute("href") ?? "";
    if (href.includes(cssBaseName) || href.includes(framework)) {
      existingLink = linkEl;
    }
  });
  if (!existingLink)
    return;
  const capturedExisting = existingLink;
  const newLink = document.createElement("link");
  newLink.rel = "stylesheet";
  newLink.href = `${cssUrl}?t=${Date.now()}`;
  newLink.onload = function() {
    if (capturedExisting && capturedExisting.parentNode)
      capturedExisting.remove();
  };
  document.head.appendChild(newLink);
};
var readDomCounter = (element, properties) => {
  element.querySelectorAll('[class*="value"], [class*="count"]').forEach((stateEl) => {
    const text = stateEl.textContent;
    if (text === null || text.trim() === "")
      return;
    const num = parseInt(text.trim(), 10);
    if (!isNaN(num))
      properties["__dom_counter"] = num;
  });
};
var copyInstanceProperty = (instance, key, properties) => {
  if (key.startsWith("ɵ") || key.startsWith("__"))
    return;
  const val = instance[key];
  if (typeof val === "function")
    return;
  properties[key] = val;
};
var captureInstanceProperties = (ngApi, element, properties) => {
  if (!ngApi || typeof ngApi.getComponent !== "function")
    return;
  try {
    const instance = ngApi.getComponent(element);
    if (!instance)
      return;
    const record = instance;
    Object.keys(record).forEach((key) => {
      copyInstanceProperty(record, key, properties);
    });
  } catch {}
};
var captureComponentState = () => {
  const snapshots = [];
  const selectorCounts = new Map;
  const ngApi = window.ng;
  document.querySelectorAll("*").forEach((elem) => {
    const tagName = elem.tagName.toLowerCase();
    if (!tagName.includes("-"))
      return;
    const count = selectorCounts.get(tagName) || 0;
    selectorCounts.set(tagName, count + 1);
    const properties = {};
    readDomCounter(elem, properties);
    captureInstanceProperties(ngApi, elem, properties);
    if (Object.keys(properties).length > 0) {
      snapshots.push({ index: count, properties, selector: tagName });
    }
  });
  return snapshots;
};
var safeSetProperty = (instance, key, value) => {
  try {
    instance[key] = value;
  } catch {}
};
var restoreInstanceProperties = (instance, snap) => {
  const domCounter = snap.properties["__dom_counter"];
  Object.entries(snap.properties).forEach(([key, value]) => {
    if (key === "__dom_counter")
      return;
    safeSetProperty(instance, key, value);
  });
  if (domCounter !== undefined && typeof domCounter === "number" && "count" in instance) {
    instance["count"] = domCounter;
  }
};
var restoreViaInstance = (ngApi, element, snap) => {
  if (!ngApi || typeof ngApi.getComponent !== "function")
    return false;
  try {
    const instance = ngApi.getComponent(element);
    if (!instance)
      return false;
    const record = instance;
    restoreInstanceProperties(record, snap);
    if (typeof ngApi.applyChanges === "function")
      ngApi.applyChanges(element);
    return true;
  } catch {
    return false;
  }
};
var restoreDomFallback = (element, snap) => {
  const domCounter = snap.properties["__dom_counter"];
  if (domCounter === undefined)
    return;
  element.querySelectorAll('[class*="value"], [class*="count"]').forEach((counterEl) => {
    counterEl.textContent = String(domCounter);
  });
};
var restoreComponentState = (snapshots) => {
  const ngApi = window.ng;
  if (snapshots.length === 0)
    return;
  const bySelector = new Map;
  for (const snap of snapshots) {
    const list = bySelector.get(snap.selector) || [];
    list.push(snap);
    bySelector.set(snap.selector, list);
  }
  bySelector.forEach((snaps, selector) => {
    const elements = document.querySelectorAll(selector);
    snaps.forEach((snap) => {
      const element = elements[snap.index];
      if (!element)
        return;
      const restored = restoreViaInstance(ngApi, element, snap);
      if (!restored)
        restoreDomFallback(element, snap);
    });
  });
};
var waitForAngularApp = () => {
  if (window.__ANGULAR_APP__)
    return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, ANGULAR_INIT_TIMEOUT_MS);
    let stored = window.__ANGULAR_APP__;
    Object.defineProperty(window, "__ANGULAR_APP__", {
      configurable: true,
      enumerable: true,
      get() {
        return stored;
      },
      set(val) {
        stored = val;
        Object.defineProperty(window, "__ANGULAR_APP__", {
          configurable: true,
          enumerable: true,
          value: val,
          writable: true
        });
        clearTimeout(timeout);
        resolve();
      }
    });
  });
};
var suppressNg0912 = () => {
  const origWarn = console.warn;
  console.warn = function(...args) {
    if (typeof args[0] === "string" && args[0].includes("NG0912"))
      return;
    origWarn.apply(console, args);
  };
  return origWarn;
};
var handleAngularUpdate = (message) => {
  if (detectCurrentFramework() !== "angular")
    return;
  const updateType = message.data.updateType || "logic";
  if ((updateType === "style" || updateType === "css-only") && message.data.cssUrl) {
    swapStylesheet(message.data.cssUrl, message.data.cssBaseName || "", "angular");
    return;
  }
  handleFullUpdate(message);
};
var findRootSelector = (container) => {
  const candidates = container.querySelectorAll("*");
  for (let idx = 0;idx < candidates.length; idx++) {
    const candidate = candidates[idx];
    if (!candidate)
      continue;
    const tag = candidate.tagName.toLowerCase();
    if (tag.includes("-"))
      return tag;
  }
  return null;
};
var destroyAngularApp = () => {
  if (!window.__ANGULAR_APP__)
    return;
  try {
    window.__ANGULAR_APP__.destroy();
  } catch {}
  window.__ANGULAR_APP__ = null;
};
var bootstrapAngularModule = async (indexPath, rootSelector, rootContainer) => {
  if (rootSelector && !rootContainer.querySelector(rootSelector)) {
    rootContainer.appendChild(document.createElement(rootSelector));
  }
  window.__HMR_SKIP_HYDRATION__ = true;
  const origWarn = suppressNg0912();
  await import(`${indexPath}?t=${Date.now()}`);
  await waitForAngularApp();
  console.warn = origWarn;
};
var tickAngularApp = () => {
  if (!window.__ANGULAR_APP__)
    return;
  try {
    window.__ANGULAR_APP__.tick();
  } catch {}
};
var runWithViewTransition = (updateFn) => {
  const doc = document;
  if (typeof doc.startViewTransition !== "function") {
    updateFn().catch((err) => {
      console.warn("[HMR] Angular update failed (non-fatal):", err);
    });
    return;
  }
  let styleEl = null;
  try {
    styleEl = document.createElement("style");
    styleEl.textContent = "::view-transition-old(root),::view-transition-new(root){animation:none!important}";
    document.head.appendChild(styleEl);
  } catch {}
  const removeStyle = () => {
    if (styleEl && styleEl.parentNode)
      styleEl.remove();
  };
  doc.startViewTransition(async () => {
    await updateFn();
  }).finished.then(removeStyle).catch(removeStyle);
};
var handleFullUpdate = (message) => {
  const componentState = captureComponentState();
  const scrollState = saveScrollState();
  const formState = saveFormState();
  if (message.data.cssUrl) {
    swapStylesheet(message.data.cssUrl, message.data.cssBaseName || "", "angular");
  }
  const rootContainer = document.getElementById("root") || document.body;
  const rootSelector = findRootSelector(rootContainer);
  const indexPath = findIndexPath(message.data.manifest, message.data.sourceFile, "angular");
  if (!indexPath)
    return;
  const doUpdate = async () => {
    destroyAngularApp();
    await bootstrapAngularModule(indexPath, rootSelector, rootContainer);
    restoreComponentState(componentState);
    tickAngularApp();
    restoreFormState(formState);
    restoreScrollState(scrollState);
  };
  runWithViewTransition(doUpdate);
};

// src/dev/client/handlers/react.ts
var handleReactUpdate = (message) => {
  const currentFramework = detectCurrentFramework();
  if (currentFramework !== "react")
    return;
  const hasComponentChanges = message.data.hasComponentChanges !== false;
  const hasCSSChanges = message.data.hasCSSChanges === true;
  const cssPath = message.data.manifest && message.data.manifest.ReactExampleCSS;
  if (!hasComponentChanges && hasCSSChanges && cssPath) {
    reloadReactCSS(cssPath);
    return;
  }
  const componentKey = window.__REACT_COMPONENT_KEY__;
  const newUrl = componentKey && message.data.manifest?.[componentKey];
  const refreshRuntime = window.$RefreshRuntime$;
  if (newUrl && refreshRuntime) {
    import(`${newUrl}?t=${Date.now()}`).then(() => {
      refreshRuntime.performReactRefresh();
      if (window.__ERROR_BOUNDARY__) {
        window.__ERROR_BOUNDARY__.reset();
      } else {
        hideErrorOverlay();
      }
      return;
    }).catch((err) => {
      console.warn("[HMR] React Fast Refresh failed, falling back to reload:", err);
      window.location.reload();
    });
    return;
  }
  window.location.reload();
};
var reloadReactCSS = (cssPath) => {
  const existingCSSLinks = document.head.querySelectorAll('link[rel="stylesheet"]');
  existingCSSLinks.forEach((link) => {
    const href = link.getAttribute("href");
    if (!href) {
      return;
    }
    const hrefBase = (href.split("?")[0] ?? "").split("/").pop() ?? "";
    const cssPathBase = (cssPath.split("?")[0] ?? "").split("/").pop() ?? "";
    if (hrefBase === cssPathBase || href.includes("react-example") || cssPathBase.includes(hrefBase)) {
      const newHref = `${cssPath + (cssPath.includes("?") ? "&" : "?")}t=${Date.now()}`;
      link.href = newHref;
    }
  });
};

// src/dev/client/domDiff.ts
var getElementKey = (elem, index) => {
  if (elem.nodeType !== Node.ELEMENT_NODE)
    return `text_${index}`;
  if (!(elem instanceof Element))
    return `text_${index}`;
  if (elem.id)
    return `id_${elem.id}`;
  if (elem.hasAttribute("data-key"))
    return `key_${elem.getAttribute("data-key")}`;
  return `tag_${elem.tagName}_${index}`;
};
var updateElementAttributes = (oldEl, newEl) => {
  const newAttrs = Array.from(newEl.attributes);
  const oldAttrs = Array.from(oldEl.attributes);
  const runtimeAttrs = ["data-hmr-listeners-attached"];
  oldAttrs.forEach((oldAttr) => {
    if (!newEl.hasAttribute(oldAttr.name) && runtimeAttrs.indexOf(oldAttr.name) === UNFOUND_INDEX) {
      oldEl.removeAttribute(oldAttr.name);
    }
  });
  newAttrs.forEach((newAttr) => {
    if (runtimeAttrs.indexOf(newAttr.name) !== UNFOUND_INDEX && oldEl.hasAttribute(newAttr.name)) {
      return;
    }
    const oldValue = oldEl.getAttribute(newAttr.name);
    if (oldValue !== newAttr.value) {
      oldEl.setAttribute(newAttr.name, newAttr.value);
    }
  });
};
var updateTextNode = (oldNode, newNode) => {
  if (oldNode.nodeValue !== newNode.nodeValue) {
    oldNode.nodeValue = newNode.nodeValue;
  }
};
var matchChildren = (oldChildren, newChildren) => {
  const oldMap = new Map;
  const newMap = new Map;
  oldChildren.forEach((child, idx) => {
    const key = getElementKey(child, idx);
    if (!oldMap.has(key)) {
      oldMap.set(key, []);
    }
    oldMap.get(key)?.push({ index: idx, node: child });
  });
  newChildren.forEach((child, idx) => {
    const key = getElementKey(child, idx);
    if (!newMap.has(key)) {
      newMap.set(key, []);
    }
    newMap.get(key)?.push({ index: idx, node: child });
  });
  return { newMap, oldMap };
};
var isHMRScript = (elem) => elem instanceof Element && elem.hasAttribute("data-hmr-client");
var isHMRPreserved = (elem) => isHMRScript(elem) || elem instanceof Element && elem.hasAttribute("data-hmr-overlay");
var isNonHMRScript = (child) => child instanceof Element && child.tagName === "SCRIPT";
var findBestMatch = (oldMatches, matchedOld) => {
  const unmatched = oldMatches.find((entry) => !matchedOld.has(entry.node));
  if (unmatched)
    return unmatched;
  if (oldMatches.length > 0)
    return oldMatches[0] ?? null;
  return null;
};
var reconcileChild = (newChild, newIndex, oldMap, matchedOld, parentNode, oldChildrenFiltered) => {
  const newKey = getElementKey(newChild, newIndex);
  const oldMatches = oldMap.get(newKey) || [];
  if (oldMatches.length === 0) {
    const clone2 = newChild.cloneNode(true);
    parentNode.insertBefore(clone2, oldChildrenFiltered[newIndex] || null);
    return;
  }
  const bestMatch = findBestMatch(oldMatches, matchedOld);
  if (bestMatch && !matchedOld.has(bestMatch.node)) {
    matchedOld.add(bestMatch.node);
    patchNode(bestMatch.node, newChild);
    return;
  }
  const clone = newChild.cloneNode(true);
  parentNode.insertBefore(clone, oldChildrenFiltered[newIndex] || null);
};
var patchNode = (oldNode, newNode) => {
  if (oldNode.nodeType === Node.TEXT_NODE && newNode.nodeType === Node.TEXT_NODE) {
    updateTextNode(oldNode, newNode);
    return;
  }
  if (oldNode.nodeType !== Node.ELEMENT_NODE || newNode.nodeType !== Node.ELEMENT_NODE) {
    return;
  }
  if (!(oldNode instanceof Element) || !(newNode instanceof Element))
    return;
  const oldEl = oldNode;
  const newEl = newNode;
  if (oldEl.tagName !== newEl.tagName) {
    const clone = newEl.cloneNode(true);
    oldEl.replaceWith(clone);
    return;
  }
  updateElementAttributes(oldEl, newEl);
  const oldChildren = Array.from(oldNode.childNodes);
  const newChildren = Array.from(newNode.childNodes);
  const oldChildrenFiltered = oldChildren.filter((child) => !isHMRScript(child) && !isNonHMRScript(child));
  const newChildrenFiltered = newChildren.filter((child) => !isHMRScript(child) && !isNonHMRScript(child));
  const { oldMap } = matchChildren(oldChildrenFiltered, newChildrenFiltered);
  const matchedOld = new Set;
  newChildrenFiltered.forEach((newChild, newIndex) => {
    reconcileChild(newChild, newIndex, oldMap, matchedOld, oldNode, oldChildrenFiltered);
  });
  oldChildrenFiltered.forEach((oldChild) => {
    if (!matchedOld.has(oldChild) && !isHMRPreserved(oldChild)) {
      oldChild.remove();
    }
  });
};
var patchDOMInPlace = (oldContainer, newHTML) => {
  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = newHTML;
  const newContainer = tempDiv;
  const oldChildren = Array.from(oldContainer.childNodes);
  const newChildren = Array.from(newContainer.childNodes);
  const oldChildrenFiltered = oldChildren.filter((child) => !(child instanceof Element && child.tagName === "SCRIPT" && !child.hasAttribute("data-hmr-client")));
  const newChildrenFiltered = newChildren.filter((child) => !isNonHMRScript(child));
  const { oldMap } = matchChildren(oldChildrenFiltered, newChildrenFiltered);
  const matchedOld = new Set;
  newChildrenFiltered.forEach((newChild, newIndex) => {
    reconcileChild(newChild, newIndex, oldMap, matchedOld, oldContainer, oldChildrenFiltered);
  });
  oldChildrenFiltered.forEach((oldChild) => {
    if (matchedOld.has(oldChild))
      return;
    if (isHMRPreserved(oldChild))
      return;
    oldChild.remove();
  });
};

// src/dev/client/cssUtils.ts
var getCSSBaseName = (href) => {
  const fileName = href.split("?")[0]?.split("/").pop() || "";
  return fileName.split(".")[0] ?? "";
};
var baseNamesMatch = (baseA, baseB) => baseA === baseB || baseA.includes(baseB) || baseB.includes(baseA);
var findMatchingLink = (baseNew) => {
  const links = document.head.querySelectorAll('link[rel="stylesheet"]');
  for (const existing of links) {
    if (!(existing instanceof HTMLLinkElement))
      continue;
    const existingHref = existing.getAttribute("href") || "";
    const baseExisting = getCSSBaseName(existingHref);
    if (baseNamesMatch(baseExisting, baseNew)) {
      return existing;
    }
  }
  return null;
};
var createTimestampedLink = (href) => {
  const newLinkElement = document.createElement("link");
  newLinkElement.rel = "stylesheet";
  newLinkElement.media = "print";
  const newHref = `${href + (href.includes("?") ? "&" : "?")}t=${Date.now()}`;
  newLinkElement.href = newHref;
  return { newHref, newLinkElement };
};
var processNewLink = (newLink, linksToRemove, linksToActivate, linksToWaitFor) => {
  const href = newLink.getAttribute("href");
  if (!href)
    return;
  const baseNew = getCSSBaseName(href);
  const existingLink = findMatchingLink(baseNew);
  if (!existingLink) {
    const { newHref: newHref2, newLinkElement: newLinkElement2 } = createTimestampedLink(href);
    linksToActivate.push(newLinkElement2);
    const loadPromise2 = createCSSLoadPromise(newLinkElement2, newHref2);
    document.head.appendChild(newLinkElement2);
    linksToWaitFor.push(loadPromise2);
    return;
  }
  const existingHrefAttr = existingLink.getAttribute("href");
  const existingHref = existingHrefAttr ? existingHrefAttr.split("?")[0] : "";
  const [newHrefBase] = href.split("?");
  if (existingHref === newHrefBase)
    return;
  const { newHref, newLinkElement } = createTimestampedLink(href);
  linksToRemove.push(existingLink);
  linksToActivate.push(newLinkElement);
  const loadPromise = createCSSLoadPromise(newLinkElement, newHref);
  document.head.appendChild(newLinkElement);
  linksToWaitFor.push(loadPromise);
};
var processCSSLinks = (headHTML) => {
  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = headHTML;
  const newStylesheets = tempDiv.querySelectorAll('link[rel="stylesheet"]');
  const existingStylesheets = Array.from(document.head.querySelectorAll('link[rel="stylesheet"]'));
  const newHrefs = Array.from(newStylesheets).map((link) => {
    const href = link.getAttribute("href") || "";
    return getCSSBaseName(href);
  });
  const linksToRemove = [];
  const linksToWaitFor = [];
  const linksToActivate = [];
  newStylesheets.forEach((newLink) => {
    processNewLink(newLink, linksToRemove, linksToActivate, linksToWaitFor);
  });
  existingStylesheets.forEach((existingLink) => {
    const existingHref = existingLink.getAttribute("href") || "";
    const baseExisting = getCSSBaseName(existingHref);
    const stillExists = newHrefs.some((newBase) => baseNamesMatch(baseExisting, newBase));
    if (stillExists)
      return;
    const wasHandled = Array.from(newStylesheets).some((newLink) => {
      const newHref = newLink.getAttribute("href") || "";
      const baseNewLocal = getCSSBaseName(newHref);
      return baseNamesMatch(baseExisting, baseNewLocal);
    });
    if (!wasHandled) {
      linksToRemove.push(existingLink);
    }
  });
  return { linksToActivate, linksToRemove, linksToWaitFor };
};
var findManifestHref = (manifest, baseName) => {
  const manifestKey = `${baseName.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join("")}CSS`;
  if (manifest[manifestKey]) {
    return manifest[manifestKey];
  }
  for (const [key, value] of Object.entries(manifest)) {
    if (key.endsWith("CSS") && value.includes(baseName)) {
      return value;
    }
  }
  return null;
};
var updateStylesheetLink = (link, manifest) => {
  if (!(link instanceof HTMLLinkElement))
    return;
  const href = link.getAttribute("href");
  if (!href || href.includes("htmx.min.js"))
    return;
  let newHref = null;
  if (manifest) {
    const baseName = getCSSBaseName(href);
    newHref = findManifestHref(manifest, baseName);
  }
  if (newHref && newHref !== href) {
    link.href = `${newHref}?t=${Date.now()}`;
  } else {
    const url = new URL(href, window.location.origin);
    url.searchParams.set("t", Date.now().toString());
    link.href = url.toString();
  }
};
var reloadCSSStylesheets = (manifest) => {
  const stylesheets = document.querySelectorAll('link[rel="stylesheet"]');
  stylesheets.forEach((link) => {
    updateStylesheetLink(link, manifest);
  });
};
var createCSSLoadPromise = (linkElement, newHref) => new Promise((resolve) => {
  let resolved = false;
  const doResolve = function() {
    if (resolved)
      return;
    resolved = true;
    resolve();
  };
  const verifyCSSOM = function() {
    try {
      const sheets = Array.from(document.styleSheets);
      return sheets.some((sheet) => sheet.href && sheet.href.includes(newHref.split("?")[0] ?? ""));
    } catch {
      return false;
    }
  };
  linkElement.onload = function() {
    let checkCount = 0;
    const checkCSSOM = function() {
      checkCount++;
      if (verifyCSSOM() || checkCount > CSS_MAX_CHECK_ATTEMPTS) {
        doResolve();
      } else {
        requestAnimationFrame(checkCSSOM);
      }
    };
    requestAnimationFrame(checkCSSOM);
  };
  linkElement.onerror = function() {
    setTimeout(() => {
      doResolve();
    }, CSS_ERROR_RESOLVE_DELAY_MS);
  };
  setTimeout(() => {
    if (linkElement.sheet && !resolved) {
      doResolve();
    }
  }, CSS_SHEET_READY_TIMEOUT_MS);
  setTimeout(() => {
    if (!resolved) {
      doResolve();
    }
  }, CSS_MAX_PARSE_TIMEOUT_MS);
});
var removeLinks = (linksToRemove) => {
  linksToRemove.forEach((link) => {
    if (link.parentNode) {
      link.remove();
    }
  });
};
var activateLinks = (linksToActivate) => {
  linksToActivate.forEach((link) => {
    link.media = "all";
  });
};
var chainRAF = (depth, callback) => {
  if (depth <= 0) {
    callback();
    return;
  }
  requestAnimationFrame(() => {
    chainRAF(depth - 1, callback);
  });
};
var waitForCSSAndUpdate = (cssResult, updateBody) => {
  const { linksToActivate, linksToRemove, linksToWaitFor } = cssResult;
  if (linksToWaitFor.length > 0) {
    Promise.all(linksToWaitFor).then(() => {
      setTimeout(() => {
        chainRAF(RAF_BATCH_COUNT, () => {
          updateBody();
          activateLinks(linksToActivate);
          requestAnimationFrame(() => {
            removeLinks(linksToRemove);
            if (hmrState.isFirstHMRUpdate) {
              hmrState.isFirstHMRUpdate = false;
            }
          });
        });
      }, DOM_UPDATE_DELAY_MS);
      return;
    });
    return;
  }
  const doUpdate = function() {
    chainRAF(RAF_BATCH_COUNT, () => {
      updateBody();
      requestAnimationFrame(() => {
        removeLinks(linksToRemove);
      });
    });
  };
  if (hmrState.isFirstHMRUpdate) {
    hmrState.isFirstHMRUpdate = false;
    setTimeout(doUpdate, DOM_UPDATE_DELAY_MS);
  } else {
    doUpdate();
  }
};

// src/dev/client/headPatch.ts
var getLinkElementKey = (elem) => {
  const rel = (elem.getAttribute("rel") || "").toLowerCase();
  if (rel === "icon" || rel === "shortcut icon" || rel === "apple-touch-icon")
    return `link:icon:${rel}`;
  if (rel === "stylesheet")
    return null;
  if (rel === "preconnect")
    return `link:preconnect:${elem.getAttribute("href") || ""}`;
  if (rel === "preload")
    return `link:preload:${elem.getAttribute("href") || ""}`;
  if (rel === "canonical")
    return "link:canonical";
  if (rel === "dns-prefetch")
    return `link:dns-prefetch:${elem.getAttribute("href") || ""}`;
  return null;
};
var getHeadElementKey = (elem) => {
  const tag = elem.tagName.toLowerCase();
  if (tag === "title")
    return "title";
  if (tag === "meta" && elem.hasAttribute("charset"))
    return "meta:charset";
  if (tag === "meta" && elem.hasAttribute("name"))
    return `meta:name:${elem.getAttribute("name")}`;
  if (tag === "meta" && elem.hasAttribute("property"))
    return `meta:property:${elem.getAttribute("property")}`;
  if (tag === "meta" && elem.hasAttribute("http-equiv"))
    return `meta:http-equiv:${elem.getAttribute("http-equiv")}`;
  if (tag === "link")
    return getLinkElementKey(elem);
  if (tag === "script" && elem.hasAttribute("data-hmr-id"))
    return `script:hmr:${elem.getAttribute("data-hmr-id")}`;
  if (tag === "script")
    return null;
  if (tag === "base")
    return "base";
  return null;
};
var shouldPreserveElement = (elem) => {
  if (elem.hasAttribute("data-hmr-import-map"))
    return true;
  if (elem.hasAttribute("data-hmr-client"))
    return true;
  if (elem.hasAttribute("data-react-refresh-setup"))
    return true;
  const attrs = Array.from(elem.attributes);
  for (let idx = 0;idx < attrs.length; idx++) {
    if (attrs[idx]?.name.startsWith("data-hmr-"))
      return true;
  }
  if (elem.tagName === "SCRIPT") {
    const src = elem.getAttribute("src") || "";
    if (src.includes("htmx.min.js") || src.includes("htmx.js"))
      return true;
  }
  return false;
};
var updateTitleElement = (oldEl, newEl) => {
  const newTitle = newEl.textContent || "";
  if (oldEl.textContent === newTitle)
    return;
  oldEl.textContent = newTitle;
  document.title = newTitle;
};
var updateMetaElement = (oldEl, newEl) => {
  const newContent = newEl.getAttribute("content");
  const oldContent = oldEl.getAttribute("content");
  if (oldContent !== newContent && newContent !== null) {
    oldEl.setAttribute("content", newContent);
  }
  if (!newEl.hasAttribute("charset"))
    return;
  const newCharset = newEl.getAttribute("charset");
  if (oldEl.getAttribute("charset") !== newCharset && newCharset !== null) {
    oldEl.setAttribute("charset", newCharset);
  }
};
var updateFaviconHref = (oldEl, newHref, oldHref) => {
  const [oldBase] = oldHref.split("?");
  const [newBase] = newHref.split("?");
  if (oldBase === newBase)
    return;
  const cacheBustedHref = `${newHref + (newHref.includes("?") ? "&" : "?")}t=${Date.now()}`;
  oldEl.setAttribute("href", cacheBustedHref);
};
var updateLinkElement = (oldEl, newEl) => {
  const rel = (oldEl.getAttribute("rel") || "").toLowerCase();
  const newHref = newEl.getAttribute("href");
  const oldHref = oldEl.getAttribute("href");
  const isIcon = rel === "icon" || rel === "shortcut icon" || rel === "apple-touch-icon";
  if (isIcon && newHref && oldHref) {
    updateFaviconHref(oldEl, newHref, oldHref);
  } else if (!isIcon && newHref && oldHref !== newHref) {
    oldEl.setAttribute("href", newHref);
  }
  const attrsToCheck = ["type", "sizes", "crossorigin", "as", "media"];
  attrsToCheck.forEach((attr) => {
    const newVal = newEl.getAttribute(attr);
    const oldVal = oldEl.getAttribute(attr);
    if (newVal !== null && oldVal !== newVal) {
      oldEl.setAttribute(attr, newVal);
    } else if (newVal === null && oldVal !== null) {
      oldEl.removeAttribute(attr);
    }
  });
};
var updateBaseElement = (oldEl, newEl) => {
  const newHref = newEl.getAttribute("href");
  const newTarget = newEl.getAttribute("target");
  if (newHref && oldEl.getAttribute("href") !== newHref) {
    oldEl.setAttribute("href", newHref);
  }
  if (newTarget && oldEl.getAttribute("target") !== newTarget) {
    oldEl.setAttribute("target", newTarget);
  }
};
var updateHeadElement = (oldEl, newEl) => {
  const tag = oldEl.tagName.toLowerCase();
  if (tag === "title") {
    updateTitleElement(oldEl, newEl);
    return;
  }
  if (tag === "meta") {
    updateMetaElement(oldEl, newEl);
    return;
  }
  if (tag === "link") {
    updateLinkElement(oldEl, newEl);
    return;
  }
  if (tag === "base") {
    updateBaseElement(oldEl, newEl);
  }
};
var addHeadElement = (newEl) => {
  const clone = document.createElement(newEl.tagName.toLowerCase());
  for (const attr of Array.from(newEl.attributes)) {
    clone.setAttribute(attr.name, attr.value);
  }
  clone.textContent = newEl.textContent;
  clone.setAttribute("data-hmr-source", "patched");
  const tag = newEl.tagName.toLowerCase();
  const { head } = document;
  let insertBefore = null;
  if (tag === "title") {
    insertBefore = head.firstChild;
  } else if (tag === "meta") {
    const firstLink = head.querySelector("link");
    const firstScript = head.querySelector("script");
    insertBefore = firstLink || firstScript;
  } else if (tag === "link") {
    const firstScript = head.querySelector("script");
    insertBefore = firstScript;
  }
  if (insertBefore) {
    head.insertBefore(clone, insertBefore);
  } else {
    head.appendChild(clone);
  }
};
var removeStaleElement = (existingEl) => {
  if (shouldPreserveElement(existingEl))
    return;
  const tag = existingEl.tagName.toLowerCase();
  const rel = existingEl.getAttribute("rel") || "";
  if (tag === "link" && rel === "stylesheet")
    return;
  existingEl.remove();
};
var patchHeadInPlace = (newHeadHTML) => {
  if (!newHeadHTML)
    return;
  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = newHeadHTML;
  const existingMap = new Map;
  const newMap = new Map;
  Array.from(document.head.children).forEach((elem) => {
    if (shouldPreserveElement(elem))
      return;
    const key = getHeadElementKey(elem);
    if (key) {
      existingMap.set(key, elem);
    }
  });
  Array.from(tempDiv.children).forEach((elem) => {
    const key = getHeadElementKey(elem);
    if (key) {
      newMap.set(key, elem);
    }
  });
  newMap.forEach((newEl, key) => {
    const existingEl = existingMap.get(key);
    if (existingEl) {
      updateHeadElement(existingEl, newEl);
    } else {
      addHeadElement(newEl);
    }
  });
  existingMap.forEach((existingEl, key) => {
    if (!newMap.has(key)) {
      removeStaleElement(existingEl);
    }
  });
};

// src/dev/client/domTracker.ts
var restoreDOMChanges = (root, snapshot, newHTML) => {
  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = newHTML;
  snapshot.text.forEach((liveText, elId) => {
    const newEl = tempDiv.querySelector(`#${CSS.escape(elId)}`);
    const newText = newEl ? newEl.textContent || "" : "";
    if (liveText === newText)
      return;
    const liveEl = root.querySelector(`#${CSS.escape(elId)}`);
    if (liveEl) {
      liveEl.textContent = liveText;
    }
  });
  snapshot.children.forEach((liveHTML, elId) => {
    const newEl = tempDiv.querySelector(`#${CSS.escape(elId)}`);
    const newInner = newEl ? newEl.innerHTML : "";
    if (liveHTML === newInner || liveHTML.length <= newInner.length)
      return;
    const liveEl = root.querySelector(`#${CSS.escape(elId)}`);
    if (liveEl) {
      liveEl.innerHTML = liveHTML;
    }
  });
};
var snapshotDOMChanges = (root) => {
  const text = new Map;
  const children = new Map;
  root.querySelectorAll("[id]").forEach((elem) => {
    const { childNodes } = elem;
    const isTextLeaf = Array.from(childNodes).every((child) => child.nodeType === Node.TEXT_NODE);
    if (isTextLeaf && childNodes.length > 0) {
      text.set(elem.id, elem.textContent || "");
    } else if (elem.children.length > 0) {
      children.set(elem.id, elem.innerHTML);
    }
  });
  return { children, text };
};

// src/dev/client/handlers/html.ts
var parseHTMLMessage = (html) => {
  let body = null;
  let head = null;
  if (typeof html === "string") {
    body = html;
  } else if (html && typeof html === "object") {
    body = html.body || null;
    head = html.head || null;
  }
  return { body, head };
};
var applyHeadPatch = (htmlHead) => {
  if (!htmlHead) {
    return;
  }
  const doPatchHead = () => {
    patchHeadInPlace(htmlHead);
  };
  if (hmrState.isFirstHMRUpdate) {
    setTimeout(doPatchHead, DOM_UPDATE_DELAY_MS);
  } else {
    doPatchHead();
  }
};
var handleHTMLBodyWithHead = (htmlBody, htmlHead, htmlDomState) => {
  applyHeadPatch(htmlHead);
  const cssResult = processCSSLinks(htmlHead);
  const updateBodyAfterCSS = () => {
    updateHTMLBody(htmlBody, htmlDomState, document.body);
  };
  waitForCSSAndUpdate(cssResult, updateBodyAfterCSS);
};
var handleHTMLBodyWithoutHead = (htmlBody, htmlDomState) => {
  const container = document.body;
  if (!container) {
    sessionStorage.removeItem("__HMR_ACTIVE__");
    return;
  }
  updateHTMLBodyDirect(htmlBody, htmlDomState, container);
  restoreDOMState(container, htmlDomState);
};
var handleHTMLUpdate = (message) => {
  const htmlFrameworkCheck = detectCurrentFramework();
  if (htmlFrameworkCheck !== "html") {
    return;
  }
  if (window.__REACT_ROOT__) {
    window.__REACT_ROOT__ = undefined;
  }
  sessionStorage.setItem("__HMR_ACTIVE__", "true");
  const htmlDomState = saveDOMState(document.body);
  const { body: htmlBody, head: htmlHead } = parseHTMLMessage(message.data.html);
  if (!htmlBody) {
    sessionStorage.removeItem("__HMR_ACTIVE__");
    return;
  }
  if (htmlHead) {
    handleHTMLBodyWithHead(htmlBody, htmlHead, htmlDomState);
  } else {
    handleHTMLBodyWithoutHead(htmlBody, htmlDomState);
  }
};
var handleScriptUpdate = (message) => {
  const scriptFramework = message.data.framework;
  const currentFw = detectCurrentFramework();
  if (currentFw !== scriptFramework) {
    return;
  }
  const { scriptPath } = message.data;
  if (!scriptPath) {
    console.warn("[HMR] No script path in update");
    return;
  }
  const interactiveSelectors = "button, [onclick], [onchange], [oninput], details, input, select, textarea";
  document.body.querySelectorAll(interactiveSelectors).forEach((elem) => {
    const cloned = elem.cloneNode(true);
    if (elem.parentNode) {
      elem.parentNode.replaceChild(cloned, elem);
    }
  });
  const cacheBustedPath = `${scriptPath}?t=${Date.now()}`;
  import(cacheBustedPath).then(() => true).catch((err) => {
    console.error("[HMR] Script hot-reload failed, falling back to page reload:", err);
    window.location.reload();
  });
};
var saveHTMLState = () => ({
  forms: saveFormState(),
  scroll: saveScrollState()
});
var preserveHmrScript = (container, hmrScript) => {
  if (hmrScript && !container.querySelector("script[data-hmr-client]")) {
    container.appendChild(hmrScript);
  }
};
var updateHTMLBody = (htmlBody, htmlDomState, container) => {
  if (!container) {
    return;
  }
  const savedState = saveHTMLState();
  const domSnapshot = snapshotDOMChanges(container);
  const existingScripts = collectScripts(container);
  const hmrScript = container.querySelector("script[data-hmr-client]");
  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = htmlBody;
  const newScripts = collectScriptsFromElement(tempDiv);
  const htmlStructureChanged = didHTMLStructureChange(container, tempDiv);
  if (htmlStructureChanged || didScriptsChange(existingScripts, newScripts)) {
    patchDOMInPlace(container, htmlBody);
    restoreDOMChanges(container, domSnapshot, htmlBody);
  }
  preserveHmrScript(container, hmrScript);
  requestAnimationFrame(() => {
    restoreDOMState(container, htmlDomState);
    restoreFormState(savedState.forms);
    restoreScrollState(savedState.scroll);
    if (didScriptsChange(existingScripts, newScripts) || htmlStructureChanged) {
      cloneInteractiveElements(container);
      reExecuteScripts(container, newScripts);
    }
  });
  sessionStorage.removeItem("__HMR_ACTIVE__");
};
var cloneHmrListenerElements = (container) => {
  container.querySelectorAll("[data-hmr-listeners-attached]").forEach((elem) => {
    const cloned = elem.cloneNode(true);
    if (elem.parentNode) {
      elem.parentNode.replaceChild(cloned, elem);
    }
    if (cloned instanceof Element) {
      cloned.removeAttribute("data-hmr-listeners-attached");
    }
  });
};
var replaceInlineScript = (script) => {
  if (script.hasAttribute("data-hmr-client")) {
    return;
  }
  const newScript = document.createElement("script");
  newScript.textContent = script.textContent || "";
  const scriptEl = script instanceof HTMLScriptElement ? script : null;
  newScript.type = scriptEl?.type || "text/javascript";
  if (script.parentNode) {
    script.parentNode.replaceChild(newScript, script);
  }
};
var updateHTMLBodyDirect = (htmlBody, htmlDomState, container) => {
  const savedState = saveHTMLState();
  const domSnapshot = snapshotDOMChanges(container);
  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = htmlBody;
  const newScripts = collectScriptsFromElement(tempDiv);
  const hmrScript = container.querySelector("script[data-hmr-client]");
  patchDOMInPlace(container, htmlBody);
  restoreDOMChanges(container, domSnapshot, htmlBody);
  preserveHmrScript(container, hmrScript);
  requestAnimationFrame(() => {
    restoreDOMState(container, htmlDomState);
    restoreFormState(savedState.forms);
    restoreScrollState(savedState.scroll);
    cloneHmrListenerElements(container);
    removeOldScripts(container);
    newScripts.forEach((scriptInfo) => {
      const newScript = document.createElement("script");
      const separator = scriptInfo.src.includes("?") ? "&" : "?";
      newScript.src = `${scriptInfo.src + separator}t=${Date.now()}`;
      newScript.type = scriptInfo.type;
      container.appendChild(newScript);
    });
    const inlineScripts = container.querySelectorAll("script:not([src])");
    inlineScripts.forEach(replaceInlineScript);
  });
  sessionStorage.removeItem("__HMR_ACTIVE__");
};
var collectScripts = (container) => Array.from(container.querySelectorAll("script[src]")).map((script) => ({
  src: script.getAttribute("src") || "",
  type: script.getAttribute("type") || "text/javascript"
}));
var collectScriptsFromElement = (elem) => Array.from(elem.querySelectorAll("script[src]")).map((script) => ({
  src: script.getAttribute("src") || "",
  type: script.getAttribute("type") || "text/javascript"
}));
var didScriptsChange = (oldScripts, newScripts) => oldScripts.length !== newScripts.length || oldScripts.some((oldScript, idx) => {
  const [oldSrcBase] = oldScript.src.split("?")[0]?.split("&") ?? [""];
  const newScript = newScripts[idx];
  if (!newScript)
    return true;
  const [newSrcBase] = newScript.src.split("?")[0]?.split("&") ?? [""];
  return oldSrcBase !== newSrcBase;
});
var normalizeHTMLForComparison = (element) => {
  const clonedNode = element.cloneNode(true);
  if (!(clonedNode instanceof HTMLElement))
    return "";
  const clone = clonedNode;
  const scripts = clone.querySelectorAll("script");
  scripts.forEach((script) => {
    if (script.parentNode) {
      script.parentNode.removeChild(script);
    }
  });
  const allElements = clone.querySelectorAll("*");
  allElements.forEach((elem) => {
    elem.removeAttribute("data-hmr-listeners-attached");
  });
  if (clone.removeAttribute) {
    clone.removeAttribute("data-hmr-listeners-attached");
  }
  return clone.innerHTML;
};
var didHTMLStructureChange = (container, tempDiv) => normalizeHTMLForComparison(container) !== normalizeHTMLForComparison(tempDiv);
var cloneInteractiveElements = (container) => {
  const interactiveSelectors = 'button, [onclick], [onchange], [oninput], [onsubmit], details, input[type="button"], input[type="submit"], input[type="reset"]';
  container.querySelectorAll(interactiveSelectors).forEach((elem) => {
    const cloned = elem.cloneNode(true);
    if (elem.parentNode) {
      elem.parentNode.replaceChild(cloned, elem);
    }
  });
};
var removeOldScripts = (container) => {
  const scriptsInNewHTML = container.querySelectorAll("script[src]");
  scriptsInNewHTML.forEach((script) => {
    if (!script.hasAttribute("data-hmr-client")) {
      script.remove();
    }
  });
};
var reExecuteScripts = (container, newScripts) => {
  removeOldScripts(container);
  newScripts.forEach((scriptInfo) => {
    const newScript = document.createElement("script");
    const separator = scriptInfo.src.includes("?") ? "&" : "?";
    newScript.src = `${scriptInfo.src + separator}t=${Date.now()}`;
    newScript.type = scriptInfo.type;
    container.appendChild(newScript);
  });
  const inlineScripts = container.querySelectorAll("script:not([src])");
  inlineScripts.forEach(replaceInlineScript);
};

// src/dev/client/handlers/htmx.ts
var parseHTMXMessage = (html) => {
  let body = null;
  let head = null;
  if (typeof html === "string") {
    body = html;
  } else if (html && typeof html === "object") {
    body = html.body || null;
    head = html.head || null;
  }
  return { body, head };
};
var applyHeadPatch2 = (htmxHead) => {
  if (!htmxHead) {
    return;
  }
  const doPatchHead = () => {
    patchHeadInPlace(htmxHead);
  };
  if (hmrState.isFirstHMRUpdate) {
    setTimeout(doPatchHead, DOM_UPDATE_DELAY_MS);
  } else {
    doPatchHead();
  }
};
var handleHTMXBodyUpdate = (htmxBody, htmxHead, htmxDomState) => {
  const updateHTMXBodyAfterCSS = () => {
    updateHTMXBody(htmxBody, htmxDomState, document.body);
  };
  if (htmxHead) {
    applyHeadPatch2(htmxHead);
    const cssResult = processCSSLinks(htmxHead);
    waitForCSSAndUpdate(cssResult, updateHTMXBodyAfterCSS);
  } else {
    updateHTMXBodyAfterCSS();
  }
};
var handleHTMXUpdate = (message) => {
  const htmxFrameworkCheck = detectCurrentFramework();
  if (htmxFrameworkCheck !== "htmx")
    return;
  if (window.__REACT_ROOT__) {
    window.__REACT_ROOT__ = undefined;
  }
  sessionStorage.setItem("__HMR_ACTIVE__", "true");
  const htmxDomState = saveDOMState(document.body);
  const { body: htmxBody, head: htmxHead } = parseHTMXMessage(message.data.html);
  if (!htmxBody) {
    sessionStorage.removeItem("__HMR_ACTIVE__");
    return;
  }
  handleHTMXBodyUpdate(htmxBody, htmxHead, htmxDomState);
};
var cloneHmrListenerElements2 = (container) => {
  container.querySelectorAll("[data-hmr-listeners-attached]").forEach((elem) => {
    const cloned = elem.cloneNode(true);
    if (elem.parentNode) {
      elem.parentNode.replaceChild(cloned, elem);
    }
    cloned.removeAttribute("data-hmr-listeners-attached");
  });
};
var removeOldScripts2 = (container) => {
  const scriptsInNewHTML = container.querySelectorAll("script[src]");
  scriptsInNewHTML.forEach((script) => {
    if (!script.hasAttribute("data-hmr-client")) {
      script.remove();
    }
  });
};
var addNewScripts = (container, newScripts) => {
  newScripts.forEach((scriptInfo) => {
    const newScript = document.createElement("script");
    const separator = scriptInfo.src.includes("?") ? "&" : "?";
    newScript.src = `${scriptInfo.src + separator}t=${Date.now()}`;
    newScript.type = scriptInfo.type;
    container.appendChild(newScript);
  });
};
var replaceInlineScript2 = (script) => {
  if (script.hasAttribute("data-hmr-client")) {
    return;
  }
  const newScript = document.createElement("script");
  newScript.textContent = script.textContent || "";
  newScript.type = script.getAttribute("type") || "text/javascript";
  if (script.parentNode) {
    script.parentNode.replaceChild(newScript, script);
  }
};
var reExecuteScripts2 = (container, newScripts) => {
  removeOldScripts2(container);
  addNewScripts(container, newScripts);
  const inlineScripts = container.querySelectorAll("script:not([src])");
  inlineScripts.forEach(replaceInlineScript2);
};
var handleScriptsAndStructureChange = (container, newScripts) => {
  cloneHmrListenerElements2(container);
  reExecuteScripts2(container, newScripts);
};
var restoreCounterSpan = (container, count) => {
  const newCountSpan = container.querySelector("#count");
  if (newCountSpan && count !== undefined) {
    newCountSpan.textContent = String(count);
  }
};
var updateHTMXBody = (htmxBody, htmxDomState, container) => {
  if (!container)
    return;
  const countSpan = container.querySelector("#count");
  const countValue = countSpan ? parseInt(countSpan.textContent || "0", 10) : 0;
  const savedState = {
    componentState: { count: countValue },
    forms: saveFormState(),
    scroll: saveScrollState()
  };
  const existingScripts = collectScripts2(container);
  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = htmxBody;
  if (savedState.componentState.count !== undefined) {
    restoreCounterSpan(tempDiv, savedState.componentState.count);
  }
  const patchedBody = tempDiv.innerHTML;
  const newScripts = collectScriptsFromElement2(tempDiv);
  const scriptsChanged = didScriptsChange2(existingScripts, newScripts);
  const htmlStructureChanged = didHTMLStructureChange2(container, tempDiv);
  const hmrScript = container.querySelector("script[data-hmr-client]");
  patchDOMInPlace(container, patchedBody);
  if (hmrScript && !container.querySelector("script[data-hmr-client]")) {
    container.appendChild(hmrScript);
  }
  requestAnimationFrame(() => {
    restoreFormState(savedState.forms);
    restoreScrollState(savedState.scroll);
    restoreCounterSpan(container, savedState.componentState.count);
    restoreDOMState(container, htmxDomState);
    if (scriptsChanged || htmlStructureChanged) {
      handleScriptsAndStructureChange(container, newScripts);
    }
    if (window.htmx) {
      window.htmx.process(container);
    }
  });
  sessionStorage.removeItem("__HMR_ACTIVE__");
};
var collectScripts2 = (container) => Array.from(container.querySelectorAll("script[src]")).map((script) => ({
  src: script.getAttribute("src") || "",
  type: script.getAttribute("type") || "text/javascript"
}));
var collectScriptsFromElement2 = (elem) => Array.from(elem.querySelectorAll("script[src]")).map((script) => ({
  src: script.getAttribute("src") || "",
  type: script.getAttribute("type") || "text/javascript"
}));
var didScriptsChange2 = (oldScripts, newScripts) => oldScripts.length !== newScripts.length || oldScripts.some((oldScript, idx) => {
  const [oldBeforeQuery = ""] = oldScript.src.split("?");
  const [oldSrcBase] = oldBeforeQuery.split("&");
  const newScript = newScripts[idx];
  if (!newScript)
    return true;
  const [newBeforeQuery = ""] = newScript.src.split("?");
  const [newSrcBase] = newBeforeQuery.split("&");
  return oldSrcBase !== newSrcBase;
});
var normalizeHTMLForComparison2 = (element) => {
  const clone = element.cloneNode(true);
  const scripts = clone.querySelectorAll("script");
  scripts.forEach((script) => {
    if (script.parentNode) {
      script.parentNode.removeChild(script);
    }
  });
  const allElements = clone.querySelectorAll("*");
  allElements.forEach((elem) => {
    elem.removeAttribute("data-hmr-listeners-attached");
  });
  if (clone.removeAttribute) {
    clone.removeAttribute("data-hmr-listeners-attached");
  }
  return clone.innerHTML;
};
var didHTMLStructureChange2 = (container, tempDiv) => normalizeHTMLForComparison2(container) !== normalizeHTMLForComparison2(tempDiv);

// src/dev/client/handlers/svelte.ts
var swapStylesheet2 = (cssUrl, cssBaseName, framework) => {
  let existingLink = null;
  document.querySelectorAll('link[rel="stylesheet"]').forEach((link) => {
    const href = link.getAttribute("href") ?? "";
    if (href.includes(cssBaseName) || href.includes(framework)) {
      existingLink = link;
    }
  });
  if (!existingLink) {
    return;
  }
  const capturedExisting = existingLink;
  const newLink = document.createElement("link");
  newLink.rel = "stylesheet";
  newLink.href = `${cssUrl}?t=${Date.now()}`;
  newLink.onload = () => {
    if (capturedExisting && capturedExisting.parentNode) {
      capturedExisting.remove();
    }
  };
  document.head.appendChild(newLink);
};
var extractCountFromDOM = () => {
  const countButton = document.querySelector("button");
  if (!countButton || !countButton.textContent) {
    return {};
  }
  const countMatch = countButton.textContent.match(/(\d+)/);
  if (!countMatch) {
    return {};
  }
  return { initialCount: parseInt(countMatch[1] ?? "0", 10) };
};
var loadStateFromSession = () => {
  try {
    const stored = sessionStorage.getItem("__SVELTE_HMR_STATE__");
    if (!stored) {
      return {};
    }
    const parsed = JSON.parse(stored);
    if (parsed && Object.keys(parsed).length > 0) {
      return parsed;
    }
    return {};
  } catch {
    return {};
  }
};
var saveStateToSession = (preservedState) => {
  if (Object.keys(preservedState).length === 0) {
    return;
  }
  try {
    sessionStorage.setItem("__SVELTE_HMR_STATE__", JSON.stringify(preservedState));
  } catch {}
};
var collectCssRules = (sheet) => {
  let rules = "";
  for (let idx = 0;idx < sheet.cssRules.length; idx++) {
    const rule = sheet.cssRules[idx];
    if (!rule)
      continue;
    rules += `${rule.cssText}
`;
  }
  return rules;
};
var preserveLinkAsInlineStyle = (link) => {
  try {
    const { sheet } = link;
    if (!sheet || sheet.cssRules.length === 0) {
      return null;
    }
    const style = document.createElement("style");
    style.dataset.hmrPreserved = "true";
    style.textContent = collectCssRules(sheet);
    document.head.appendChild(style);
    return style;
  } catch {
    const clone = document.createElement("link");
    clone.rel = link.rel;
    clone.href = link.href;
    clone.dataset.hmrPreserved = "true";
    document.head.appendChild(clone);
    return null;
  }
};
var preserveAllStylesheets = () => {
  const preservedStyles = [];
  document.querySelectorAll('head link[rel="stylesheet"]').forEach((link) => {
    const style = preserveLinkAsInlineStyle(link);
    if (style) {
      preservedStyles.push(style);
    }
  });
  document.querySelectorAll("head style:not([data-hmr-preserved])").forEach((style) => {
    const clone = document.createElement("style");
    clone.dataset.hmrPreserved = "true";
    clone.textContent = style.textContent;
    document.head.appendChild(clone);
  });
  return preservedStyles;
};
var buildLinkLoadPromise = (link) => {
  if (link.sheet && link.sheet.cssRules.length > 0) {
    return null;
  }
  return new Promise((resolve) => {
    link.onload = () => {
      resolve();
    };
    link.onerror = () => {
      resolve();
    };
    setTimeout(resolve, SVELTE_CSS_LOAD_TIMEOUT_MS);
  });
};
var cleanupAfterImport = (domState, scrollState) => {
  document.querySelectorAll('[data-hmr-preserved="true"]').forEach((element) => {
    element.remove();
  });
  restoreDOMState(document.body, domState);
  restoreScrollState(scrollState);
};
var waitForStylesAndCleanup = (domState, scrollState) => {
  const newLinks = document.querySelectorAll('head link[rel="stylesheet"]:not([data-hmr-preserved])');
  const loadPromises = [];
  newLinks.forEach((link) => {
    const promise = buildLinkLoadPromise(link);
    if (promise) {
      loadPromises.push(promise);
    }
  });
  const cleanup = () => {
    cleanupAfterImport(domState, scrollState);
  };
  if (loadPromises.length > 0) {
    Promise.all(loadPromises).then(cleanup);
  } else {
    cleanup();
  }
};
var handleSvelteUpdate = (message) => {
  const svelteFrameworkCheck = detectCurrentFramework();
  if (svelteFrameworkCheck !== "svelte")
    return;
  if (message.data.updateType === "css-only" && message.data.cssUrl) {
    swapStylesheet2(message.data.cssUrl, message.data.cssBaseName || "", "svelte");
    return;
  }
  const domState = saveDOMState(document.body);
  const scrollState = saveScrollState();
  let preservedState = extractCountFromDOM();
  if (Object.keys(preservedState).length === 0) {
    preservedState = loadStateFromSession();
  }
  window.__HMR_PRESERVED_STATE__ = preservedState;
  saveStateToSession(preservedState);
  const indexPath = findIndexPath(message.data.manifest, message.data.sourceFile, "svelte");
  if (!indexPath) {
    console.warn("[HMR] Svelte index path not found, reloading");
    window.location.reload();
    return;
  }
  if (message.data.cssUrl) {
    swapStylesheet2(message.data.cssUrl, message.data.cssBaseName || "", "svelte");
  }
  preserveAllStylesheets();
  const modulePath = `${indexPath}?t=${Date.now()}`;
  import(modulePath).then(() => {
    waitForStylesAndCleanup(domState, scrollState);
    return;
  }).catch((err) => {
    console.warn("[HMR] Svelte import failed, reloading:", err);
    window.location.reload();
  });
};

// src/dev/client/handlers/vue.ts
var collectSetupValue = (target, key, value) => {
  if (value && typeof value === "object" && "value" in value) {
    target[key] = value.value;
    return;
  }
  if (typeof value !== "function") {
    target[key] = value;
  }
};
var collectSetupState = (target, setupState) => {
  const keys = Object.keys(setupState);
  for (let idx = 0;idx < keys.length; idx++) {
    const key = keys[idx];
    if (key === undefined)
      continue;
    collectSetupValue(target, key, setupState[key]);
  }
};
var walkVNode = (vnode, state) => {
  if (!vnode)
    return;
  if (vnode.component && vnode.component.setupState) {
    collectSetupState(state, vnode.component.setupState);
  }
  if (vnode.children && Array.isArray(vnode.children)) {
    vnode.children.forEach((child) => {
      walkVNode(child, state);
    });
  }
  if (vnode.component && vnode.component.subTree) {
    walkVNode(vnode.component.subTree, state);
  }
};
var extractChildComponentState = (instance, state) => {
  if (!instance || !instance.subTree)
    return;
  walkVNode(instance.subTree, state);
};
var findMatchingStylesheetLink = (cssBaseName) => {
  let found = null;
  document.querySelectorAll('link[rel="stylesheet"]').forEach((link) => {
    const href = link.getAttribute("href") ?? "";
    if (cssBaseName && href.includes(cssBaseName)) {
      found = link;
    }
  });
  return found;
};
var swapStylesheet3 = (cssUrl, cssBaseName) => {
  const existingLink = findMatchingStylesheetLink(cssBaseName);
  if (!existingLink)
    return;
  const capturedExisting = existingLink;
  const newLink = document.createElement("link");
  newLink.rel = "stylesheet";
  newLink.href = `${cssUrl}?t=${Date.now()}`;
  newLink.onload = function() {
    if (capturedExisting && capturedExisting.parentNode) {
      capturedExisting.remove();
    }
  };
  document.head.appendChild(newLink);
};
var extractVueAppState = (vuePreservedState) => {
  if (!window.__VUE_APP__ || !window.__VUE_APP__._instance)
    return;
  const instance = window.__VUE_APP__._instance;
  if (instance.setupState) {
    collectSetupState(vuePreservedState, instance.setupState);
  }
  extractChildComponentState(instance, vuePreservedState);
};
var extractCountFromDOM2 = (vuePreservedState) => {
  if (Object.keys(vuePreservedState).length > 0)
    return;
  const countButton = document.querySelector("button");
  if (!countButton || !countButton.textContent)
    return;
  const countMatch = countButton.textContent.match(/count is (\d+)/i);
  if (!countMatch)
    return;
  vuePreservedState.initialCount = parseInt(countMatch[1] ?? "0", 10);
};
var handleVueImportSuccess = (vueRoot, vueDomState) => {
  if (vueRoot && vueDomState) {
    restoreDOMState(vueRoot, vueDomState);
  }
  sessionStorage.removeItem("__HMR_ACTIVE__");
};
var handleVueUpdate = (message) => {
  const vueFrameworkCheck = detectCurrentFramework();
  if (vueFrameworkCheck !== "vue")
    return;
  if (message.data.updateType === "css-only" && message.data.cssUrl) {
    swapStylesheet3(message.data.cssUrl, message.data.cssBaseName || "");
    return;
  }
  sessionStorage.setItem("__HMR_ACTIVE__", "true");
  const vueRoot = document.getElementById("root");
  const vueDomState = vueRoot ? saveDOMState(vueRoot) : null;
  const vuePreservedState = {};
  extractVueAppState(vuePreservedState);
  extractCountFromDOM2(vuePreservedState);
  if (vuePreservedState.count !== undefined && vuePreservedState.initialCount === undefined) {
    vuePreservedState.initialCount = vuePreservedState.count;
  }
  try {
    sessionStorage.setItem("__VUE_HMR_STATE__", JSON.stringify(vuePreservedState));
  } catch {}
  window.__HMR_PRESERVED_STATE__ = vuePreservedState;
  if (message.data.cssUrl) {
    swapStylesheet3(message.data.cssUrl, message.data.cssBaseName || "");
  }
  const savedHTML = vueRoot ? vueRoot.innerHTML : "";
  if (window.__VUE_APP__) {
    window.__VUE_APP__.unmount();
    window.__VUE_APP__ = null;
  }
  if (vueRoot) {
    vueRoot.innerHTML = savedHTML;
  }
  const indexPath = findIndexPath(message.data.manifest, message.data.sourceFile, "vue");
  if (!indexPath) {
    console.warn("[HMR] Vue index path not found, reloading");
    window.location.reload();
    return;
  }
  const modulePath = `${indexPath}?t=${Date.now()}`;
  import(modulePath).then(() => {
    handleVueImportSuccess(vueRoot, vueDomState);
    return;
  }).catch((err) => {
    console.warn("[HMR] Vue import failed:", err);
    sessionStorage.removeItem("__HMR_ACTIVE__");
    window.location.reload();
  });
};

// src/dev/client/handlers/rebuild.ts
var handleFullReload = () => {
  setTimeout(() => {
    window.location.reload();
  }, REBUILD_RELOAD_DELAY_MS);
};
var handleManifest = (message) => {
  window.__HMR_MANIFEST__ = message.data.manifest;
  if (message.data.serverVersions) {
    window.__HMR_SERVER_VERSIONS__ = message.data.serverVersions;
  }
  if (!window.__HMR_MODULE_VERSIONS__) {
    window.__HMR_MODULE_VERSIONS__ = {};
  }
  window.__HMR_MODULE_UPDATES__ = [];
};
var HMR_FRAMEWORKS = ["angular", "react", "vue", "svelte", "html", "htmx"];
var mergeRecord = (source, target) => {
  Object.keys(source).filter((key) => Object.prototype.hasOwnProperty.call(source, key)).forEach((key) => {
    const value = source[key];
    if (value !== undefined) {
      target[key] = value;
    }
  });
};
var mergeServerVersions = (serverVersions) => {
  if (!serverVersions)
    return;
  const existing = window.__HMR_SERVER_VERSIONS__ ?? {};
  mergeRecord(serverVersions, existing);
  window.__HMR_SERVER_VERSIONS__ = existing;
};
var mergeModuleVersions = (moduleVersions) => {
  if (!moduleVersions)
    return;
  const existing = window.__HMR_MODULE_VERSIONS__ ?? {};
  mergeRecord(moduleVersions, existing);
  window.__HMR_MODULE_VERSIONS__ = existing;
};
var mergeManifest = (manifest) => {
  if (!manifest)
    return;
  const existing = window.__HMR_MANIFEST__ ?? {};
  mergeRecord(manifest, existing);
  window.__HMR_MANIFEST__ = existing;
};
var handleModuleUpdate = (message) => {
  const hasHMRHandler = HMR_FRAMEWORKS.includes(message.data.framework || "");
  if (!hasHMRHandler) {
    window.location.reload();
    return;
  }
  mergeServerVersions(message.data.serverVersions);
  mergeModuleVersions(message.data.moduleVersions);
  mergeManifest(message.data.manifest);
  if (!window.__HMR_MODULE_UPDATES__) {
    window.__HMR_MODULE_UPDATES__ = [];
  }
  window.__HMR_MODULE_UPDATES__.push(message.data);
};
var handleRebuildComplete = (message) => {
  if (!isRuntimeErrorOverlay()) {
    hideErrorOverlay();
  }
  if (window.__HMR_MANIFEST__) {
    window.__HMR_MANIFEST__ = message.data.manifest;
  }
  if (message.data.affectedFrameworks && !message.data.affectedFrameworks.includes("angular") && !message.data.affectedFrameworks.includes("react") && !message.data.affectedFrameworks.includes("html") && !message.data.affectedFrameworks.includes("htmx") && !message.data.affectedFrameworks.includes("vue") && !message.data.affectedFrameworks.includes("svelte")) {
    const url = new URL(window.location.href);
    url.searchParams.set("_cb", Date.now().toString());
    window.location.href = url.toString();
  }
};
var handleRebuildError = (message) => {
  const errData = message.data || {};
  showErrorOverlay({
    column: errData.column,
    file: errData.file,
    framework: errData.framework || errData.affectedFrameworks && errData.affectedFrameworks[0],
    line: errData.line,
    lineText: errData.lineText,
    message: errData.error || "Build failed"
  });
};

// src/dev/client/hmrClient.ts
if (typeof window !== "undefined") {
  if (!window.__HMR_MANIFEST__) {
    window.__HMR_MANIFEST__ = {};
  }
  if (!window.__HMR_MODULE_UPDATES__) {
    window.__HMR_MODULE_UPDATES__ = [];
  }
  if (!window.__HMR_MODULE_VERSIONS__) {
    window.__HMR_MODULE_VERSIONS__ = {};
  }
  if (!window.__HMR_SERVER_VERSIONS__) {
    window.__HMR_SERVER_VERSIONS__ = {};
  }
}
window.addEventListener("error", (evt) => {
  if (!evt.error)
    return;
  showErrorOverlay({
    framework: detectCurrentFramework() || undefined,
    kind: "runtime",
    message: evt.error instanceof Error ? evt.error.stack || evt.error.message : String(evt.error)
  });
});
window.addEventListener("unhandledrejection", (evt) => {
  if (!evt.reason)
    return;
  showErrorOverlay({
    framework: detectCurrentFramework() || undefined,
    kind: "runtime",
    message: evt.reason instanceof Error ? evt.reason.stack || evt.reason.message : String(evt.reason)
  });
});
var hmrUpdateTypes = new Set([
  "angular-update",
  "react-update",
  "html-update",
  "htmx-update",
  "vue-update",
  "svelte-update",
  "style-update",
  "module-update",
  "rebuild-start"
]);
var handleHMRMessage = (message) => {
  if (hmrUpdateTypes.has(message.type)) {
    hmrState.isHMRUpdating = true;
    setTimeout(() => {
      hmrState.isHMRUpdating = false;
    }, HMR_UPDATE_TIMEOUT_MS);
  }
  switch (message.type) {
    case "manifest":
      handleManifest(message);
      break;
    case "rebuild-start":
      break;
    case "rebuild-complete":
      handleRebuildComplete(message);
      break;
    case "framework-update":
      break;
    case "module-update":
      hideErrorOverlay();
      handleModuleUpdate(message);
      break;
    case "react-update":
      handleReactUpdate(message);
      break;
    case "script-update":
      hideErrorOverlay();
      handleScriptUpdate(message);
      break;
    case "html-update":
      hideErrorOverlay();
      handleHTMLUpdate(message);
      break;
    case "htmx-update":
      hideErrorOverlay();
      handleHTMXUpdate(message);
      break;
    case "svelte-update":
      hideErrorOverlay();
      handleSvelteUpdate(message);
      break;
    case "vue-update":
      hideErrorOverlay();
      handleVueUpdate(message);
      break;
    case "angular-update":
      hideErrorOverlay();
      handleAngularUpdate(message);
      break;
    case "rebuild-error":
      handleRebuildError(message);
      break;
    case "full-reload":
      handleFullReload();
      break;
    case "pong":
      break;
    case "style-update":
      reloadCSSStylesheets(message.data.manifest);
      break;
    default:
      break;
  }
};
if (!(window.__HMR_WS__ && window.__HMR_WS__.readyState === WebSocket.OPEN)) {
  const wsHost = location.hostname;
  const wsPort = location.port || (location.protocol === "https:" ? "443" : "80");
  const wsProtocol = location.protocol === "https:" ? "wss" : "ws";
  const wsUrl = `${wsProtocol}://${wsHost}:${wsPort}/hmr`;
  const wsc = new WebSocket(wsUrl);
  window.__HMR_WS__ = wsc;
  wsc.onopen = function() {
    hmrState.isConnected = true;
    sessionStorage.setItem("__HMR_CONNECTED__", "true");
    const currentFramework = detectCurrentFramework();
    wsc.send(JSON.stringify({
      framework: currentFramework,
      type: "ready"
    }));
    if (hmrState.reconnectTimeout) {
      clearTimeout(hmrState.reconnectTimeout);
      hmrState.reconnectTimeout = null;
    }
    hmrState.pingInterval = setInterval(() => {
      if (wsc.readyState === WebSocket.OPEN && hmrState.isConnected) {
        wsc.send(JSON.stringify({ type: "ping" }));
      }
    }, PING_INTERVAL_MS);
  };
  wsc.onmessage = function(event) {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    handleHMRMessage(message);
  };
  wsc.onclose = function(event) {
    hmrState.isConnected = false;
    if (hmrState.pingInterval) {
      clearInterval(hmrState.pingInterval);
      hmrState.pingInterval = null;
    }
    if (event.code !== WEBSOCKET_NORMAL_CLOSURE) {
      let attempts = 0;
      hmrState.reconnectTimeout = setTimeout(function pollServer() {
        attempts++;
        if (attempts > MAX_RECONNECT_ATTEMPTS)
          return;
        fetch("/hmr-status", { cache: "no-store" }).then((res) => {
          if (res.ok) {
            window.location.reload();
          } else {
            hmrState.reconnectTimeout = setTimeout(pollServer, RECONNECT_POLL_INTERVAL_MS);
          }
          return;
        }).catch(() => {
          hmrState.reconnectTimeout = setTimeout(pollServer, RECONNECT_POLL_INTERVAL_MS);
        });
      }, RECONNECT_INITIAL_DELAY_MS);
    }
  };
  wsc.onerror = function() {
    hmrState.isConnected = false;
  };
  window.addEventListener("beforeunload", () => {
    if (hmrState.isHMRUpdating) {
      if (hmrState.pingInterval)
        clearInterval(hmrState.pingInterval);
      if (hmrState.reconnectTimeout)
        clearTimeout(hmrState.reconnectTimeout);
      return;
    }
    if (hmrState.pingInterval)
      clearInterval(hmrState.pingInterval);
    if (hmrState.reconnectTimeout)
      clearTimeout(hmrState.reconnectTimeout);
  });
}

// example/react/indexes/ReactExample.tsx
import { hydrateRoot, createRoot } from "/react/vendor/react-dom_client.js";
import { createElement, Component } from "/react/vendor/react.js";

// example/react/components/App.tsx
import { useState } from "/react/vendor/react.js";
import { jsxDEV } from "/react/vendor/react_jsx-dev-runtime.js";
var _s = $RefreshSig$();
var App = _s(({ initialCount }) => {
  _s();
  const [count, setCount] = useState(initialCount);
  return /* @__PURE__ */ jsxDEV("main", {
    children: [
      /* @__PURE__ */ jsxDEV("nav", {
        children: [
          /* @__PURE__ */ jsxDEV("a", {
            href: "https://absolutejs.com",
            target: "_blank",
            children: /* @__PURE__ */ jsxDEV("img", {
              alt: "AbsoluteJS Logo",
              className: "logo",
              src: "/assets/png/absolutejs-temp.png"
            }, undefined, false, undefined, this)
          }, undefined, false, undefined, this),
          /* @__PURE__ */ jsxDEV("a", {
            href: "https://react.dev/",
            children: /* @__PURE__ */ jsxDEV("img", {
              alt: "React Logo",
              className: "logo react",
              src: "/assets/svg/react.svg"
            }, undefined, false, undefined, this)
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this),
      /* @__PURE__ */ jsxDEV("h1", {
        children: "AbsoluteJS + React "
      }, undefined, false, undefined, this),
      /* @__PURE__ */ jsxDEV("button", {
        onClick: () => setCount(count + 1),
        children: [
          "count is ",
          count
        ]
      }, undefined, true, undefined, this),
      /* @__PURE__ */ jsxDEV("p", {
        children: [
          "Edit ",
          /* @__PURE__ */ jsxDEV("code", {
            children: "example/react/pages/ReactExample.tsx"
          }, undefined, false, undefined, this),
          " and save to test HMR."
        ]
      }, undefined, true, undefined, this),
      /* @__PURE__ */ jsxDEV("p", {
        style: { marginTop: "2rem" },
        children: "Explore the other pages to see how AbsoluteJS seamlessly unifies multiple frameworks on a single server."
      }, undefined, false, undefined, this),
      /* @__PURE__ */ jsxDEV("p", {
        style: {
          color: "#777",
          fontSize: "1rem",
          marginTop: "2rem"
        },
        children: "Click on the AbsoluteJS and React logos to learn more."
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}, "KyfSI8DqiXM=");
$RefreshReg$(App, "example/react/components/App.tsx:App");

// example/react/components/Dropdown.tsx
import { useState as useState2 } from "/react/vendor/react.js";
import { jsxDEV as jsxDEV2 } from "/react/vendor/react_jsx-dev-runtime.js";
var _s2 = $RefreshSig$();
var Dropdown = _s2(() => {
  _s2();
  const [isOpen, setIsOpen] = useState2(false);
  return /* @__PURE__ */ jsxDEV2("details", {
    onPointerEnter: () => setIsOpen(true),
    onPointerLeave: () => setIsOpen(false),
    open: isOpen,
    children: [
      /* @__PURE__ */ jsxDEV2("summary", {
        children: "Pages"
      }, undefined, false, undefined, this),
      /* @__PURE__ */ jsxDEV2("nav", {
        children: [
          /* @__PURE__ */ jsxDEV2("a", {
            href: "/html",
            children: "HTML"
          }, undefined, false, undefined, this),
          /* @__PURE__ */ jsxDEV2("a", {
            href: "/react",
            children: "React"
          }, undefined, false, undefined, this),
          /* @__PURE__ */ jsxDEV2("a", {
            href: "/htmx",
            children: "HTMX"
          }, undefined, false, undefined, this),
          /* @__PURE__ */ jsxDEV2("a", {
            href: "/svelte",
            children: "Svelte"
          }, undefined, false, undefined, this),
          /* @__PURE__ */ jsxDEV2("a", {
            href: "/vue",
            children: "Vue"
          }, undefined, false, undefined, this),
          /* @__PURE__ */ jsxDEV2("a", {
            href: "/angular",
            children: "Angular"
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this)
    ]
  }, undefined, true, undefined, this);
}, "QXzjUcNF5ok=");
$RefreshReg$(Dropdown, "example/react/components/Dropdown.tsx:Dropdown");

// example/react/components/Head.tsx
import { jsxDEV as jsxDEV3 } from "/react/vendor/react_jsx-dev-runtime.js";
var Head = ({
  title = "AbsoluteJS + React",
  description = "AbsoluteJS React Example",
  icon = "/assets/ico/favicon.ico",
  font = "Poppins",
  cssPath
}) => /* @__PURE__ */ jsxDEV3("head", {
  suppressHydrationWarning: true,
  children: [
    /* @__PURE__ */ jsxDEV3("meta", {
      charSet: "utf-8"
    }, undefined, false, undefined, this),
    /* @__PURE__ */ jsxDEV3("title", {
      children: title
    }, undefined, false, undefined, this),
    /* @__PURE__ */ jsxDEV3("meta", {
      content: description,
      name: "description"
    }, undefined, false, undefined, this),
    /* @__PURE__ */ jsxDEV3("meta", {
      content: "width=device-width, initial-scale=1",
      name: "viewport"
    }, undefined, false, undefined, this),
    /* @__PURE__ */ jsxDEV3("link", {
      href: icon,
      rel: "icon"
    }, undefined, false, undefined, this),
    /* @__PURE__ */ jsxDEV3("link", {
      href: "https://fonts.googleapis.com",
      rel: "preconnect"
    }, undefined, false, undefined, this),
    /* @__PURE__ */ jsxDEV3("link", {
      crossOrigin: "anonymous",
      href: "https://fonts.gstatic.com",
      rel: "preconnect",
      suppressHydrationWarning: true
    }, undefined, false, undefined, this),
    /* @__PURE__ */ jsxDEV3("link", {
      href: `https://fonts.googleapis.com/css2?family=${font}:wght@100..900&display=swap`,
      rel: "stylesheet",
      suppressHydrationWarning: true
    }, undefined, false, undefined, this),
    cssPath && /* @__PURE__ */ jsxDEV3("link", {
      href: cssPath,
      rel: "stylesheet",
      suppressHydrationWarning: true,
      type: "text/css"
    }, undefined, false, undefined, this)
  ]
}, undefined, true, undefined, this);
$RefreshReg$(Head, "example/react/components/Head.tsx:Head");

// example/react/pages/ReactExample.tsx
import { jsxDEV as jsxDEV4 } from "/react/vendor/react_jsx-dev-runtime.js";
var ReactExample = ({ initialCount, cssPath }) => /* @__PURE__ */ jsxDEV4("html", {
  children: [
    /* @__PURE__ */ jsxDEV4(Head, {
      cssPath
    }, undefined, false, undefined, this),
    /* @__PURE__ */ jsxDEV4("body", {
      children: [
        /* @__PURE__ */ jsxDEV4("header", {
          children: [
            /* @__PURE__ */ jsxDEV4("a", {
              href: "/",
              children: "AbsoluteJS"
            }, undefined, false, undefined, this),
            /* @__PURE__ */ jsxDEV4(Dropdown, {}, undefined, false, undefined, this)
          ]
        }, undefined, true, undefined, this),
        /* @__PURE__ */ jsxDEV4(App, {
          initialCount
        }, undefined, false, undefined, this)
      ]
    }, undefined, true, undefined, this)
  ]
}, undefined, true, undefined, this);
$RefreshReg$(ReactExample, "example/react/pages/ReactExample.tsx:ReactExample");

// example/react/indexes/ReactExample.tsx
window.__HMR_FRAMEWORK__ = "react";
window.__REACT_COMPONENT_KEY__ = "ReactExampleIndex";

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
    window.__ERROR_BOUNDARY__ = this;
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error) {
    showErrorOverlay({
      framework: "react",
      kind: "runtime",
      message: error && error.stack ? error.stack : String(error)
    });
  }
  componentDidUpdate(prevProps, prevState) {
    if (prevState.hasError && !this.state.hasError) {
      hideErrorOverlay();
    }
  }
  reset() {
    this.setState({ hasError: false });
  }
  render() {
    if (this.state.hasError)
      return null;
    return this.props.children;
  }
}
var isDev = true;
var componentPath = "../pages/ReactExample";
function isHydrationError(error) {
  if (!error)
    return false;
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorString = String(error);
  const fullMessage = errorMessage + " " + errorString;
  const hydrationKeywords = ["hydration", "Hydration", "mismatch", "Mismatch", "did not match", "server rendered HTML", "server HTML", "client HTML", "Hydration failed"];
  const isHydration = hydrationKeywords.some((keyword) => fullMessage.includes(keyword));
  if (isHydration) {
    const isHeadRelated = fullMessage.includes("<head") || fullMessage.includes("</head>") || fullMessage.includes("head>") || fullMessage.includes("<link") || fullMessage.includes("link>") || fullMessage.includes("stylesheet") || fullMessage.includes("fonts.googleapis") || fullMessage.includes('rel="stylesheet"');
    const hasWhitespacePattern = /\{\s*["']\\n[^"']*["']\s*\}/.test(fullMessage) || /\{\s*["'][\\n\\r\\s]+["']\s*\}/.test(fullMessage) || /-\s*\{\s*["'][\\n\\r\\s]+["']\s*\}/.test(fullMessage);
    const isWhitespaceOnly = /^[\s\n\r]*$/.test(errorString) || /^[\s\n\r]*$/.test(errorMessage);
    const hasNewlinePattern = fullMessage.includes("\\n") || fullMessage.includes("\\r") || fullMessage.includes(`
`) || fullMessage.includes("\r");
    if (isHeadRelated && (hasWhitespacePattern || isWhitespaceOnly || hasNewlinePattern)) {
      return false;
    }
  }
  return isHydration;
}
function logHydrationError(error, componentName) {
  if (!isDev)
    return;
  if (window.__HMR_WS__ && window.__HMR_WS__.readyState === WebSocket.OPEN) {
    try {
      window.__HMR_WS__.send(JSON.stringify({
        type: "hydration-error",
        data: {
          componentName: "ReactExample",
          componentPath,
          error: error instanceof Error ? error.message : String(error),
          timestamp: Date.now()
        }
      }));
    } catch (err) {}
  }
}
var hasSwitchedToClientOnly = false;
var hydrationErrorDetected = false;
function handleHydrationFallback(error) {
  if (hasSwitchedToClientOnly)
    return;
  hasSwitchedToClientOnly = true;
  hydrationErrorDetected = true;
  logHydrationError(error, "ReactExample");
  try {
    if (window.__REACT_ROOT__ && typeof window.__REACT_ROOT__.unmount === "function") {
      try {
        window.__REACT_ROOT__.unmount();
      } catch (e) {}
    }
    const root = createRoot(container);
    root.render(createElement(ErrorBoundary, null, createElement(ReactExample, mergedProps)));
    window.__REACT_ROOT__ = root;
    window.__HMR_CLIENT_ONLY_MODE__ = true;
  } catch (fallbackError) {
    window.location.reload();
  }
}
var preservedState = typeof window !== "undefined" && window.__HMR_PRESERVED_STATE__ ? window.__HMR_PRESERVED_STATE__ : {};
if (typeof window !== "undefined" && typeof sessionStorage !== "undefined") {
  const hmrStateJson = sessionStorage.getItem("__REACT_HMR_STATE__");
  if (hmrStateJson) {
    try {
      const hmrState2 = JSON.parse(hmrStateJson);
      preservedState = { ...preservedState, ...hmrState2 };
      sessionStorage.removeItem("__REACT_HMR_STATE__");
    } catch (e) {}
  }
}
var mergedProps = { ...window.__INITIAL_PROPS__ || {}, ...preservedState };
if (typeof window !== "undefined") {
  window.__HMR_PRESERVED_STATE__ = undefined;
}
var container = typeof document !== "undefined" ? document : null;
if (!container) {
  throw new Error("React root container not found: document is null");
}
if (!window.__REACT_ROOT__) {
  let root;
  try {
    root = hydrateRoot(container, createElement(ErrorBoundary, null, createElement(ReactExample, mergedProps)), {
      onRecoverableError: (error) => {
        if (isDev && isHydrationError(error)) {
          handleHydrationFallback(error);
        } else {
          const errorMessage = error instanceof Error ? error.message : String(error);
          const errorString = String(error);
          const fullMessage = errorMessage + " " + errorString;
          const hydrationKeywords = ["hydration", "Hydration", "mismatch", "Mismatch", "did not match", "server rendered HTML", "server HTML", "client HTML", "Hydration failed"];
          const isHydration = hydrationKeywords.some((keyword) => fullMessage.includes(keyword));
          if (isHydration) {
            const isHeadRelated = fullMessage.includes("<head") || fullMessage.includes("</head>") || fullMessage.includes("head>") || fullMessage.includes("<link") || fullMessage.includes("link>") || fullMessage.includes("stylesheet") || fullMessage.includes("fonts.googleapis") || fullMessage.includes('rel="stylesheet"');
            const hasWhitespacePattern = /\{\s*["']\\n[^"']*["']\s*\}/.test(fullMessage) || /\{\s*["'][\\n\\r\\s]+["']\s*\}/.test(fullMessage) || /-\s*\{\s*["'][\\n\\r\\s]+["']\s*\}/.test(fullMessage);
            const isWhitespaceOnly = /^[\s\n\r]*$/.test(errorString) || /^[\s\n\r]*$/.test(errorMessage);
            const hasNewlinePattern = fullMessage.includes("\\n") || fullMessage.includes("\\r") || fullMessage.includes(`
`) || fullMessage.includes("\r");
            if (isHeadRelated && (hasWhitespacePattern || isWhitespaceOnly || hasNewlinePattern)) {
              return;
            }
          }
          console.error("React recoverable error:", error);
        }
      }
    });
    window.__REACT_ROOT__ = root;
  } catch (error) {
    if (isDev && isHydrationError(error)) {
      handleHydrationFallback(error);
    } else {
      throw error;
    }
  }
  if (isDev) {
    const originalError = console.error;
    console.error = function(...args) {
      const errorMessage = args.map((arg) => {
        if (arg instanceof Error)
          return arg.message;
        return String(arg);
      }).join(" ");
      if (isHydrationError({ message: errorMessage }) && !hydrationErrorDetected) {
        hydrationErrorDetected = true;
        const syntheticError = new Error(errorMessage);
        setTimeout(() => {
          handleHydrationFallback(syntheticError);
        }, 0);
      }
      originalError.apply(console, args);
    };
  }
}
