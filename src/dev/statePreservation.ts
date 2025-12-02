/* State Preservation Utilities for HMR
   These utilities help preserve frontend state (form data, component state, etc.)
   across HMR updates so developers don't lose their work */

/* Save form data from all forms on the page */
export const saveFormState = () => {
  const formState: Record<string, Record<string, string | boolean>> = {};
  
  // Find all forms
  const forms = document.querySelectorAll('form');
  forms.forEach((form, formIndex) => {
    const formId = form.id || `form-${formIndex}`;
    formState[formId] = {};
    
    // Save all input values
    const inputs = form.querySelectorAll('input, textarea, select');
    inputs.forEach((input) => {
      const element = input as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      const name = element.name || element.id || `input-${formIndex}-${inputs.length}`;
      
      if (element.type === 'checkbox' || element.type === 'radio') {
        formState[formId][name] = (element as HTMLInputElement).checked;
      } else {
        formState[formId][name] = element.value;
      }
    });
  });
  
  // Also save standalone inputs/textarea/select elements not in forms
  const standaloneInputs = document.querySelectorAll('input:not(form input), textarea:not(form textarea), select:not(form select)');
  if (standaloneInputs.length > 0) {
    formState['__standalone__'] = {};
    standaloneInputs.forEach((input) => {
      const element = input as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      const name = element.name || element.id || `standalone-${standaloneInputs.length}`;
      
      if (element.type === 'checkbox' || element.type === 'radio') {
        formState['__standalone__'][name] = (element as HTMLInputElement).checked;
      } else {
        formState['__standalone__'][name] = element.value;
      }
    });
  }
  
  return formState;
};

/* Restore form data to all forms on the page */
export const restoreFormState = (formState: Record<string, Record<string, string | boolean>>) => {
  Object.keys(formState).forEach((formId) => {
    const isStandalone = formId === '__standalone__';
    const form = isStandalone ? null : document.getElementById(formId) || document.querySelector(`form:nth-of-type(${parseInt(formId.replace('form-', '')) + 1})`);
    
    Object.keys(formState[formId]).forEach((name) => {
      let element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null = null;
      
      if (isStandalone) {
        // Find standalone input by name or id
        element = document.querySelector(`input[name="${name}"], textarea[name="${name}"], select[name="${name}"]`) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
        if (!element) {
          element = document.getElementById(name) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
        }
      } else if (form) {
        // Find input within form
        element = form.querySelector(`[name="${name}"], #${name}`) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
      }
      
      if (element) {
        const value = formState[formId][name];
        if (element.type === 'checkbox' || element.type === 'radio') {
          (element as HTMLInputElement).checked = value === true;
        } else {
          element.value = String(value);
        }
      }
    });
  });
};

/* Save scroll position for the page and all scrollable elements */
export const saveScrollState = () => {
  const scrollState: {
    window: { x: number; y: number };
    elements: Array<{ selector: string; scrollTop: number; scrollLeft: number }>;
  } = {
    window: {
      x: window.scrollX || window.pageXOffset,
      y: window.scrollY || window.pageYOffset
    },
    elements: []
  };
  
  // Find all scrollable elements
  const scrollableElements = document.querySelectorAll('*');
  scrollableElements.forEach((element) => {
    const htmlElement = element as HTMLElement;
    const hasScroll = htmlElement.scrollHeight > htmlElement.clientHeight || htmlElement.scrollWidth > htmlElement.clientWidth;
    
    if (hasScroll && (htmlElement.scrollTop > 0 || htmlElement.scrollLeft > 0)) {
      const selector = htmlElement.id 
        ? `#${htmlElement.id}` 
        : htmlElement.className 
          ? `.${htmlElement.className.split(' ')[0]}` 
          : htmlElement.tagName.toLowerCase();
      
      scrollState.elements.push({
        selector,
        scrollTop: htmlElement.scrollTop,
        scrollLeft: htmlElement.scrollLeft
      });
    }
  });
  
  return scrollState;
};

/* Restore scroll position for the page and all scrollable elements */
export const restoreScrollState = (scrollState: {
  window: { x: number; y: number };
  elements: Array<{ selector: string; scrollTop: number; scrollLeft: number }>;
}) => {
  // Restore window scroll
  window.scrollTo(scrollState.window.x, scrollState.window.y);
  
  // Restore element scroll
  scrollState.elements.forEach(({ selector, scrollTop, scrollLeft }) => {
    try {
      const element = document.querySelector(selector) as HTMLElement;
      if (element) {
        element.scrollTop = scrollTop;
        element.scrollLeft = scrollLeft;
      }
    } catch (error) {
      // Ignore selector errors
    }
  });
};

/* Save Vue component state (reactive refs, props, etc.) */
export const saveVueState = () => {
  const vueState: Record<string, unknown> = {};
  
  // Vue stores component instances on DOM elements
  // We need to traverse the DOM and extract state from Vue components
  const rootContainer = document.getElementById('root');
  if (!rootContainer) {
    return vueState;
  }
  
  // Vue attaches component instances to elements
  // We'll look for Vue's internal markers and try to extract state
  // This is a simplified approach - Vue's internal structure is complex
  const vueElements = rootContainer.querySelectorAll('[data-v-*]');
  
  vueElements.forEach((element, index) => {
    const htmlElement = element as HTMLElement & { __vueParentComponent?: unknown };
    if (htmlElement.__vueParentComponent) {
      // Try to extract state from Vue component
      // This is a best-effort approach since Vue's internals are not public API
      const componentKey = `vue-component-${index}`;
      vueState[componentKey] = {
        // Store element attributes that might contain state
        attributes: Array.from(htmlElement.attributes).reduce((acc, attr) => {
          acc[attr.name] = attr.value;
          return acc;
        }, {} as Record<string, string>),
        // Store text content as fallback
        textContent: htmlElement.textContent
      };
    }
  });
  
  return vueState;
};

/* Save Svelte component state */
export const saveSvelteState = () => {
  const svelteState: Record<string, unknown> = {};
  
  // Svelte stores component instances differently
  // We'll save form data and any data attributes that might contain state
  const svelteElements = document.querySelectorAll('[data-svelte-h]');
  
  svelteElements.forEach((element, index) => {
    const htmlElement = element as HTMLElement;
    const componentKey = `svelte-component-${index}`;
    svelteState[componentKey] = {
      attributes: Array.from(htmlElement.attributes).reduce((acc, attr) => {
        acc[attr.name] = attr.value;
        return acc;
      }, {} as Record<string, string>),
      textContent: htmlElement.textContent
    };
  });
  
  return svelteState;
};

/* Save all state (forms, scroll, framework-specific) */
export const saveAllState = (framework?: string) => {
  const state = {
    forms: saveFormState(),
    scroll: saveScrollState(),
    timestamp: Date.now()
  };
  
  if (framework === 'vue') {
    return { ...state, vue: saveVueState() };
  }
  
  if (framework === 'svelte') {
    return { ...state, svelte: saveSvelteState() };
  }
  
  return state;
};

/* Restore all state */
export const restoreAllState = (state: ReturnType<typeof saveAllState>, framework?: string) => {
  // Restore forms first (before scroll, as form restoration might change layout)
  if (state.forms) {
    restoreFormState(state.forms);
  }
  
  // Restore scroll after a brief delay to allow DOM to settle
  if (state.scroll) {
    // Use requestAnimationFrame to ensure DOM is ready
    requestAnimationFrame(() => {
      restoreScrollState(state.scroll);
    });
  }
  
  // Framework-specific state restoration would go here
  // For Vue and Svelte, we rely on the frameworks' own state management
  // since their internal state structures are not easily accessible
};

/**
 * Extract state automatically using framework introspection
 * This is a wrapper that dynamically imports the automatic extraction module
 */
export async function extractStateAutomatically(container: HTMLElement = document.body) {
  try {
    const { extractAllStateAutomatically, stateToProps } = await import('./automaticStateExtraction');
    const extractedState = extractAllStateAutomatically(container);
    const props = stateToProps(extractedState);
    return props;
  } catch (error) {
    console.warn('⚠️ Automatic state extraction failed, using fallback:', error);
    // Fallback to manual extraction
    return {};
  }
}

