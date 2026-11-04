function humanize(key) {
  return String(key).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ')
    .replace(/^./, letter => letter.toUpperCase());
}

export function planRepeatedItemLocations(page, site, itemSchema) {
  if (page.repeatedItems === undefined) return undefined;
  if (page.kind !== 'listing' || !site.shell || !/^listing-[012]$/.test(page.template)
    || !Array.isArray(itemSchema) || !itemSchema.some(field => field.name === 'title')
    || !Array.isArray(page.repeatedItems) || !page.repeatedItems.length) {
    throw new Error(`Unsupported repeated-item representation on ${page.pageId}`);
  }

  const table = page.template === 'listing-0' || site.shell === 'archive';
  return page.repeatedItems.map((item, index) => {
    if (!page.links.some(link => link.href === item.url)) {
      throw new Error(`Repeated item ${item.pageId} has no rendered link on ${page.pageId}`);
    }
    const position = index + 1;
    const container = table
      ? `#content table.repeated-records > tbody > tr:nth-of-type(${position}) > td`
      : `#content ul.repeated-records > li:nth-of-type(${position})`;
    const scalarOrder = Object.keys(item.fields).filter(name => name !== 'title');
    const fieldLocations = {};
    for (const field of itemSchema) {
      const name = field.name;
      if (!Object.hasOwn(item.fields, name)) {
        if (!field.optional) throw new Error(`Repeated item ${item.pageId} is missing required field ${name}`);
        fieldLocations[name] = { state: 'absent', reason: 'source-absent' };
      } else if (name === 'title') {
        fieldLocations[name] = { state: 'present', selector: `${container} > a`, read: 'textContent', precision: 'value' };
      } else {
        const scalarPosition = scalarOrder.indexOf(name) + 1;
        if (scalarPosition === 0) throw new Error(`Unsupported repeated-item field ${name} on ${item.pageId}`);
        fieldLocations[name] = { state: 'present', selector: `${container} > p:nth-of-type(${scalarPosition})`,
          read: 'afterStrongLabel', label: humanize(name), precision: 'container' };
      }
    }
    return { pageId: item.pageId, url: item.url, fieldLocations };
  });
}
