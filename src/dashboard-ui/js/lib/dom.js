/**
 * DOM helpers for the dashboard.
 *
 * Markup is sanitized with DOMPurify before it reaches the document: parsing in
 * an inert document is not sanitization, and event-handler attributes or
 * `javascript:` URLs would become live once inserted. If the sanitizer is not
 * loaded, `setHtml` fails closed and renders the value as text.
 */
(() => {
  const ENTITIES = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ENTITIES[ch]);
  }

  function sanitizeFragment(html) {
    const purify = window.DOMPurify;
    if (!purify || typeof purify.sanitize !== "function") return null;

    const fragment = purify.sanitize(String(html ?? ""), {
      RETURN_DOM_FRAGMENT: true,
      USE_PROFILES: { html: true, svg: true },
      ADD_ATTR: ["target"],
      FORBID_ATTR: ["style"],
    });

    return document.importNode(fragment, true);
  }

  // Rows/cells must be parsed inside their real parent, otherwise the HTML
  // parser drops them (a bare <tr> is not valid in a div).
  const TABLE_WRAPPERS = {
    TABLE: ["<table>", "</table>"],
    THEAD: ["<table><thead>", "</thead></table>"],
    TBODY: ["<table><tbody>", "</tbody></table>"],
    TFOOT: ["<table><tfoot>", "</tfoot></table>"],
    TR: ["<table><tbody><tr>", "</tr></tbody></table>"],
    SELECT: ["<select>", "</select>"],
    OPTGROUP: ["<select><optgroup>", "</optgroup></select>"],
    UL: ["<ul>", "</ul>"],
    OL: ["<ol>", "</ol>"],
  };

  function nodesFor(target, html) {
    const wrapper = TABLE_WRAPPERS[(target?.tagName || "").toUpperCase()];
    if (!wrapper) {
      const fragment = sanitizeFragment(html);
      return fragment
        ? Array.from(fragment.childNodes, (node) => document.importNode(node, true))
        : null;
    }

    const wrapped = sanitizeFragment(wrapper[0] + String(html ?? "") + wrapper[1]);
    if (!wrapped) return null;
    const holder = wrapped.querySelector((target.tagName || "").toLowerCase());
    return holder ? Array.from(holder.childNodes, (node) => document.importNode(node, true)) : [];
  }

  function setHtml(target, html) {
    if (!target) return;
    const nodes = nodesFor(target, html);
    if (nodes) {
      target.replaceChildren(...nodes);
      return;
    }
    target.textContent = String(html ?? "");
  }

  function appendHtml(target, html) {
    if (!target) return;
    const nodes = nodesFor(target, html);
    if (nodes) {
      target.append(...nodes);
      return;
    }
    target.append(document.createTextNode(String(html ?? "")));
  }

  window.UI = { setHtml, appendHtml, escapeHtml };
})();
