function humanize(key) {
  return String(key).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ')
    .replace(/^./, letter => letter.toUpperCase());
}

export function planFieldLocations(page) {
  const imageFields = new Set(Object.keys(page.fieldSelectors ?? {}));
  const scalarOrder = Object.keys(page.fields ?? {}).filter(name => name !== 'title' && !imageFields.has(name));
  if (page.noiseEvents?.some(event => event.type === 'reorder-fields')) scalarOrder.reverse();
  const locations = {};
  for (const name of Object.keys(page.fieldStates ?? {})) {
    if (!Object.hasOwn(page.fields ?? {}, name)) {
      locations[name] = { state: 'absent', reason: Object.hasOwn(page.canonicalValues ?? {}, name) ? 'removed' : 'source-absent' };
      continue;
    }
    if (name === 'title') {
      locations[name] = { state: 'present', selector: '#content > .page-heading > h1', read: 'textContent', precision: 'value' };
      continue;
    }
    if (page.kind === 'home' && name === 'summary') {
      locations[name] = { state: 'present', selector: '#content > .page-heading > p.lede', read: 'textContent', precision: 'value' };
      continue;
    }
    if (imageFields.has(name)) {
      locations[name] = { state: 'present', selector: `#content img[data-field="${name}"]`, read: 'urlPath', precision: 'value' };
      continue;
    }
    const position = scalarOrder.indexOf(name) + 1;
    if (page.fieldLayout === 'table') {
      locations[name] = { state: 'present', selector: `#content table.field-list > tbody > tr:nth-of-type(${position}) > td`, read: 'textContent', precision: 'value' };
    } else if (page.fieldLayout === 'paragraphs') {
      locations[name] = { state: 'present', selector: `#content section.field-list > p:nth-of-type(${position})`, read: 'afterLabel', label: page.fieldLabels?.[name] ?? humanize(name), precision: 'container' };
    } else if (page.fieldLayout === 'definition-list' || page.fieldLayout === undefined) {
      locations[name] = { state: 'present', selector: `#content dl.field-list > dd:nth-of-type(${position})`, read: 'textContent', precision: 'value' };
    } else {
      locations[name] = { state: 'ambiguous', reason: 'unsupported-field-layout' };
    }
  }
  return locations;
}
