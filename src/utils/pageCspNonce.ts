import { readPageNonce } from '../dev/client/cspNonce';
import { readCspNonce } from './cspNonceRef';

/** This page's Content-Security-Policy nonce, for the inline `<script>` and
 *  `<style>` tags a page component writes itself:
 *
 *  ```tsx
 *  <script nonce={getCspNonce()} dangerouslySetInnerHTML={{ __html: code }} />
 *  ```
 *
 *  Safe in code that also runs in the browser. During SSR it is the
 *  request's nonce (the one in the policy header); in the browser it is the
 *  same value, read back from the page's own scripts, so the component
 *  renders the same nonce on both sides. Undefined without
 *  `secureHeaders()`. In a route handler, `cspNonce` in the context is the
 *  same value. */
export const getCspNonce = () => readCspNonce() ?? readPageNonce();
