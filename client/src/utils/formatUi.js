/**
 * Format pickers, built from the shared registry so every <select> lists the same formats.
 */
import { groupedFormats } from '../../../shared/formats.js';

const escape = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * <option>s grouped by format family.
 * @param {object} opts
 * @param {string} opts.selected format id to preselect
 * @param {string|null} opts.noneLabel label for the empty choice; null leaves it out
 * @param {boolean} opts.includeCube list the Cube format
 * @param {boolean} opts.includeLimited list Limited
 */
export function formatOptionsHtml({ selected = '', noneLabel = 'No format', includeCube = true, includeLimited = true } = {}) {
  const none = noneLabel === null ? '' : `<option value="">${escape(noneLabel)}</option>`;
  const groups = groupedFormats()
    .map(({ group, formats }) => {
      const list = formats.filter((f) => (includeCube || !f.isCube) && (includeLimited || f.id !== 'limited'));
      if (!list.length) return '';
      return `<optgroup label="${escape(group)}">${list
        .map((f) => `<option value="${f.id}"${f.id === selected ? ' selected' : ''}${f.description ? ` title="${escape(f.description)}"` : ''}>${escape(f.label)}</option>`)
        .join('')}</optgroup>`;
    })
    .join('');
  return none + groups;
}

/** Fill a <select> with formats, keeping its current value when it is still offered. */
export function fillFormatSelect(select, opts = {}) {
  if (!select) return;
  const current = opts.selected ?? select.value;
  select.innerHTML = formatOptionsHtml({ ...opts, selected: current });
  select.value = current || '';
}
