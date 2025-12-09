/* State Preservation Utilities for HMR
   These utilities help preserve frontend state (form data, component state, etc.)
   across HMR updates so developers don't lose their work */

import './types/window-globals'; // Ensure Window interface is extended

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
    const formData = formState[formId]!; // Safe: we just created it above
    inputs.forEach((input) => {
      const element = input as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      const name = element.name || element.id || `input-${formIndex}-${inputs.length}`;
      
      if (element.type === 'checkbox' || element.type === 'radio') {
        formData[name] = (element as HTMLInputElement).checked;
      } else {
        formData[name] = element.value;
      }
    });
  });
  
  // Also save standalone inputs/textarea/select elements not in forms
  const standaloneInputs = document.querySelectorAll('input:not(form input), textarea:not(form textarea), select:not(form select)');
  if (standaloneInputs.length > 0) {
    const standaloneData: Record<string, string | boolean> = {};
    formState['__standalone__'] = standaloneData;
    standaloneInputs.forEach((input) => {
      const element = input as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      const name = element.name || element.id || `standalone-${standaloneInputs.length}`;
      
      if (element.type === 'checkbox' || element.type === 'radio') {
        standaloneData[name] = (element as HTMLInputElement).checked;
      } else {
        standaloneData[name] = element.value;
      }
    });
  }
  
  return formState;
};

/* Restore form data to all forms on the page */
export const restoreFormState = (formState: Record<string, Record<string, string | boolean>>) => {
  Object.keys(formState).forEach((formId) => {
    const formData = formState[formId];
    if (!formData) return; // Skip if form data doesn't exist
    
    const isStandalone = formId === '__standalone__';
    const form = isStandalone ? null : document.getElementById(formId) || document.querySelector(`form:nth-of-type(${parseInt(formId.replace('form-', '')) + 1})`);
    
    Object.keys(formData).forEach((name) => {
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
        const value = formData[name];
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
