import { Faker, en } from '@faker-js/faker';

// Domain-specific fictional content so each site type reads like a real site of that kind.
// Everything here is seeded through the supplied Faker instance, so output stays repeatable.

const cap = value => String(value).replace(/^./, letter => letter.toUpperCase());
const titleCase = value => String(value).split(' ').map(word => (/^(of|and|for|the|in|on|to|a|an)$/.test(word) ? word : cap(word))).join(' ');
const pick = (faker, values) => faker.helpers.arrayElement(values);
const TOWN_START = ['Ash', 'Brook', 'Cedar', 'Clear', 'Elm', 'Fair', 'Glen', 'Green', 'Hazel', 'High', 'Lake', 'Maple', 'Mill', 'Oak', 'Pine', 'River', 'Rock', 'Silver', 'Spring', 'Stone', 'West', 'North', 'Wood', 'Willow', 'Bay', 'Hart', 'Kings', 'Marsh', 'Red', 'Sand'];
const TOWN_END = ['field', 'ford', 'dale', 'ton', 'view', 'wood', 'port', 'brook', 'ridge', 'mont', 'haven', 'bury', 'side', 'wick', 'water', 'ley'];
// Plausible fictional place names (Faker's city generator produces names like "Port Jovanny").
export const town = faker => {
  const start = pick(faker, TOWN_START);
  let end = pick(faker, TOWN_END);
  if (start.toLowerCase().endsWith(end[0])) end = end.slice(1);
  return start + end;
};
const ADJECTIVES = ['Quiet', 'Hidden', 'Long', 'Silver', 'Northern', 'Distant', 'Bright', 'Lost', 'Open', 'Winter', 'Summer', 'Golden', 'Small', 'Last', 'Painted', 'Restless'];
const NOUNS = ['Harbor', 'Garden', 'River', 'Lantern', 'Orchard', 'Bridge', 'Archive', 'Meadow', 'Window', 'Island', 'Field', 'Map', 'Season', 'Shore', 'House', 'Road'];
const adj = faker => pick(faker, ADJECTIVES);
const noun = faker => pick(faker, NOUNS);
export const personName = faker => `${faker.person.firstName()} ${faker.person.lastName()}`;
const year = index => 2019 + index % 7;

// Site names follow the naming habits of real sites in each sector.
const PRODUCTS = ['Beacon', 'Relay', 'Lumen', 'Harborline', 'Atlas', 'Quill', 'Nimbus', 'Vectorly', 'Fernway', 'Keystone', 'Cobalt', 'Driftwood', 'Emberly', 'Fathom', 'Glimmer', 'Halyard', 'Inkwell', 'Juniper', 'Kestrel', 'Lattice', 'Meridian', 'Northwind', 'Orbitly', 'Pylon', 'Quarry', 'Rivet', 'Sextant', 'Tidepool', 'Umbra', 'Waypoint'];

const SITE_NAMES = {
  library: [c => `${c} Public Library`, c => `${c} County Library`, c => `${c} Regional Library`, c => `${c} Free Library`],
  government: [(c, f) => `${f.location.state()} Department of ${pick(f, ['Commerce', 'Natural Resources', 'Housing', 'Transportation', 'Labor', 'Environmental Quality'])}`, (c, f) => `${f.location.state()} Office of Public Services`, c => `${c} State Agency for Community Affairs`],
  municipality: [c => `City of ${c}`, c => `Town of ${c}`, c => `${c} City Council`, c => `Village of ${c}`],
  university: [c => `${c} University`, c => `University of ${c}`, c => `${c} State University`, c => `${c} College`],
  healthcare: [c => `${c} Community Health`, c => `${c} Regional Medical Center`, c => `${c} Family Health Network`, c => `${c} Health Partners`],
  documentation: [(c, f) => `${pick(f, PRODUCTS)} Docs`, (c, f) => `${pick(f, PRODUCTS)} API Documentation`, (c, f) => `${pick(f, PRODUCTS)} Developer Hub`, (c, f) => `${pick(f, PRODUCTS)} Developer Docs`, (c, f) => `${pick(f, PRODUCTS)} Platform Docs`],
  museum: [c => `${c} Museum of Art`, c => `${c} History Museum`, c => `Museum of ${c}`, c => `${c} Art Gallery`],
  nonprofit: [c => `${c} Community Foundation`, c => `Friends of ${c}`, c => `${c} Neighborhood Alliance`, c => `${c} Food Partnership`],
  records: [c => `${c} County Archives`, c => `${c} Municipal Records Office`, c => `${c} Historical Archive`],
  news: [c => `The ${c} Herald`, c => `${c} Daily News`, c => `The ${c} Courier`, c => `${c} Gazette`],
};

export function domainSiteName(faker, domain) {
  const patterns = SITE_NAMES[domain];
  if (!patterns) return null;
  const city = town(faker);
  return pick(faker, patterns)(city, faker);
}

export function siteNameFor(domain, seed) {
  const faker = new Faker({ locale: [en] });
  faker.seed(seed >>> 0);
  return domainSiteName(faker, domain);
}

export const SITE_TAGLINES = {
  library: 'Borrow, learn and explore',
  government: 'Serving residents across the state',
  municipality: 'Services for residents, businesses and visitors',
  university: 'Teaching, research and public engagement',
  healthcare: 'Care close to home',
  documentation: 'Build, integrate and ship',
  museum: 'Art, objects and stories',
  nonprofit: 'Stronger neighborhoods, together',
  records: 'Preserving the public record',
  news: 'Independent local journalism',
};

const PERSON_TYPES = new Set(['author', 'faculty', 'provider', 'creator', 'journalist']);
export const isPersonType = typeName => PERSON_TYPES.has(typeName);

const TITLES = {
  library: {
    book: (f, t) => pick(f, [`The ${adj(f)} ${noun(f)}`, `${titleCase(t)} in ${town(f)}`, `A History of ${titleCase(t)}`, `${noun(f)} and ${noun(f)}`, `The ${town(f)} ${noun(f)}`, `Notes from the ${noun(f)}`]),
    event: (f, t) => pick(f, [`${titleCase(t)} Workshop`, `Author Talk: ${titleCase(t)}`, `Story Time at ${town(f)} Branch`, `${titleCase(t)} Book Club`, `Family Discovery Day: ${titleCase(t)}`, `Local History Hour: ${titleCase(t)}`]),
    branch: f => `${town(f)} Branch`,
  },
  government: {
    program: (f, t) => pick(f, [`${titleCase(t)} Assistance Program`, `${titleCase(t)} Grant Program`, `${titleCase(t)} Rebate`, `Small Business ${titleCase(t)} Initiative`, `${titleCase(t)} Loan Fund`]),
    department: (f, t) => pick(f, [`Division of ${titleCase(t)}`, `Office of ${titleCase(t)}`, `Bureau of ${titleCase(t)}`, `${titleCase(t)} Services Section`]),
    policy: (f, t) => pick(f, [`${titleCase(t)} Standards`, `Policy on ${titleCase(t)}`, `${titleCase(t)} Compliance Guidance`, `Administrative Rule: ${titleCase(t)}`]),
    publication: (f, t, i) => pick(f, [`${year(i)} ${titleCase(t)} Annual Report`, `${titleCase(t)}: Statewide Assessment`, `${titleCase(t)} Fact Sheet`, `Guide to ${titleCase(t)} for Residents`]),
  },
  municipality: {
    service: (f, t) => pick(f, [`Apply for ${t.replace(/s$/, '')} services`, `Request ${t}`, `Report a problem: ${t}`, `${cap(t)} schedule`, `Get help with ${t}`]),
    office: (f, t) => pick(f, [`${titleCase(t)} Office`, `Department of ${titleCase(t)}`, `${town(f)} Service Center`]),
    meeting: (f, t, i) => pick(f, [`City Council Regular Meeting`, `Planning Commission Meeting`, `${titleCase(t)} Advisory Board`, `Public Hearing: ${titleCase(t)}`, `Neighborhood Forum: ${titleCase(t)}`]) + ` – ${MONTHS[i % 12]} ${1 + (i * 7) % 27}`,
    notice: (f, t) => pick(f, [`Public notice: ${t} changes`, `Road closure on ${f.location.street()}`, `${cap(t)} update for ${town(f)} residents`, `Notice of public hearing on ${t}`]),
  },
  university: {
    course: (f, t, i) => pick(f, [`Introduction to ${titleCase(t)}`, `Advanced ${titleCase(t)}`, `${titleCase(t)}: Theory and Practice`, `Seminar in ${titleCase(t)}`, `Topics in ${titleCase(t)}`]),
    program: (f, t) => pick(f, [`${titleCase(t)} (BSc)`, `${titleCase(t)} (MA)`, `PhD in ${titleCase(t)}`, `${titleCase(t)} Minor`, `Graduate Certificate in ${titleCase(t)}`]),
    research: (f, t) => pick(f, [`New study maps ${t} across ${town(f)}`, `${cap(t)} and the changing city`, `Researchers test new approaches to ${t}`, `A new model of ${t}`]),
  },
  healthcare: {
    service: (f, t, i) => { const list = ['Primary Care', 'Pediatrics', 'Women’s Health', 'Behavioral Health', 'Physical Therapy', 'Cardiology', 'Diabetes Education', 'Imaging and Radiology', 'Urgent Care', 'Nutrition Services', 'Sleep Medicine', 'Orthopedics', 'Dermatology', 'Audiology', 'Speech Therapy', 'Senior Care']; return i < list.length ? list[i] : `${list[i % list.length]} at ${town(f)}`; },
    clinic: f => pick(f, [`${town(f)} Health Center`, `${town(f)} Family Clinic`, `${f.location.street()} Medical Office`, `${town(f)} Urgent Care`]),
    article: (f, t) => pick(f, [`What to expect: ${t}`, `5 tips for ${t}`, `Understanding ${t}`, `Your guide to ${t}`, `Ask the expert: ${t}`]),
  },
  documentation: {
    guide: (f, t) => pick(f, [`Getting started with ${t}`, `${cap(t)} overview`, `How ${t} works`, `Configuring ${t}`]),
    reference: f => `${pick(f, ['create', 'get', 'list', 'update', 'delete', 'sync', 'validate', 'retry'])}${pick(f, ['Webhook', 'Session', 'Token', 'Event', 'Batch', 'Record', 'CacheEntry', 'Job', 'Subscription'])}()`,
    release: (f, t, i) => `Release ${2 + Math.floor(i / 6)}.${i % 6}.${f.number.int({ min: 0, max: 9 })}`,
    tutorial: (f, t) => pick(f, [`Build a ${t} pipeline`, `Tutorial: ${t} in 10 minutes`, `Migrating to the new ${t} API`, `Debugging ${t}`]),
  },
  museum: {
    object: (f, t) => pick(f, [`${adj(f)} Vessel`, `Untitled (${titleCase(t)})`, `Map of ${town(f)} Harbor`, `${titleCase(f.color.human())} Study No. ${f.number.int({ min: 2, max: 40 })}`, `Figure with ${noun(f)}`, `${titleCase(t)} Panel`]),
    exhibition: (f, t) => pick(f, [`${titleCase(t)}: New Acquisitions`, `Making ${titleCase(t)}`, `${noun(f)} and Light`, `Across the ${noun(f)}: ${titleCase(t)}`]),
    resource: (f, t) => pick(f, [`Teacher guide: ${t}`, `Family activity: ${t}`, `Gallery talk recording: ${t}`, `Learning kit: ${t}`]),
  },
  nonprofit: {
    project: (f, t) => pick(f, [`${town(f)} ${titleCase(t)} Project`, `${titleCase(t)} Collaborative`, `Growing ${titleCase(t)}`]),
    grant: (f, t, i) => pick(f, [`${year(i) + 1} ${titleCase(t)} Fund`, `Community ${titleCase(t)} Grants`, `Seed Grants for ${titleCase(t)}`]),
    report: (f, t, i) => pick(f, [`${year(i)} Impact Report`, `${titleCase(t)} Annual Review ${year(i)}`, `Community Needs Assessment: ${titleCase(t)}`]),
    opportunity: (f, t) => pick(f, [`Volunteer: ${titleCase(t)} helper`, `${titleCase(t)} team lead`, `Weekend ${t} volunteer`]),
  },
  records: {
    record: (f, t, i) => pick(f, [`${titleCase(t)}, ${year(i) - 40}`, `${titleCase(t)} – ${town(f)} Township`, `${titleCase(t)} ledger, volume ${1 + i % 9}`]),
    collection: (f, t) => pick(f, [`${titleCase(t)} Collection`, `${f.person.lastName()} Family Papers`, `Records of the ${titleCase(t)} Board`]),
    findingAid: (f, t) => `Guide to the ${titleCase(t)} Records`,
    office: f => pick(f, [`${town(f)} Reading Room`, `Records Center – ${f.location.street()}`, `County Clerk Archives Desk`]),
  },
  news: {
    article: (f, t) => pick(f, [`Council approves new ${t} plan`, `${cap(t)} debate heats up in ${town(f)}`, `What the latest ${t} decision means for you`, `${town(f)} residents weigh in on ${t}`, `${cap(t)} funding falls short, report finds`]),
    feature: (f, t) => pick(f, [`Inside the fight over ${t}`, `The people behind ${town(f)}’s ${t}`, `How ${t} reshaped a neighborhood`, `A year of ${t}: what changed`]),
    edition: (f, t, i) => `${MONTHS[i % 12]} ${1 + (i * 7) % 27}, ${year(i)} Edition`,
  },
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function domainTitle(faker, domain, typeName, topic, index) {
  if (isPersonType(typeName)) {
    const name = personName(faker);
    return typeName === 'provider' ? `${name}, ${pick(faker, ['MD', 'MD', 'DO', 'NP', 'PA-C'])}` : name;
  }
  const build = TITLES[domain]?.[typeName];
  return build ? tidyTitle(build(faker, topic, index)) : null;
}

// A topic can end in the word its template adds ("arts funding" + " funding falls short"). Real headlines never
// say a word twice in a row, and "planning plan" reads the same way.
export function tidyTitle(title) {
  return String(title).replace(/\b(\w+)(\s+\1)+\b/gi, '$1').replace(/\b(plann)ing plan\b/gi, '$1ing strategy');
}

// Field text banks. Each returns at least six sentences so the existing length variation still works.
const TEXT = {
  summary: (f, ctx) => [`${cap(ctx.subject)} looks at ${ctx.topic} through the experiences of ${ctx.group} in ${ctx.place}.`, `It brings together interviews, records and field notes gathered over several years.`, `The account is clear and practical, with plenty of local detail.`, `Readers who want more context can follow the related pages listed below.`, `It is a good starting point for anyone new to ${ctx.topic}.`, `Staff picks and reading lists often include it.`],
  description: (f, ctx) => [`${cap(ctx.subject)} focuses on ${ctx.topic} for ${ctx.group}.`, `Sessions are friendly, informal and open to all experience levels.`, `Materials are provided, and you are welcome to bring your own questions.`, `Accessible seating is available; let staff know if you need other support.`, `Registration is recommended because space is limited.`, `Check back for updates closer to the date.`],
  biography: (f, ctx) => [`Born in ${ctx.place}, ${ctx.person} has worked on ${ctx.topic} for more than ${f.number.int({ min: 6, max: 30 })} years.`, `Their work has appeared in regional journals, exhibitions and community programs.`, `Earlier roles included ${pick(f, ['teaching', 'field research', 'editing', 'curating', 'public service'])} in ${town(f)}.`, `They are known for careful research and an accessible style.`, `${ctx.person.split(' ')[0]} currently lives and works in ${town(f)}.`, `Recent projects continue to explore ${ctx.topic}.`],
  eligibility: (f, ctx) => [`Residents of ${ctx.place} and surrounding counties may apply.`, `Applicants must meet household income limits published each year.`, `Businesses with fewer than ${f.number.int({ min: 20, max: 100 })} employees are also eligible.`, `Previous recipients may reapply after twelve months.`, `Proof of residency and identification are required.`, `Contact the program office if you are unsure whether you qualify.`],
  applicationProcess: (f, ctx) => [`Complete the online application and upload the required documents.`, `Staff review applications in the order they are received.`, `You will receive a confirmation email within two business days.`, `Paper forms are available at any service center.`, `Incomplete applications may be delayed.`, `Most decisions are issued within ${f.number.int({ min: 2, max: 8 })} weeks.`],
  responsibilities: (f, ctx) => [`The office leads statewide work on ${ctx.topic}.`, `It sets standards, manages grants and supports local partners.`, `Staff also publish guidance and respond to public inquiries.`, `The team coordinates closely with other agencies and community groups.`, `Annual performance reports are published every spring.`, `Volunteers support outreach events across the region.`],
  abstract: (f, ctx) => [`This report examines ${ctx.topic} in ${ctx.place} between ${ctx.year - 4} and ${ctx.year}.`, `Using survey data from ${f.number.int({ min: 300, max: 4000 })} respondents, it identifies the main barriers and opportunities.`, `Findings suggest that coordinated local action produces the strongest results.`, `The authors recommend clearer guidance and sustained funding.`, `Appendices include methodology notes and data tables.`, `A summary for general readers is also available.`],
  requirements: (f, ctx) => [`Bring a valid photo ID and proof of address.`, `Some requests require a completed application form.`, `Fees, where they apply, are listed on the payment page.`, `Applicants under 18 need a parent or guardian.`, `Additional documents may be requested during review.`, `Contact us before visiting if you need an interpreter.`],
  agenda: (f, ctx) => [`Call to order and roll call.`, `Approval of the minutes from the previous meeting.`, `Public comment on ${ctx.topic}.`, `Staff presentation and discussion of the ${ctx.topic} proposal.`, `Consideration of resolutions and ordinances.`, `Adjournment.`],
  syllabus: (f, ctx) => [`This course introduces the core ideas of ${ctx.topic}.`, `Students read key texts, complete weekly problem sets and write a final project.`, `Topics include methods, case studies from ${ctx.place} and current debates.`, `Assessment combines coursework (60%) and a final examination (40%).`, `There are no formal prerequisites, but prior study is helpful.`, `Office hours are held weekly.`],
  researchInterests: (f, ctx) => [`${cap(ctx.topic)}, with a focus on ${pick(f, ['policy', 'data', 'history', 'design', 'communities'])}.`, `Comparative studies across ${town(f)} and ${town(f)}.`, `Collaborative research with local partners.`, `Methods for long-term field observation.`, `Public engagement and open data.`, `Graduate supervision in related areas.`],
  overview: (f, ctx) => [`${cap(ctx.subject)} brings together work on ${ctx.topic} from across the collection.`, `Highlights include rarely seen pieces and newly researched stories.`, `The presentation is designed for first-time visitors and specialists alike.`, `Labels are available in large print.`, `Guided tours run on weekends.`, `An accompanying catalogue is available in the shop.`],
  services: (f, ctx) => [`Free Wi-Fi, public computers and printing.`, `Study rooms you can reserve online.`, `Children’s area with weekly story times.`, `Holds pickup and returns.`, `Local history and genealogy help.`, `Meeting space for community groups.`],
  facilities: (f, ctx) => [`On-site laboratory and pharmacy.`, `Free parking and step-free access.`, `Interpreter services available on request.`, `Accessible restrooms and changing facilities.`, `Telehealth appointments available.`, `Nearby bus stop on ${f.location.street()}.`],
  steps: (f, ctx) => [`Install the client library and create an API key.`, `Configure ${ctx.topic} in your project settings.`, `Send a test request to confirm the connection.`, `Handle errors and retries as described in the reference.`, `Deploy and monitor usage from the dashboard.`, `Review the limits before going to production.`],
  changes: (f, ctx) => [`Improved ${ctx.topic} performance for large workspaces.`, `Fixed an issue that caused duplicate events in rare cases.`, `Added new configuration options for timeouts.`, `Deprecated the legacy authentication endpoint.`, `Updated dependencies to address security advisories.`, `Documentation updates throughout.`],
  body: (f, ctx) => [`${cap(ctx.topic)} has become one of the most discussed issues in ${ctx.place} this year.`, `Officials said the proposal would take effect next spring if approved.`, `“We want to get this right,” said ${ctx.person}, who has followed the issue closely.`, `Critics argue the plan does not go far enough.`, `A public hearing is scheduled for later this month.`, `Residents can submit written comments online.`],
};

const DOMAIN_TEXT = {
  university: {
    requirements: (f, ctx) => [`Applicants normally hold a high school diploma or equivalent with strong results in related subjects.`, `Transfer students may receive credit for comparable courses.`, `International applicants must meet English language requirements.`, `A personal statement and one academic reference are required.`, `Some applicants are invited to an interview.`, `Application deadlines are listed on the admissions page.`],
    abstract: (f, ctx) => [`This project investigates ${ctx.topic} using new field and archival data from ${ctx.place}.`, `The team combined ${f.number.int({ min: 3, max: 12 })} years of observations with interviews and modeling.`, `Results challenge several common assumptions about ${ctx.topic}.`, `The work was carried out with community partners and graduate researchers.`, `Findings will be published in a peer-reviewed journal.`, `Data and code are available on request.`],
  },
  documentation: {
    overview: (f, ctx) => [`This page explains how ${ctx.topic} works and when to use it.`, `It covers the main concepts, limits and recommended settings.`, `Code samples are provided for JavaScript, Python and Go.`, `If you are new to the platform, start with the quickstart first.`, `Advanced options are covered in the reference section.`, `Last reviewed for the current release.`],
    prerequisites: (f, ctx) => [`An active account with administrator access.`, `An API key with write permissions.`, `Node.js 20 or later, or Python 3.11 or later.`, `Basic familiarity with REST APIs.`, `A test workspace (recommended).`, `Network access to the API endpoint.`],
  },
  museum: {
    description: (f, ctx) => [`Made in ${ctx.place}, this work reflects the region’s long tradition of ${ctx.topic}.`, `Its surface shows careful handwork and later signs of use.`, `It entered the collection as a gift from a local family.`, `The piece is currently on view in the main galleries.`, `Conservators examined it before its most recent display.`, `Related works by the same maker are listed below.`],
  },
  healthcare: {
    description: (f, ctx) => [`Our team provides ${ctx.topic} support for patients of all ages.`, `Care is coordinated with your primary care provider.`, `Same-week appointments are often available.`, `We accept most major insurance plans.`, `Interpreter services are free of charge.`, `Ask your provider whether a referral is needed.`],
  },
  records: {
    abstract: (f, ctx) => [`Bound volume of ${ctx.topic} kept by the clerk’s office.`, `Entries are handwritten and arranged by date.`, `Some pages show water damage; a digitized copy is available for most of the volume.`, `Names, parcel numbers and decisions are indexed in the reading room.`, `Original items may be viewed by appointment.`, `Copies can be requested for a small fee.`],
    scope: (f, ctx) => [`The collection documents ${ctx.topic} in ${ctx.place} and nearby townships.`, `It includes correspondence, ledgers, maps and photographs.`, `Materials are arranged in series by record type and date.`, `Most items are in English; a few are in German and Polish.`, `The collection was transferred to the archives in ${1960 + ctx.index % 50}.`, `Additions are expected.`],
    description: (f, ctx) => [`This finding aid describes records relating to ${ctx.topic}.`, `It lists series, box numbers and folder titles.`, `Use the box and folder numbers when requesting items.`, `Restricted items are marked in the inventory.`, `A printable PDF version is available at the reference desk.`, `Staff can help with research questions.`],
  },
  news: {
    summary: (f, ctx) => [`${cap(ctx.topic)} is back on the agenda in ${ctx.place}, and residents have questions.`, `Here is what we know so far and what happens next.`, `Officials are expected to vote before the end of the month.`, `Local groups say they want more time for public input.`, `Our reporters will follow the story as it develops.`, `Have a tip? Contact the newsroom.`],
  },
};

const SUBJECTS = {
  library: 'this title', government: 'this program', municipality: 'this service', university: 'this course',
  healthcare: 'this service', documentation: 'this guide', museum: 'this exhibition', nonprofit: 'this project',
  records: 'this record series', news: 'this story',
};

export function domainSentences(faker, domain, field, topic, index, subjectName) {
  const ctx = {
    topic, index, year: 2020 + index % 6,
    place: town(faker),
    person: subjectName ?? personName(faker),
    group: pick(faker, ['residents', 'researchers', 'visitors', 'families', 'students', 'local organizations']),
    subject: SUBJECTS[domain] ?? 'this page',
  };
  const bank = DOMAIN_TEXT[domain]?.[field] ?? TEXT[field] ?? TEXT[{ objectives: 'responsibilities', outcomes: 'abstract', scope: 'overview', accessConditions: 'requirements', referralProcess: 'applicationProcess', activity: 'description', parameters: 'steps', prerequisites: 'requirements' }[field]];
  if (bank) return bank(faker, ctx);
  return [
    `${cap(ctx.subject)} covers ${topic} for ${ctx.group} in ${ctx.place}.`,
    `It explains what is available, who it is for and how to get started.`,
    `Information is reviewed regularly by staff.`,
    `Related pages are listed below for further reading.`,
    `Questions can be sent through the contact page.`,
    `The next review is planned for ${2026 + index % 4}.`,
  ];
}

// Short structured values that real sites show as single facts rather than paragraphs.
const SHORT = {
  courseCode: (f, t, i) => `${t.split(' ').map(w => w.slice(0, 2).toUpperCase()).join('').slice(0, 4)} ${100 * (1 + i % 4) + f.number.int({ min: 1, max: 99 })}`,
  accessionNumber: (f, t, i) => `${1950 + i % 70}.${f.number.int({ min: 1, max: 400 })}.${1 + i % 12}`,
  specialty: f => pick(f, ['Family Medicine', 'Pediatrics', 'Cardiology', 'Internal Medicine', 'Obstetrics and Gynecology', 'Physical Therapy', 'Psychiatry', 'Dermatology']),
  audience: f => pick(f, ['Patients and families', 'Adults 65+', 'Parents and caregivers', 'Teachers (grades 3–8)', 'Families with children', 'General public']),
  difficulty: f => pick(f, ['Beginner', 'Intermediate', 'Advanced']),
  beat: (f, t) => cap(t),
  material: f => pick(f, ['Glazed stoneware', 'Oil on canvas', 'Bronze', 'Wool and silk', 'Ink on paper', 'Gelatin silver print', 'Carved oak']),
  awardAmount: f => `Up to $${f.number.int({ min: 5, max: 75 }) * 1000}`.replace(/(\d)(?=(\d{3})+$)/g, '$1,'),
  dateRange: (f, t, i) => `${1880 + i % 60}–${1940 + i % 60}`,
  custodian: f => pick(f, ['County Clerk', 'Office of the City Archivist', 'Historical Records Unit', 'Records Management Division']),
  duration: f => pick(f, ['3 years full-time', '4 years full-time', '1 year full-time', '2 years full-time', '6 years part-time']),
  qualification: f => pick(f, ['Bachelor of Science', 'Bachelor of Arts', 'Master of Arts', 'Master of Science', 'Doctor of Philosophy']),
  fundingSource: f => pick(f, ['National Science Foundation', 'University Research Council', 'Regional Development Fund', 'Private foundation grant']),
  serviceArea: f => pick(f, ['Citywide', 'Downtown and Riverside', 'North and East districts', 'All residential neighborhoods']),
  openingHours: f => pick(f, ['Monday to Friday, 09:00-17:00', 'Tuesday to Saturday, 10:00-18:00', 'Monday to Saturday, 08:30-16:30', 'Monday to Thursday, 09:00-20:00; Friday to Saturday, 09:00-17:00']),
  location: f => `${town(f)} ${pick(f, ['Community Center', 'Main Branch', 'Civic Hall', 'Campus Center', 'Conference Room B'])}`,
  region: f => `${town(f)}, ${f.location.state()}`,
  reportingPeriod: (f, t, i) => `July ${2019 + i % 7} – June ${2020 + i % 7}`,
  parameters: f => `${pick(f, ['id', 'workspaceId', 'cursor', 'payload', 'eventType'])} (string), options (object, optional)`,
  returnValue: f => pick(f, ['Promise<Response>', 'boolean', 'string[]', 'Result object', 'void']),
  issueNumber: (f, t, i) => `Vol. ${12 + Math.floor(i / 52)}, No. ${1 + i % 52}`,
  accessibility: f => pick(f, ['Step-free entrance and accessible parking', 'Wheelchair accessible; hearing loop available', 'Elevator access to all floors']),
};

export function domainShortValue(faker, field, topic, index) {
  const build = SHORT[field];
  return build ? build(faker, topic, index) : null;
}

export const IMAGE_ALT = {
  library: 'Illustration of library bookshelves', government: 'Illustration of the state capitol building',
  municipality: 'Illustration of the city skyline', university: 'Illustration of a campus building with a clock tower',
  healthcare: 'Illustration of a clinic sign with a medical cross', documentation: 'Illustration of a code editor window',
  museum: 'Illustration of framed artworks in a gallery', nonprofit: 'Illustration of neighbors standing together',
  records: 'Illustration of archive boxes on shelves', news: 'Illustration of a newspaper front page',
};

export const SITE_DESCRIPTIONS = {
  library: ['Books, authors, local history and community learning.', 'Free books, programs and resources for all ages at our branches and online.', 'Borrow books, movies and music, attend free events and get help with research.', 'Connecting our community with stories, information and each other.'],
  government: ['Public programs, policy guidance and agency publications.', 'Programs, rules and reports from the state agency.', 'Find assistance programs, read policies and contact our offices.', 'Information and services for residents, businesses and local partners.'],
  municipality: ['Neighborhood services, public facilities and council information.', 'Pay bills, request services, find offices and follow council meetings.', 'Official information about city services, meetings and public notices.', 'Everything residents need, from trash pickup to building permits.'],
  university: ['Academic programs, faculty research and campus resources.', 'A public research university offering undergraduate and graduate programs.', 'Explore degrees, meet our faculty and read the latest research.', 'Courses, programs and research that shape our region and the world.'],
  healthcare: ['Primary and specialty care, clinics and health resources for the community.', 'Find a doctor, book an appointment and explore our services and locations.', 'Compassionate care across our clinics, with providers in more than 20 specialties.', 'Health services, locations and patient resources for every stage of life.'],
  documentation: ['Reference guides, release notes and integration examples.', 'Guides, API reference and tutorials for building on the platform.', 'Everything developers need to integrate, from quickstarts to release notes.', 'Learn the concepts, explore the API and follow step-by-step tutorials.'],
  museum: ['Collections, exhibitions, creators and learning resources.', 'Explore the collection, plan your visit and discover current exhibitions.', 'Art and objects from around the region, with exhibitions, talks and family programs.', 'A museum of art, design and local history, open six days a week.'],
  nonprofit: ['Community projects, funding opportunities and impact reports.', 'We fund local projects, support volunteers and report on our impact.', 'Grants, volunteer opportunities and community programs across the region.', 'Working with neighbors to build a fairer, healthier community.'],
  records: ['Public document catalog, record series and archive finding aids.', 'Search historic records, browse collections and plan a visit to the reading room.', 'The official repository for county records, maps and archives.', 'Finding aids, record series and research help for the public record.'],
  news: ['Local reporting, community features and a searchable news archive.', 'Breaking news, local politics, schools, business and community stories.', 'Independent reporting on the people and decisions shaping our region.', 'Daily news, in-depth features and the print edition archive.'],
};

// Real sites name the same sections differently; one label (and therefore URL path) is chosen per site.
export const SECTION_LABELS = {
  library: { book: ['Books', 'Catalog', 'Browse', 'New Titles'], author: ['Authors', 'Writers', 'Local Authors'], event: ['Events', 'Calendar', 'Programs & Events', 'What’s On'], branch: ['Branches', 'Locations', 'Hours & Locations', 'Visit'] },
  government: { program: ['Programs', 'Services', 'Assistance'], department: ['Departments', 'Offices', 'Divisions', 'Agencies'], policy: ['Policies', 'Rules & Regulations', 'Guidance'], publication: ['Publications', 'Reports', 'Documents', 'Resources'] },
  municipality: { service: ['Services', 'How Do I', 'Residents'], office: ['Offices', 'Departments', 'City Hall'], meeting: ['Meetings', 'Agendas & Minutes', 'Public Meetings'], notice: ['Notices', 'News & Notices', 'Announcements', 'Alerts'] },
  university: { course: ['Courses', 'Course Catalog', 'Classes'], faculty: ['Faculty', 'People', 'Faculty Directory'], program: ['Programs', 'Degrees', 'Academics', 'Areas of Study'], research: ['Research', 'News', 'Discoveries'] },
  healthcare: { service: ['Services', 'Specialties', 'Care & Treatment', 'Conditions & Treatments'], clinic: ['Clinics', 'Locations', 'Find a Location'], provider: ['Providers', 'Find a Doctor', 'Our Doctors'], article: ['Resources', 'Health Library', 'Patient Resources', 'Blog'] },
  documentation: { guide: ['Guides', 'Docs', 'Concepts'], reference: ['Reference', 'API', 'API Reference'], release: ['Releases', 'Changelog', 'Release Notes'], tutorial: ['Tutorials', 'Examples', 'Learn'] },
  museum: { object: ['Collection', 'Collections', 'Objects', 'Browse the Collection'], creator: ['Creators', 'Artists', 'Makers'], exhibition: ['Exhibitions', 'What’s On', 'On View'], resource: ['Learning', 'Education', 'Learn'] },
  nonprofit: { project: ['Projects', 'Our Work', 'Programs'], grant: ['Grants', 'Funding', 'Apply for Funding'], report: ['Reports', 'Impact', 'Annual Reports'], opportunity: ['Volunteer', 'Get Involved', 'Volunteer Opportunities'] },
  records: { record: ['Records', 'Catalog', 'Search Records'], collection: ['Collections', 'Holdings', 'Record Groups'], findingAid: ['Finding Aids', 'Research Guides', 'Guides'], office: ['Offices', 'Visit', 'Reading Rooms'] },
  news: { article: ['News', 'Local', 'Latest'], journalist: ['Writers', 'Staff', 'Our Team', 'Contributors'], feature: ['Features', 'In Depth', 'Long Reads', 'Investigations'], edition: ['Editions', 'Print', 'E-Edition', 'Archive'] },
};
