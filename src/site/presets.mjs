const field = (name, type = 'text', optional = false) => ({ name, type, ...(optional ? { optional } : {}) });
const type = (name, title, fields, relationTo) => ({ name, label: title, weight: 1, fields: [field('title', 'title'), ...fields.map(v => Array.isArray(v) ? field(...v) : field(v))], ...(relationTo ? { relationTo } : {}) });

export const PRESETS = {
  library: {
    name: 'Northstar Public Library', description: 'Books, authors, local history and community learning.',
    topics: ['oral history', 'coastal architecture', 'public gardens', 'local photography', 'community archives', 'regional literature'],
    types: [type('book', 'Books', [['author', 'person'], ['publicationDate', 'date'], ['isbn', 'isbn'], 'summary', ['coverImage', 'image', true]], 'author'), type('author', 'Authors', [['name', 'person'], 'biography', ['region', 'place']]), type('event', 'Events', [['startDate', 'date'], ['location', 'place'], 'description'], 'branch'), type('branch', 'Branches', [['address', 'address'], 'openingHours', 'services'])]
  },
  government: {
    name: 'Alder State Services', description: 'Public programs, policy guidance and agency publications.',
    topics: ['water conservation', 'transport planning', 'housing support', 'public procurement', 'energy efficiency', 'workforce development'],
    types: [type('program', 'Programs', ['eligibility', 'applicationProcess', ['deadline', 'date']], 'department'), type('department', 'Departments', [['director', 'person'], 'responsibilities', ['location', 'place']]), type('policy', 'Policies', [['effectiveDate', 'date'], 'policyNumber', 'summary'], 'department'), type('publication', 'Publications', [['publicationDate', 'date'], 'abstract', 'documentNumber'])]
  },
  municipality: {
    name: 'City of Silverbrook', description: 'Neighborhood services, public facilities and council information.',
    topics: ['street maintenance', 'recycling collection', 'park access', 'building permits', 'neighborhood planning', 'public transport'],
    types: [type('service', 'Services', ['requirements', 'applicationProcess', 'serviceArea'], 'office'), type('office', 'Offices', [['address', 'address'], ['manager', 'person'], 'openingHours']), type('meeting', 'Meetings', [['meetingDate', 'date'], 'agenda', ['location', 'place']]), type('notice', 'Notices', [['publicationDate', 'date'], 'summary', 'reference'])]
  },
  university: {
    name: 'Westhaven University', description: 'Academic programs, faculty research and campus resources.',
    topics: ['environmental systems', 'urban design', 'digital humanities', 'public policy', 'applied mathematics', 'materials science'],
    types: [type('course', 'Courses', ['courseCode', 'credits', 'syllabus'], 'faculty'), type('faculty', 'Faculty', [['name', 'person'], 'researchInterests', 'biography']), type('program', 'Programs', ['qualification', 'requirements', 'duration']), type('research', 'Research', [['publicationDate', 'date'], 'abstract', 'fundingSource'], 'faculty')]
  },
  healthcare: {
    name: 'Clearwater Community Health', description: 'Fictional service directories, facilities and educational publications.',
    topics: ['clinic access', 'community services', 'appointment preparation', 'facility accessibility', 'staff education', 'public outreach'],
    types: [type('service', 'Services', ['description', 'referralProcess', 'accessibility'], 'clinic'), type('clinic', 'Clinics', [['address', 'address'], 'openingHours', 'facilities']), type('provider', 'Providers', [['name', 'person'], 'specialty', 'biography'], 'clinic'), type('article', 'Resources', [['publicationDate', 'date'], 'summary', 'audience'])]
  },
  documentation: {
    name: 'Beacon Developer Library', description: 'Reference guides, release notes and integration examples.',
    topics: ['data synchronization', 'request validation', 'event delivery', 'cache management', 'access configuration', 'batch processing'],
    types: [type('guide', 'Guides', ['overview', 'prerequisites', 'steps']), type('reference', 'Reference', ['identifier', 'parameters', 'returnValue']), type('release', 'Releases', ['version', ['releaseDate', 'date'], 'changes']), type('tutorial', 'Tutorials', ['difficulty', 'overview', 'steps'], 'guide')]
  },
  museum: {
    name: 'Meridian Museum', description: 'Collections, exhibitions, creators and learning resources.',
    topics: ['ceramic traditions', 'industrial heritage', 'textile design', 'maritime maps', 'public sculpture', 'community photography'],
    types: [type('object', 'Collection', ['accessionNumber', 'material', 'description'], 'creator'), type('creator', 'Creators', [['name', 'person'], ['region', 'place'], 'biography']), type('exhibition', 'Exhibitions', [['startDate', 'date'], ['endDate', 'date'], 'overview']), type('resource', 'Learning', ['audience', 'summary', 'activity'])]
  },
  nonprofit: {
    name: 'Common Ground Foundation', description: 'Community projects, funding opportunities and impact reports.',
    topics: ['food access', 'adult learning', 'community gardens', 'volunteer training', 'local arts', 'neighborhood resilience'],
    types: [type('project', 'Projects', [['location', 'place'], 'objectives', 'outcomes']), type('grant', 'Grants', ['eligibility', ['deadline', 'date'], 'awardAmount'], 'project'), type('report', 'Reports', [['publicationDate', 'date'], 'summary', 'reportingPeriod']), type('opportunity', 'Volunteer', ['responsibilities', 'requirements', ['location', 'place']])]
  },
  records: {
    name: 'Pine County Records', description: 'Public document catalog, record series and archive finding aids.',
    topics: ['council minutes', 'land surveys', 'planning records', 'historic maps', 'budget reports', 'infrastructure records'],
    types: [type('record', 'Records', ['recordNumber', ['recordDate', 'date'], 'abstract'], 'collection'), type('collection', 'Collections', ['dateRange', 'scope', 'custodian']), type('findingAid', 'Finding Aids', ['reference', 'description', 'accessConditions'], 'collection'), type('office', 'Offices', [['address', 'address'], 'openingHours', 'responsibilities'])]
  },
  news: {
    name: 'The Harbor Chronicle', description: 'Local reporting, community features and a searchable news archive.',
    topics: ['public transport', 'arts funding', 'coastal planning', 'local enterprise', 'school programs', 'community history'],
    types: [type('article', 'News', [['publicationDate', 'date'], 'summary', 'body'], 'journalist'), type('journalist', 'Writers', [['name', 'person'], 'biography', 'beat']), type('feature', 'Features', [['publicationDate', 'date'], 'summary', 'body'], 'journalist'), type('edition', 'Editions', [['publicationDate', 'date'], 'issueNumber', 'overview'])]
  }
};

export const DOMAINS = Object.keys(PRESETS);
export function presetConfig(domain, index = 0) {
  if (!PRESETS[domain]) throw new Error(`Unknown domain: ${domain}`);
  const framework = ['html', 'react', 'angular', 'html'][index % 4];
  return { version: 1, seed: 48291 + index, site: { id: `${domain}-${index + 1}`, name: PRESETS[domain].name, domain, framework, visualStyle: ['legacy', 'conventional', 'modern'][index % 3], pageCount: 500 }, noise: { level: ['clean', 'low', 'medium', 'high'][index % 4] } };
}
