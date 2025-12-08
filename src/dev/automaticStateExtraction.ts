/**
 * Automatic State Extraction - Zero Configuration Required
 * 
 * This module extracts component state directly from framework internals
 * without requiring any developer intervention (no data attributes, no API calls).
 * 
 * Works by introspecting framework-specific internal data structures.
 */

import type { 
  SvelteComponentInternal,
  ReactFiber,
  VueComponentInternal 
} from './types/framework-internals';
import './types/window-globals'; // Ensure Window interface is extended

export type ExtractedState = Record<string, unknown>;

/**
 * Extract state from React Fiber internals
 * React stores component state in the Fiber tree structure
 */
export function extractReactState(container: HTMLElement = document.body): ExtractedState {
  const state: ExtractedState = {};
  
  try {
    // Find React Fiber root
    // React attaches internal properties to DOM nodes with keys like __reactFiber$...
    const reactRootKeys = Object.keys(container).filter(key => 
      key.startsWith('__reactContainer') || 
      key.startsWith('__reactFiber') ||
      key.startsWith('_reactRootContainer')
    );
    
    if (reactRootKeys.length === 0) {
      // Try to find any element with React fiber
      const allElements = container.querySelectorAll('*');
      for (const element of Array.from(allElements)) {
        const fiberKeys = Object.keys(element).filter(key => key.startsWith('__reactFiber'));
        if (fiberKeys.length > 0) {
          const fiberKey = fiberKeys[0];
          // React attaches fiber to DOM elements via internal properties
          // Type assertion needed to access framework internals
          const fiber = (element as unknown as Record<string, unknown>)[fiberKey] as ReactFiber | null | undefined;
          if (fiber) {
            extractStateFromFiber(fiber, state);
          }
          break;
        }
      }
    } else {
      const rootKey = reactRootKeys[0];
      // React attaches root to container via internal properties
      const root = (container as unknown as Record<string, unknown>)[rootKey] as {
        current?: ReactFiber | null;
        _internalRoot?: { current?: ReactFiber | null };
      } | null | undefined;
      
      if (root?.current) {
        extractStateFromFiber(root.current, state);
      } else if (root?._internalRoot?.current) {
        extractStateFromFiber(root._internalRoot.current, state);
      }
    }
    
    if (Object.keys(state).length > 0) {
      console.log('📦 Automatically extracted React state:', state);
    }
  } catch (error) {
    console.warn('⚠️ Failed to extract React state automatically:', error);
  }
  
  return state;
}

/**
 * Recursively extract state from React Fiber nodes
 * @internal - Uses React internal Fiber structure
 */
function extractStateFromFiber(fiber: ReactFiber | null | undefined, state: ExtractedState, depth = 0): void {
  if (!fiber || depth > 50) return; // Prevent infinite recursion
  
  try {
    // Extract useState hooks
    if (fiber.memoizedState) {
      let hook = fiber.memoizedState;
      let hookIndex = 0;
      
      while (hook && hookIndex < 20) {
        // Hook.memoizedState contains the current state value
        if (hook.memoizedState !== undefined && hook.memoizedState !== null) {
          const value = hook.memoizedState;
          
          // Skip functions and complex objects that are likely callbacks
          if (typeof value !== 'function' && value !== hook) {
            // Use hook index or try to infer name from component
            const key = `state_${hookIndex}`;
            
            // If it's a primitive or simple object, store it
            if (isPrimitiveOrSimpleObject(value)) {
              state[key] = value;
            }
          }
        }
        
        hook = hook.next;
        hookIndex++;
      }
    }
    
    // Also check props for controlled components
    if (fiber.memoizedProps) {
      const props = fiber.memoizedProps;
      
      // Common state-like props
      if (props.value !== undefined) state.value = props.value;
      if (props.checked !== undefined) state.checked = props.checked;
      if (props.selected !== undefined) state.selected = props.selected;
      
      // Common state patterns
      if (props.count !== undefined) state.count = props.count;
      if (props.isOpen !== undefined) state.isOpen = props.isOpen;
      if (props.activeTab !== undefined) state.activeTab = props.activeTab;
    }
    
    // Traverse child fibers
    if (fiber.child) {
      extractStateFromFiber(fiber.child, state, depth + 1);
    }
    
    // Traverse sibling fibers
    if (fiber.sibling) {
      extractStateFromFiber(fiber.sibling, state, depth);
    }
  } catch (error) {
    // Silently continue - fiber traversal can fail for various reasons
  }
}

/**
 * Extract state from Vue component instances
 * Vue 3 uses Proxy-based reactivity and stores state on component instances
 */
export function extractVueState(container: HTMLElement = document.body): ExtractedState {
  const state: ExtractedState = {};
  
  try {
    // Vue attaches __vueParentComponent to elements
    // Type assertion needed to access framework internals
    const vueElements = Array.from(container.querySelectorAll('*')).filter(el => {
      const vueComponent = (el as unknown as { __vueParentComponent?: unknown }).__vueParentComponent;
      return !!vueComponent;
    });
    
    if (vueElements.length > 0) {
      const element = vueElements[0];
      const component = (element as unknown as { __vueParentComponent?: VueComponentInternal }).__vueParentComponent;
      
      if (component && component.proxy) {
        const proxy = component.proxy;
        
        // Extract reactive data
        if (component.data && typeof component.data === 'object') {
          Object.keys(component.data).forEach(key => {
            if (!key.startsWith('_') && !key.startsWith('$')) {
              state[key] = component.data[key];
            }
          });
        }
        
        // Extract from proxy (setup script refs)
        try {
          if (proxy.count !== undefined) state.count = proxy.count;
          if (proxy.isOpen !== undefined) state.isOpen = proxy.isOpen;
          if (proxy.activeTab !== undefined) state.activeTab = proxy.activeTab;
          if (proxy.selectedItem !== undefined) state.selectedItem = proxy.selectedItem;
        } catch (e) {
          // Proxy access might throw
        }
      }
    }
    
    if (Object.keys(state).length > 0) {
      console.log('📦 Automatically extracted Vue state:', state);
    }
  } catch (error) {
    console.warn('⚠️ Failed to extract Vue state automatically:', error);
  }
  
  return state;
}

/**
 * Extract state from Svelte component instances
 * Svelte 5 runes store state in the component's internal structure
 */
export function extractSvelteState(container: HTMLElement = document.body): ExtractedState {
  const state: ExtractedState = {};
  
  try {
    // Check if there's a Svelte component instance stored globally
    if (typeof window !== 'undefined' && window.__SVELTE_COMPONENT__) {
      const component = window.__SVELTE_COMPONENT__;
      
      // Svelte 5 components have internal state
      if (component.$$ && component.$$.ctx) {
        const ctx = component.$$.ctx;
        
        // ctx is an array containing component state
        if (Array.isArray(ctx)) {
          ctx.forEach((value, index) => {
            if (value !== undefined && value !== null && isPrimitiveOrSimpleObject(value)) {
              // Skip functions and internal Svelte objects
              if (typeof value !== 'function' && !isInternalSvelteObject(value)) {
                state[`state_${index}`] = value;
              }
            }
          });
        }
      }
    }
    
    if (Object.keys(state).length > 0) {
      console.log('📦 Automatically extracted Svelte state:', state);
    }
  } catch (error) {
    console.warn('⚠️ Failed to extract Svelte state automatically:', error);
  }
  
  return state;
}

/**
 * Extract state from HTML/HTMX (DOM-based)
 */
export function extractHTMLState(container: HTMLElement = document.body): ExtractedState {
  const state: ExtractedState = {};
  
  // Forms
  const forms = container.querySelectorAll('form');
  forms.forEach((form, index) => {
    const formId = form.id || `form_${index}`;
    const formData: Record<string, unknown> = {};
    
    const inputs = form.querySelectorAll('input, textarea, select');
    inputs.forEach((input) => {
      const element = input as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      const name = element.name || element.id;
      if (name) {
        if (element.type === 'checkbox' || element.type === 'radio') {
          formData[name] = (element as HTMLInputElement).checked;
        } else {
          formData[name] = element.value;
        }
      }
    });
    
    if (Object.keys(formData).length > 0) {
      state[formId] = formData;
    }
  });
  
  // Details/summary
  const details = container.querySelectorAll('details');
  details.forEach((detail, index) => {
    const id = detail.id || `details_${index}`;
    state[`${id}_open`] = detail.open;
  });
  
  // Elements with contenteditable
  const editables = container.querySelectorAll('[contenteditable="true"]');
  editables.forEach((editable, index) => {
    const id = editable.id || `editable_${index}`;
    state[`${id}_content`] = editable.textContent || '';
  });
  
  if (Object.keys(state).length > 0) {
    console.log('📦 Automatically extracted HTML state:', state);
  }
  
  return state;
}

/**
 * Main entry point: Extract all state automatically based on detected framework
 */
export function extractAllStateAutomatically(container: HTMLElement = document.body): ExtractedState {
  let allState: ExtractedState = {};
  
  // Try all frameworks - they may coexist on the same page
  const reactState = extractReactState(container);
  const vueState = extractVueState(container);
  const svelteState = extractSvelteState(container);
  const htmlState = extractHTMLState(container);
  
  // Merge all extracted state
  allState = {
    ...htmlState,
    ...svelteState,
    ...vueState,
    ...reactState
  };
  
  console.log('📦 Total automatically extracted state:', {
    react: Object.keys(reactState).length,
    vue: Object.keys(vueState).length,
    svelte: Object.keys(svelteState).length,
    html: Object.keys(htmlState).length,
    total: Object.keys(allState).length
  });
  
  return allState;
}

/**
 * Helper: Check if value is primitive or simple serializable object
 */
function isPrimitiveOrSimpleObject(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  
  const type = typeof value;
  if (type === 'string' || type === 'number' || type === 'boolean') return true;
  
  if (type === 'object') {
    // Check if it's a plain object or array
    if (Array.isArray(value)) {
      return value.every(item => isPrimitiveOrSimpleObject(item));
    }
    
    // Plain object check
    if (value.constructor === Object) {
      return Object.values(value).every(v => isPrimitiveOrSimpleObject(v));
    }
    
    // Date, RegExp are serializable
    if (value instanceof Date || value instanceof RegExp) return true;
  }
  
  return false;
}

/**
 * Helper: Check if object is internal Svelte structure
 */
function isInternalSvelteObject(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  
  // Svelte internal objects often have $$ property
  const obj = value as Record<string, unknown>;
  if (obj.$$ || obj.$$scope) return true;
  
  return false;
}

/**
 * Convert extracted state to props format for framework hydration
 */
export function stateToProps(extractedState: ExtractedState): ExtractedState {
  const props: ExtractedState = {};
  
  // Map common state keys to expected prop names
  Object.entries(extractedState).forEach(([key, value]) => {
    // Remove state_ prefix if present
    const propName = key.replace(/^state_/, '');
    
    // Common mappings
    if (key === 'count' || propName === '0') {
      props.initialCount = value;
    } else if (key === 'isOpen' || key === 'open') {
      props.initialIsOpen = value;
    } else if (key === 'activeTab') {
      props.initialActiveTab = value;
    } else {
      // Keep original key with initial prefix
      props[`initial${propName.charAt(0).toUpperCase()}${propName.slice(1)}`] = value;
    }
  });
  
  return props;
}

