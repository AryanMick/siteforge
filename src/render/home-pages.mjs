// Full front pages per site type. Each domain has three archetypes modeled on real home pages
// (section order and block kinds), picked by seed; legacy-style sites get a 2000s table portal.
// Every model link (pageLinks + navigation) is rendered exactly once; all other blocks are text only.
import { seedFor } from '../site/util.mjs';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const TIMES = ['9:30 am', '10:00 am', '11:30 am', '12:15 pm', '1:00 pm', '2:30 pm', '4:00 pm', '5:30 pm', '6:00 pm', '7:00 pm'];

// Copy pools: hero [headline, lede], intro, events [title, place], teasers for linked records,
// promos [heading, body], visit/info rows, quote, extra list, tile blurbs.
const COPY = {
  museum: {
    hero: [['Discover what connects us', 'Galleries, gardens and a collection built over more than a century, open to everyone and free every day.'], ['Art and history, under one roof', 'From river-valley pottery to contemporary photography, find something new on every floor.'], ['Look closer', 'New exhibitions, family studios and late openings every Thursday this season.']],
    intro: ['Welcome', 'Plan your visit, browse the collection online or join a free tour led by our docents. The permanent galleries are always free; special exhibitions are ticketed.'],
    eventsHeading: ['Today’s events', 'Happening this week', 'Tours and talks'],
    events: [['Gallery talk: Light and shadow in the print room', 'Gallery 4'], ['Family studio: Make a paper lantern', 'Education Center'], ['Curator tour of new acquisitions', 'Main lobby'], ['Film: Makers of the river valley', 'Auditorium'], ['Sketching in the sculpture garden', 'Garden terrace'], ['Conservation lab open house', 'Lower level'], ['Slow looking: one painting, thirty minutes', 'Gallery 9']],
    teasers: ['A closer look at how this piece entered the collection and what it tells us about its maker.', 'Conservators spent eleven months on this work before it returned to the galleries.', 'One of the most requested objects in our study room, now photographed in full detail.', 'Curators trace the story behind the object, from workshop to museum case.', 'Seen in a new light after cleaning revealed the original colors.'],
    promos: [['Become a member', 'Members get free parking, early entry to ticketed exhibitions and 10% off in the shop. Memberships start at $65 a year.'], ['Give to the collection', 'Gifts of every size help us conserve, research and share the collection with schools across the region.']],
    visit: [['Hours', 'Open daily 10:00 am–5:30 pm, Thursdays until 9:00 pm. Closed Dec 25.'], ['Admission', 'Free for everyone. Special exhibitions $12, members free.'], ['Getting here', 'Two blocks from Union Station. Garage parking on Fourth Street, $8 after 5 pm.']],
    quote: ['We came for the dinosaurs and stayed for the quilts. The kids are already asking when we can go back.', 'Visitor comment card, spring 2026'],
    extra: ['From the podcast', [['The quilt that crossed an ocean', '28 min'], ['What the conservators found under the varnish', '34 min'], ['A night shift with the collections team', '25 min'], ['Why we still collect postcards', '31 min']]],
    tiles: ['Objects, artists and stories', 'Exhibitions on view and coming soon', 'Programs for families and schools', 'Hours, maps and accessibility'],
  },
  library: {
    hero: [['Free to learn, open to all', 'Borrow books, films and laptops, get help with research and join free classes at every branch.'], ['Your next great read is waiting', 'Staff picks, new arrivals and author talks across the system this month.'], ['Get a library card today', 'Cards are free for anyone who lives, works or studies in the county.']],
    intro: ['Discover', 'Browse the catalog, reserve a study room, or ask a librarian by chat, phone or text.'],
    eventsHeading: ['Events and classes', 'This week at your library', 'Upcoming programs'],
    events: [['Baby and toddler story time', 'Central Library, Children’s Room'], ['Résumé help drop-in', 'Eastside Branch'], ['Author talk and signing', 'Central Library Auditorium'], ['English conversation circle', 'Riverside Branch'], ['Teen coding club', 'Media Lab'], ['Genealogy for beginners', 'Local History Room'], ['Knitting and audiobooks', 'Northgate Branch']],
    teasers: ['A staff favorite this season: our librarians could not stop recommending it.', 'Readers have placed more than two hundred holds since it arrived.', 'Part of this month’s reading list chosen by branch staff.', 'Now available in print, e-book and audiobook.', 'Recommended for book clubs, with discussion questions at the desk.'],
    promos: [['Get a library card', 'Apply online in five minutes and start borrowing e-books tonight. Cards are free.'], ['Support your library', 'Friends of the Library fund summer reading, author visits and the bookmobile.']],
    visit: [['Central Library', 'Mon–Thu 9 am–8 pm · Fri–Sat 9 am–6 pm · Sun 1–5 pm'], ['Branches', 'Most branches open Tue–Sat 10 am–6 pm'], ['Ask a librarian', 'Chat, text or call (555) 014-2200 during open hours']],
    quote: ['The library helped me find my first job here. I still come every Saturday with my daughter.', 'Library card holder since 2019'],
    extra: ['From our blog', [['Twelve picture books about winter', 'Children’s services'], ['How to find old city directories', 'Local history'], ['New laptops to borrow at every branch', 'Technology'], ['Staff picks for long weekends', 'Readers’ advisory']]],
    tiles: ['Books, films, music and more', 'Classes, talks and story times', 'Research guides and databases', 'Locations, hours and services'],
  },
  university: {
    hero: [['Ideas that change the world start here', 'Teaching, research and service across eight schools and more than two hundred programs.'], ['Find your path', 'Undergraduate, graduate and professional programs with faculty who know your name.'], ['Discovery in every discipline', 'Our researchers are working on the questions that matter, from climate to medicine.']],
    intro: ['At a glance', 'A private research university founded on the belief that learning should be useful, open and shared.'],
    eventsHeading: ['Upcoming events', 'On campus this week', 'Lectures and events'],
    events: [['Public lecture: Cities after the flood', 'Memorial Hall'], ['Graduate admissions information session', 'Online'], ['Chamber orchestra fall concert', 'Fisher Concert Hall'], ['Research showcase and poster session', 'Science Library atrium'], ['Career fair: engineering and computing', 'Student Union ballroom'], ['Campus tour for admitted students', 'Welcome Center'], ['Book talk with the history faculty', 'Humanities Center']],
    teasers: ['Researchers describe a finding that could change how the field approaches the problem.', 'Faculty and students worked with community partners for three years on the project.', 'A new interdisciplinary program opens to students next fall.', 'Alumni share how the program shaped their careers.', 'A conversation about teaching, mentoring and the work ahead.'],
    promos: [['Apply for fall', 'Applications are open. Early action deadline: November 15; regular decision: January 15.'], ['Visit campus', 'Daily tours leave the Welcome Center at 10 am and 2 pm. Virtual tours are available any time.']],
    visit: [['Undergraduate', 'Early action November 15 · Regular decision January 15'], ['Graduate', 'Most programs review applications from December 1'], ['Financial aid', 'Families earning under $100,000 pay no tuition']],
    quote: ['My advisor met with me every week of my first year. That is why I stayed in research.', 'Senior, Department of Biology'],
    extra: ['In the news', [['Faculty elected to the national academy', 'Campus news'], ['New residence hall opens on the east quad', 'Student life'], ['Library receives a major map collection', 'Libraries'], ['Athletics wins conference title', 'Sports']]],
    tiles: ['Majors, minors and degrees', 'Faculty, labs and centers', 'How to apply and what it costs', 'Life on campus'],
  },
  municipality: {
    hero: [['How can we help you today?', 'Pay a bill, report a problem, apply for a permit or find a city office.'], ['Working for every neighborhood', 'City services, public meetings and news from City Hall.'], ['Your city, online', 'Most services are available online, any time. Call 311 for non-emergency help.']],
    intro: ['Welcome to City Hall', 'City Hall is open Monday to Friday, 8:30 am to 4:30 pm. Many services, from parking permits to dog licenses, are online.'],
    eventsHeading: ['Upcoming public meetings', 'Upcoming events', 'Meetings and hearings'],
    events: [['City Council regular meeting', 'Council Chamber, City Hall'], ['Planning Board public hearing', 'Room 801, City Hall'], ['Budget town hall', 'Westside Community Center'], ['Parks and Recreation Commission', 'Online and Room 900'], ['Neighborhood cleanup day', 'Meet at Franklin Park'], ['Zoning Board of Appeal', 'Room 801, City Hall'], ['Farmers market opening day', 'City Hall Plaza']],
    teasers: ['Updated guidance for residents and businesses, effective this month.', 'What residents need to know, including dates and how to apply.', 'The city is accepting public comment through the end of the month.', 'Crews will work in the area weekdays from 7 am to 3:30 pm.', 'Find out who qualifies and how to sign up.'],
    promos: [['Report a problem with 311', 'Potholes, missed trash pickup, broken streetlights: call 311 or use the app, any time of day.'], ['Stay connected', 'Get city news and emergency alerts by text or email. Sign up at any library branch or City Hall.']],
    visit: [['Trash and recycling', 'Holiday week: pickup moves one day later'], ['Street cleaning', 'Resumes April 1; check the posted signs'], ['Parking', 'Resident permits renew every two years']],
    quote: ['We are fixing more streets this year than in any of the last ten, and we want to hear where to go next.', 'Office of the Mayor'],
    extra: ['Guides', [['How to start a small business', '8 steps'], ['How to get a residential parking permit', '5 steps'], ['How to register to vote', '4 steps'], ['How to rent a park for an event', '6 steps']]],
    tiles: ['Pay, apply and report', 'Departments and offices', 'Agendas, minutes and hearings', 'Notices and closures'],
  },
  government: {
    hero: [['Benefits, services and information', 'Find programs, apply for assistance and get answers from the agency in plain language.'], ['Get help with what you need', 'Grants, rebates, licenses and guidance, all in one place.'], ['Official information from the agency', 'Rules, reports and the programs that serve residents and businesses.']],
    intro: ['What we do', 'We administer assistance programs, publish guidance and work with regional offices to serve people across the state.'],
    eventsHeading: ['Key dates and deadlines', 'Upcoming deadlines', 'Comment periods closing soon'],
    events: [['Home energy rebate applications close', 'Online application'], ['Public comment period ends on proposed rule', 'Federal Register docket'], ['Small business grant webinar', 'Online'], ['Regional office open house', 'Northern regional office'], ['Quarterly report published', 'Reports page'], ['Advisory committee meeting', 'Hearing Room A']],
    teasers: ['Who is eligible, what you need and how long it takes.', 'The agency updated this guidance after the public comment period.', 'Read the full report or the two-page summary.', 'Applications are reviewed in the order they are received.', 'Answers to the questions we hear most often.'],
    promos: [['Watch out for scams', 'Agency staff will never ask you to pay by gift card or wire transfer. Report suspicious calls to the fraud line.'], ['Need help applying?', 'Call (555) 016-4000, Monday to Friday, 8 am to 6 pm, or visit a regional office.']],
    visit: [['Call center', 'Mon–Fri 8 am–6 pm · (555) 016-4000'], ['Regional offices', 'Walk-in hours Tue and Thu, 9 am–3 pm'], ['Language help', 'Free interpreters in more than 200 languages']],
    quote: ['The rebate covered almost half of our new heat pump. The application took about twenty minutes.', 'Program participant, 2026'],
    extra: ['Most requested', [['Check the status of an application', 'Online'], ['Replace a lost certificate', 'Form and fee'], ['Find a regional office', 'Map'], ['Read the annual report', 'PDF']]],
    tiles: ['Grants, rebates and assistance', 'Offices and leadership', 'Rules and guidance', 'Reports and data'],
  },
  healthcare: {
    hero: [['Care that puts you first', 'Specialists, primary care and urgent care at locations across the region. Same-day appointments available.'], ['Find the right care, close to home', 'Book online, see a doctor by video or walk in to urgent care seven days a week.'], ['Expert care for every stage of life', 'More than a thousand providers working together on your care.']],
    intro: ['Request an appointment', 'New and returning patients can request an appointment online or by phone. Most insurance plans are accepted.'],
    eventsHeading: ['Classes and support groups', 'Health classes this month', 'Community health events'],
    events: [['Childbirth preparation class', 'Women’s Health Center, Room 2'], ['Diabetes support group', 'Online'], ['Free blood pressure screening', 'Main lobby'], ['CPR and first aid for families', 'Education Center'], ['Living with heart failure', 'Cardiology Clinic'], ['Grief and loss support circle', 'Chapel conference room']],
    teasers: ['What to expect at your first visit and how to prepare.', 'Our specialists explain the latest treatment options.', 'A patient shares her recovery story after surgery.', 'Simple steps that lower your risk, from our care team.', 'How the clinic coordinates care across departments.'],
    promos: [['Patient portal', 'See test results, message your care team and pay bills online, any time.'], ['Give to the hospital', 'Philanthropy funds research, new equipment and care for patients who cannot pay.']],
    visit: [['Urgent care', 'Open daily 8 am–8 pm, no appointment needed'], ['Appointments', 'Call (555) 017-8800, Mon–Fri 7 am–7 pm'], ['Visitors', 'Visiting hours 9 am–9 pm; two visitors at a time']],
    quote: ['Everyone on the team knew my history before I walked in. I never had to repeat myself.', 'Patient, Cardiology'],
    extra: ['Health library', [['Heart disease', 'Symptoms and causes'], ['Seasonal flu', 'Prevention'], ['Back pain', 'Diagnosis and treatment'], ['Healthy pregnancy', 'Week by week']]],
    tiles: ['Care for every stage of life', 'Locations and directions', 'Doctors and specialists', 'Health tips and guides'],
  },
  documentation: {
    hero: [['Build with the platform', 'Guides, API reference and examples to help you ship your first integration in minutes.'], ['Documentation', 'Everything you need to install, configure and extend the platform.'], ['Get started in five minutes', 'Create a key, make your first request and explore the reference.']],
    intro: ['Getting started', 'New here? Install the command-line tool, authenticate, and run the quick start. Most developers make their first request in under ten minutes.'],
    eventsHeading: ['Changelog', 'Recent releases', 'What’s new'],
    events: [['Added pagination cursors to list endpoints', 'API'], ['Deprecated the legacy upload method', 'Deprecation'], ['New webhook event: invoice.settled', 'Webhooks'], ['Fixed timeout handling in the Python SDK', 'SDK'], ['Rate limits raised for team plans', 'Platform'], ['Command-line tool supports profiles', 'CLI']],
    teasers: ['Concepts, examples and the options you will use most.', 'Step-by-step instructions with copy-ready code samples.', 'Every parameter, response field and error code.', 'Recommended for teams moving from the previous version.', 'Troubleshooting tips from the support team.'],
    promos: [['Join the community', 'Ask questions in the forum, read the engineering blog or contribute fixes to the docs on GitHub.'], ['Need help?', 'Paid plans include email support with a one-business-day response time.']],
    visit: [['Status', 'All systems operational'], ['Support', 'Forum, email and office hours every Wednesday'], ['SDKs', 'JavaScript, Python, Go, Ruby and Java']],
    quote: ['curl https://api.example.org/v2/status -H "Authorization: Bearer $TOKEN"', 'Your first request'],
    extra: ['Popular guides', [['Authentication and API keys', '5 min read'], ['Handling errors and retries', '7 min read'], ['Webhooks quick start', '6 min read'], ['Migrating from v1', '12 min read']]],
    tiles: ['Concepts and how-tos', 'Every endpoint and method', 'What changed in each version', 'Step-by-step tutorials'],
  },
  nonprofit: {
    hero: [['Help people in need, close to home', 'Your gift provides shelter, meals and emergency supplies to families in crisis.'], ['Together we can do more', 'Volunteers and donors power everything we do, from food drives to youth programs.'], ['Every gift makes a difference', 'Through December, every donation is matched dollar for dollar by a local family foundation.']],
    intro: ['Ways to help', 'Give money, give time, or give blood. Every kind of help reaches neighbors who need it.'],
    eventsHeading: ['Upcoming drives and events', 'Volunteer this month', 'Get involved'],
    events: [['Community blood drive', 'St. Mark’s Parish Hall'], ['Volunteer orientation', 'Main office and online'], ['Coat and blanket drive', 'All partner sites'], ['Annual benefit dinner', 'Harbor View Hotel'], ['Food pantry sorting shift', 'Warehouse, Dock B'], ['Youth mentoring info night', 'Library community room']],
    teasers: ['How one grant helped a neighborhood group double the families it serves.', 'Volunteers share what keeps them coming back every week.', 'Our latest impact report, in numbers and stories.', 'Partners explain how they put funding to work.', 'Applications for the next funding round are open.'],
    promos: [['Donate today', '$25 provides a hot meal for five people. $100 supplies an emergency kit for a family of four.'], ['Volunteer with us', 'Shifts last two to four hours. No experience needed; orientation is free.']],
    visit: [['Give', '$25 · $50 · $100 · Other amount'], ['Volunteer', 'More than 40 shifts open this week'], ['Partner', 'Grant applications reviewed twice a year']],
    quote: ['When the fire took our apartment, volunteers were there before the trucks left. We will never forget it.', 'Family helped in 2025'],
    extra: ['Latest updates', [['Winter storm response: shelters open', 'Disaster relief'], ['Grantee spotlight: Westside Kitchen', 'Grants'], ['Annual report now available', 'Reports'], ['Thank you to our spring volunteers', 'Community']]],
    tiles: ['Our work in the community', 'Funding and grants', 'Our impact, in numbers', 'Give your time'],
  },
  records: {
    hero: [['Explore the records of the people', 'Millions of documents, photographs and maps, preserved and open for research.'], ['Research our records', 'Search catalogs and finding aids, order copies or book a reading room appointment.'], ['History, kept for everyone', 'Land deeds, court papers, census schedules and photographs from two centuries.']],
    intro: ['Using the archives', 'Most records are open to the public. Start with the online catalog, then book a reading room appointment to see originals.'],
    eventsHeading: ['Talks and workshops', 'Upcoming programs', 'Events at the archives'],
    events: [['Workshop: Getting started with family history', 'Reading Room B'], ['Lecture: The census of 1880 and what it missed', 'Auditorium'], ['Preservation clinic: Caring for family papers', 'Conservation lab'], ['Exhibit tour: Letters home', 'Exhibit gallery'], ['Online: Searching land records', 'Online'], ['Teachers’ evening with primary sources', 'Education room']],
    teasers: ['A newly processed collection with a detailed finding aid.', 'Researchers can now view these records online.', 'Archivists describe how the series was arranged and described.', 'A guide to what survives and where to look first.', 'Selected documents from this collection are on display this month.'],
    promos: [['Order copies of records', 'Request certified copies of deeds, court files and vital records online; most orders ship in ten business days.'], ['Volunteer as a transcriber', 'Help make handwritten records searchable from home. Training takes about an hour.']],
    visit: [['Reading room', 'Tue–Fri 9 am–4:30 pm · first Saturday 9 am–1 pm'], ['Appointments', 'Book up to three weeks ahead'], ['Bring', 'Photo ID; pencils only; laptops welcome']],
    quote: ['I found my great-grandfather’s naturalization papers in an afternoon. The staff knew exactly where to look.', 'Researcher, family history'],
    extra: ['Document of the day', [['Petition for a public school, 1852', 'Legislative papers'], ['Survey map of the river district, 1871', 'Maps and plans'], ['Letter from a Civil War nurse, 1863', 'Personal papers'], ['Census schedule, Ward 3, 1880', 'Census records']]],
    tiles: ['Search individual records', 'Browse collections', 'Guides to the holdings', 'Visit and contact'],
  },
  news: {
    hero: [['Top stories', 'Independent, nonprofit reporting on the people, politics and policy that shape the region.'], ['The news you need today', 'Local reporting from our newsroom, updated throughout the day.'], ['In-depth, every day', 'Investigations, explainers and the stories behind the headlines.']],
    intro: ['About our journalism', 'Our reporters cover the statehouse, schools, health and the environment. Our stories are free to read and free to republish.'],
    eventsHeading: ['Latest', 'Updated today', 'Live updates'],
    events: [['Council approves budget after late-night session', 'Politics'], ['School board delays vote on new boundaries', 'Education'], ['Storm cleanup continues on the east side', 'Weather'], ['Hospital expansion clears final hurdle', 'Health'], ['Transit agency adds late-night service', 'Transportation'], ['High school team heads to state final', 'Sports'], ['What the new water rates mean for you', 'Explainer']],
    teasers: ['Our reporters spent months examining records and interviewing residents.', 'What we know, what we don’t, and what happens next.', 'The decision affects thousands of families across the county.', 'A closer look at the numbers behind the headline.', 'Readers asked; our newsroom answers.'],
    promos: [['Get the morning briefing', 'The day’s top stories in your inbox every weekday at 6 am. Free.'], ['Support independent news', 'Our journalism is free for everyone because readers like you give. Become a member for $5 a month.']],
    visit: [['Newsletter', 'Weekdays at 6 am'], ['Tips', 'Have a story? Call (555) 011-9000'], ['Corrections', 'We correct errors promptly and note them']],
    quote: ['We don’t take sides. We take notes, check facts and tell you what we found.', 'From our editor'],
    extra: ['Most read', [['What to know about this year’s property tax bills', 'Explainer'], ['Five takeaways from the governor’s speech', 'Politics'], ['The best new restaurants on the west side', 'Food'], ['Where to see fall colors this weekend', 'Outdoors']]],
    tiles: ['Latest local news', 'Our reporters', 'Investigations and features', 'Print editions and archives'],
  },
};

// Section recipes per archetype (block order). The first block holds the primary image so it stays first in source.
// Sources: si.edu, nypl.org, stanford.edu, boston.gov, usa.gov, mayoclinic.org, developer.mozilla.org, redcross.org, archives.gov, texastribune.org.
const ARCHETYPES = {
  museum: [['national', ['heroFull', 'intro', 'tiles', 'cardsGrid', 'events', 'extra', 'promo', 'about']], ['regional', ['heroSplit', 'visit', 'cardsExhibit', 'events', 'tiles', 'quote', 'about', 'promo']], ['gallery', ['heroType', 'cardsNumbered', 'calendar', 'stats', 'tiles', 'about', 'promo']]],
  library: [['system', ['heroFull', 'cardsGrid', 'tiles', 'quote', 'extra', 'events', 'promo', 'about']], ['branch', ['heroSplit', 'visit', 'events', 'cardsList', 'tiles', 'promo', 'about']], ['research', ['heroType', 'tiles', 'stats', 'cardsNumbered', 'calendar', 'about', 'extra']]],
  university: [['flagship', ['heroFull', 'cardsLead', 'stats', 'events', 'tiles', 'promo', 'about']], ['college', ['heroSplit', 'intro', 'tiles', 'visit', 'cardsGrid', 'quote', 'events', 'about']], ['research', ['heroType', 'cardsLead', 'extra', 'stats', 'calendar', 'tiles', 'about']]],
  municipality: [['city', ['alert', 'heroSearch', 'tiles', 'extra', 'cardsList', 'promo', 'events', 'quote', 'about']], ['town', ['heroSplit', 'alert', 'visit', 'events', 'tiles', 'cardsList', 'about']], ['county', ['heroSearch', 'tiles', 'stats', 'cardsGrid', 'calendar', 'promo', 'about']]],
  government: [['portal', ['heroSearch', 'tiles', 'extra', 'events', 'promo', 'about', 'cardsList']], ['agency', ['heroSplit', 'alert', 'cardsGrid', 'tiles', 'stats', 'visit', 'about']], ['program', ['heroType', 'visit', 'tiles', 'cardsList', 'quote', 'events', 'about']]],
  healthcare: [['system', ['heroFull', 'tiles', 'stats', 'cardsGrid', 'extra', 'promo', 'about']], ['clinic', ['alert', 'heroSplit', 'visit', 'tiles', 'events', 'quote', 'cardsList', 'about']], ['hospital', ['heroSearch', 'tiles', 'cardsLead', 'events', 'stats', 'promo', 'about']]],
  documentation: [['portal', ['heroSearch', 'tiles', 'cardsGrid', 'extra', 'events', 'about']], ['reference', ['heroType', 'quote', 'tiles', 'cardsList', 'events', 'visit', 'about']], ['product', ['heroSplit', 'tiles', 'stats', 'cardsNumbered', 'promo', 'about']]],
  nonprofit: [['relief', ['heroDonate', 'tiles', 'stats', 'cardsGrid', 'events', 'quote', 'about']], ['foundation', ['heroSplit', 'intro', 'cardsLead', 'stats', 'tiles', 'extra', 'promo', 'about']], ['community', ['heroFull', 'events', 'tiles', 'quote', 'cardsList', 'promo', 'about']]],
  records: [['national', ['heroFull', 'tiles', 'extra', 'cardsGrid', 'events', 'visit', 'about']], ['state', ['heroSearch', 'visit', 'tiles', 'cardsList', 'promo', 'about']], ['special', ['heroType', 'cardsNumbered', 'quote', 'calendar', 'tiles', 'about', 'promo']]],
  news: [['daily', ['heroLead', 'events', 'cardsGrid', 'extra', 'tiles', 'promo', 'about']], ['nonprofit', ['heroLead', 'promo', 'cardsList', 'extra', 'tiles', 'quote', 'about']], ['wire', ['heroType', 'events', 'cardsNumbered', 'tiles', 'calendar', 'about']]],
};

const TILE_STYLES = ['boxed', 'list', 'pill', 'icon', 'plain'];

function stats(domain, r) {
  const n = (salt, min, max) => (min + r(salt) % (max - min)).toLocaleString('en-US');
  return {
    library: [[`${n('a', 400, 1900)}K`, 'items borrowed last year'], [n('b', 3, 14), 'branches'], [n('c', 900, 4000), 'free programs a year'], ['24/7', 'e-books and databases']],
    university: [[n('a', 9000, 41000), 'students'], [n('b', 120, 400), 'degree programs'], [`$${n('c', 80, 900)}M`, 'research funding'], [`${n('d', 6, 14)}:1`, 'student–faculty ratio']],
    nonprofit: [[`$${n('a', 2, 19)}.${r('e') % 10}M`, 'granted since founding'], [n('b', 1200, 9000), 'volunteers'], [n('c', 40, 300), 'partner organizations'], [`${n('d', 86, 94)}¢`, 'of every dollar goes to programs']],
    healthcare: [[n('a', 12, 60), 'locations'], [n('b', 200, 1400), 'providers'], [`${n('c', 90, 99)}%`, 'patients would recommend us'], [n('d', 40, 120), 'specialties']],
    museum: [[`${n('a', 12, 90)}K`, 'objects in the collection'], [n('b', 4, 16), 'exhibitions a year'], [`${n('c', 180, 900)}K`, 'visitors last year'], ['Free', 'for members and under-18s']],
    records: [[`${n('a', 2, 40)}K`, 'cubic feet of records'], [n('b', 1790, 1890), 'oldest record series'], [n('c', 100, 900), 'finding aids online'], [`${n('d', 2, 9)}M`, 'pages digitized']],
    municipality: [[n('a', 18000, 240000), 'residents'], [n('b', 30, 180), 'parks'], [n('c', 40, 400), 'miles of paved streets'], ['311', 'for non-emergency requests']],
    government: [[n('a', 20, 140), 'assistance programs'], [n('b', 8, 30), 'regional offices'], [`$${n('c', 40, 900)}M`, 'distributed last year'], [`${n('d', 2, 9)} days`, 'average processing time']],
    documentation: [[`v${2 + r('v') % 4}.${r('w') % 9}`, 'current release'], [n('b', 140, 600), 'API endpoints'], ['99.9%', 'uptime last 90 days'], [n('d', 6, 12), 'official SDKs']],
    news: [[n('a', 1890, 1960), 'year founded'], [n('b', 20, 120), 'journalists'], [`${n('c', 40, 900)}K`, 'monthly readers'], [n('d', 3, 40), 'awards since 2020']],
  }[domain] ?? [];
}

export function renderHomePage(site, page, ctx) {
  const { esc, href, image, fields, links, chrome } = ctx;
  const domain = site.domain;
  const copy = COPY[domain];
  if (!copy) return null;
  const r = salt => seedFor(site.seed, site.id ?? '', 'home-page', salt);
  const pick = (list, salt) => list[r(salt) % list.length];
  const navHrefs = new Set((site.navigation ?? []).map(item => item.href));
  const sectionQueue = links.filter(link => navHrefs.has(link.href));
  const featuredQueue = links.filter(link => !navHrefs.has(link.href));
  const take = (queue, count) => queue.splice(0, Math.max(0, count));
  const a = (link, cls = '') => `<a${cls ? ` class="${cls}"` : ''} href="${href(link.href)}">${esc(link.label)}</a>`;
  const media = (link, salt) => {
    if (!site.mediaPool) return '';
    const person = link && (site.personSections ?? []).some(prefix => String(link.href).startsWith(prefix));
    const n = seedFor(site.seed, link?.href ?? salt, 'thumb');
    const src = person ? `/assets/media/portrait-${1 + n % 6}.png` : `/assets/media/${domain}-${1 + n % 8}.png`;
    return `<img class="hp-thumb" src="${href(src)}" width="480" height="640" loading="lazy" decoding="async" alt="">`;
  };
  const base = Date.UTC(2026, r('month') % 12, 1 + r('day') % 24);
  const day = k => new Date(base + k * 86400000);
  const fmt = (d, long) => `${long ? `${DAYS[d.getUTCDay()]}, ` : ''}${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}${long ? `, ${d.getUTCFullYear()}` : ''}`;
  const time = salt => TIMES[r(salt) % TIMES.length];
  const [heroHead, heroLede] = pick(copy.hero, 'hero');
  const tagline = chrome?.tagline || site.name;
  const tileStyle = TILE_STYLES[r('tile-style') % TILE_STYLES.length];
  const variants = ARCHETYPES[domain];
  const index = r('archetype') % variants.length;
  const [archetype, recipe] = variants[index];
  const teaser = (i, salt) => copy.teasers[(r(salt) + i) % copy.teasers.length];
  const heroCta = () => {
    const link = featuredQueue.length > 2 ? take(featuredQueue, 1)[0] : null;
    return link ? `<p class="hp-actions">${a(link, 'hp-btn')}</p>` : `<p class="hp-actions"><span class="hp-chip">${esc(copy.visit[0][1])}</span></p>`;
  };
  const figure = image ? `<div class="hp-hero-media home-media">${image}</div>` : '';
  const head = (text, id) => `<h2 class="section-heading hp-heading"${id ? ` id="${id}"` : ''}>${esc(text)}</h2>`;
  const blocks = {
    heroFull: () => `<section class="hp-hero hp-hero-full" aria-label="Featured">${figure}<div class="hp-hero-panel"><p class="hp-eyebrow">${esc(tagline)}</p><p class="hp-hero-title">${esc(heroHead)}</p><p>${esc(heroLede)}</p>${heroCta()}</div></section>`,
    heroSplit: () => `<section class="hp-hero hp-hero-split" aria-label="Featured">${figure}<div class="hp-hero-panel"><p class="hp-eyebrow">${esc(tagline)}</p><p class="hp-hero-title">${esc(heroHead)}</p><p>${esc(heroLede)}</p>${heroCta()}<dl class="hp-facts">${copy.visit.slice(0, 2).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl></div></section>`,
    heroType: () => `<section class="hp-hero hp-hero-type" aria-label="Featured"><div class="hp-hero-panel"><p class="hp-eyebrow">${esc(fmt(day(0), true))}</p><p class="hp-hero-title">${esc(heroHead)}</p><p>${esc(heroLede)}</p>${heroCta()}</div>${figure}</section>`,
    heroSearch: () => `<section class="hp-hero hp-hero-search" aria-label="Featured"><div class="hp-hero-panel"><p class="hp-hero-title">${esc(heroHead)}</p><p>${esc(heroLede)}</p><p class="hp-popular"><span>Popular:</span> ${copy.tiles.map(text => `<span class="hp-chip">${esc(text)}</span>`).join(' ')}</p></div>${figure}</section>`,
    heroDonate: () => `<section class="hp-hero hp-hero-donate" aria-label="Featured">${figure}<div class="hp-hero-panel"><p class="hp-hero-title">${esc(heroHead)}</p><p>${esc(heroLede)}</p><p class="hp-amounts">${['$25', '$50', '$100', '$250'].map(v => `<span class="hp-chip">${v}</span>`).join('')}</p>${heroCta()}</div></section>`,
    heroLead: () => {
      const lead = take(featuredQueue, 1)[0];
      return `<section class="hp-hero hp-hero-lead" aria-label="Top story">${figure}<div class="hp-hero-panel"><p class="hp-eyebrow">${esc(fmt(day(0), true))} · Updated ${esc(time('lead-time'))}</p><p class="hp-hero-title">${lead ? a(lead) : esc(heroHead)}</p><p>${esc(lead ? teaser(0, 'lead') : heroLede)}</p></div></section>`;
    },
    alert: () => `<section class="hp-alert" aria-label="Alert"><p><strong>${esc(pick(['Service alert', 'Notice', 'Update'], 'alert-label'))}:</strong> ${esc(chrome?.notice || copy.promos[0][1])}</p></section>`,
    intro: () => `<section class="hp-intro">${head(copy.intro[0])}<p>${esc(copy.intro[1])}</p></section>`,
    tiles: () => {
      const tiles = take(sectionQueue, sectionQueue.length).map((link, i) => `<li class="home-tile">${a(link)}<p>${esc(copy.tiles[i % copy.tiles.length])}</p></li>`).join('');
      return `<section class="home-sections hp-tiles tiles-${tileStyle}" aria-labelledby="related-heading">${head(pick(['Explore', 'Quick links', 'I want to…', 'Browse', 'Find what you need', 'Start here'], 'tiles-head'), 'related-heading')}<ul class="home-tiles">${tiles}</ul></section>`;
    },
    cardsGrid: () => cards('grid', 4),
    cardsExhibit: () => cards('exhibit', 3),
    cardsLead: () => cards('lead', 5),
    cardsList: () => cards('list', 4),
    cardsNumbered: () => cards('numbered', 5),
    events: () => `<section class="hp-events">${head(pick(copy.eventsHeading, 'events-head'))}<ol class="hp-event-list">${[0, 1, 2, 3, 4].map(i => {
      const [title, place] = copy.events[(r('events') + i) % copy.events.length];
      const d = day(domain === 'news' || domain === 'documentation' ? -i : Math.floor(i / 2));
      return `<li><time class="hp-date"><span>${esc(MONTHS[d.getUTCMonth()])}</span><b>${d.getUTCDate()}</b></time><div><p class="hp-event-title">${esc(title)}</p><p class="hp-meta">${esc(domain === 'documentation' ? `${place} · v${2 + r('v') % 4}.${(r('w') % 9) + 5 - i}` : domain === 'news' ? `${place} · ${time(`ev-${i}`)}` : `${DAYS[d.getUTCDay()]} ${time(`ev-${i}`)} · ${place}`)}</p></div></li>`;
    }).join('')}</ol></section>`,
    calendar: () => `<section class="hp-calendar">${head('This week')}<ol class="hp-week">${[0, 1, 2, 3, 4].map(i => {
      const d = day(i);
      const [title, place] = copy.events[(r('cal') + i * 2) % copy.events.length];
      return `<li><p class="hp-day">${esc(DAYS[d.getUTCDay()])} <b>${d.getUTCDate()}</b></p><p class="hp-event-title">${esc(title)}</p><p class="hp-meta">${esc(time(`cal-${i}`))} · ${esc(place)}</p></li>`;
    }).join('')}</ol></section>`,
    stats: () => `<section class="hp-stats" aria-label="At a glance"><ul>${stats(domain, r).map(([value, label]) => `<li><span class="home-stat-value">${esc(value)}</span><span class="home-stat-label">${esc(label)}</span></li>`).join('')}</ul></section>`,
    visit: () => `<section class="hp-visit">${head(pick(['Plan your visit', 'Good to know', 'Hours and information'], 'visit-head'))}<ul>${copy.visit.map(([k, v]) => `<li><p class="hp-visit-label">${esc(k)}</p><p>${esc(v)}</p></li>`).join('')}</ul></section>`,
    promo: () => { const [h, b] = pick(copy.promos, 'promo'); return `<section class="hp-promo"><p class="hp-promo-title">${esc(h)}</p><p>${esc(b)}</p></section>`; },
    quote: () => `<section class="hp-quote"><blockquote><p>${esc(copy.quote[0])}</p></blockquote><p class="hp-meta">${esc(copy.quote[1])}</p></section>`,
    extra: () => `<section class="hp-extra">${head(copy.extra[0])}<ul>${copy.extra[1].map(([t, m]) => `<li><p class="hp-event-title">${esc(t)}</p><p class="hp-meta">${esc(m)}</p></li>`).join('')}</ul></section>`,
    about: () => fields ? `<section class="home-about hp-about record-facts" aria-labelledby="about-heading">${head(pick({ museum: ['About the museum', 'Our mission'], library: ['About the library', 'Who we are'], university: ['About the university', 'At a glance'], municipality: ['About the city', 'Your local government'], government: ['About the agency', 'Our mission'], healthcare: ['About us', 'Why choose us'], documentation: ['About these docs', 'Overview'], nonprofit: ['Who we are', 'Our mission'], records: ['About the archives', 'Our holdings'], news: ['About the newsroom', 'Our journalism'] }[domain], 'about-head'), 'about-heading')}${fields}</section>` : '',
  };
  function cards(style, count) {
    const items = take(featuredQueue, count);
    if (!items.length) return '';
    const heading = { grid: ['Featured', 'Highlights', 'In focus'], exhibit: ['On view now', 'Current exhibitions'], lead: ['News and stories', 'Latest news'], list: ['Latest updates', 'News'], numbered: ['Most popular', 'Start with these'] }[style];
    return `<section class="hp-cards hp-cards-${style}">${head(pick(heading, `cards-${style}`))}<ul>${items.map((link, i) => {
      const d = day(-i * 3 - 1);
      const meta = style === 'exhibit' ? `Through ${fmt(day(40 + i * 21))}` : fmt(d, false);
      const img = style === 'numbered' || style === 'list' ? '' : media(link, `card-${i}`);
      return `<li class="hp-card${i === 0 ? ' hp-card-first' : ''}">${img}${style === 'numbered' ? `<span class="hp-num">${i + 1}</span>` : ''}<div><p class="hp-meta">${esc(meta)}</p>${a(link)}<p>${esc(teaser(i, `teaser-${style}`))}</p></div></li>`;
    }).join('')}</ul></section>`;
  }
  const html = recipe.map(key => blocks[key]()).filter(Boolean);
  const rest = [...sectionQueue.splice(0), ...featuredQueue.splice(0)];
  if (rest.length) html.push(`<section class="hp-more">${head(`More from ${site.name}`)}<ul>${rest.map(link => `<li>${a(link)}</li>`).join('')}</ul></section>`);
  return `<div class="home-layout home-${esc(domain)} home-v-${index}">
      <div class="hp hp-${esc(domain)} hp-${archetype}">
      ${html.join('\n      ')}
      </div>
    </div>`;
}

// 2000s-era portal: one layout table, dense link boxes, dated "What's new", small images.
export function renderLegacyHome(site, page, ctx) {
  const { esc, href, image, fields, links, chrome } = ctx;
  const copy = COPY[site.domain];
  if (!copy) return null;
  const r = salt => seedFor(site.seed, site.id ?? '', 'legacy-home', salt);
  const navHrefs = new Set((site.navigation ?? []).map(item => item.href));
  const sections = links.filter(link => navHrefs.has(link.href));
  const featured = links.filter(link => !navHrefs.has(link.href));
  const a = link => `<a href="${href(link.href)}">${esc(link.label)}</a>`;
  const variant = r('variant') % 2;
  const year = 2003 + r('year') % 6;
  const base = Date.UTC(year, r('month') % 12, 1 + r('day') % 24);
  // Monotonic: "What's new" runs newest first (k >= 0), upcoming events run forward (k < 0).
  const date = k => { const d = new Date(base - (k * 6 + (k > 0 ? r(`gap-${k}`) % 4 : 0)) * 86400000); return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear()}`; };
  const box = (title, body, cls = '') => `<table class="lh-box${cls ? ` ${cls}` : ''}" width="100%" cellpadding="4" cellspacing="0"><tbody><tr><th class="lh-box-title">${esc(title)}</th></tr><tr><td>${body}</td></tr></tbody></table>`;
  const quick = `<table class="lh-box lh-quick" width="100%" cellpadding="4" cellspacing="0"><tbody><tr><th class="lh-box-title"><h2 class="section-heading" id="related-heading">Quick Links</h2></th></tr><tr><td><ul class="lh-links">${sections.map(link => `<li>${a(link)}</li>`).join('')}</ul></td></tr></tbody></table>`;
  const news = featured.length ? `<table class="lh-news" width="100%" cellpadding="3" cellspacing="0"><tbody><tr><th colspan="2" class="lh-box-title">What’s New</th></tr>${featured.map((link, i) => `<tr><td class="lh-date" width="80">${date(i)}</td><td>${a(link)}${i < 2 ? ' <span class="lh-new">NEW!</span>' : ''}<br><small>${esc(copy.teasers[(r('teaser') + i) % copy.teasers.length])}</small></td></tr>`).join('')}</tbody></table>` : '';
  const events = `<ul class="lh-plain">${copy.events.slice(0, 4).map(([t, p], i) => `<li><b>${date(-1 - i)}</b> ${esc(t)}, ${esc(p)}</li>`).join('')}</ul>`;
  const hours = `<p>${copy.visit.map(([k, v]) => `<b>${esc(k)}:</b> ${esc(v)}`).join('<br>')}</p>${chrome?.phone ? `<p>Phone: ${esc(chrome.phone)}</p>` : ''}`;
  const [promoHead, promoBody] = copy.promos[r('promo') % copy.promos.length];
  const welcome = `<h2 class="lh-welcome">Welcome to ${esc(site.name)}</h2><p>${esc(copy.hero[r('hero') % copy.hero.length][1])} ${esc(copy.intro[1])}</p>`;
  const about = fields ? `<div class="home-about lh-about record-facts"><h2 class="section-heading" id="about-heading">About ${esc(site.name)}</h2>${fields}</div>` : '';
  const updated = `<p class="lh-updated">This page was last updated on ${date(0)}. Best viewed at 1024×768.</p>`;
  const announcements = box('Announcements', `<p><b>${esc(promoHead)}.</b> ${esc(promoBody)}</p><p>${esc(chrome?.notice || copy.promos[(r('promo') + 1) % copy.promos.length][1])}</p>`, 'lh-announce');
  const left = `<td class="lh-left" width="190" valign="top">${quick}${box(variant ? 'Hours & Contact' : 'Visitor Information', hours)}</td>`;
  const mid = `<td class="lh-main" valign="top">${image ? `<div class="lh-image home-media">${image}</div>` : ''}${welcome}${variant ? announcements : ''}${news}${about}${updated}</td>`;
  const right = `<td class="lh-right" width="200" valign="top">${box(copy.eventsHeading[0], events)}${variant ? box(copy.extra[0], `<ul class="lh-plain">${copy.extra[1].map(([t, m]) => `<li>${esc(t)} <small>(${esc(m)})</small></li>`).join('')}</ul>`) : announcements}</td>`;
  return `<div class="legacy-home legacy-v-${variant} home-${esc(site.domain)}"><table class="lh-layout" width="100%" cellpadding="6" cellspacing="0" role="presentation"><tbody><tr>${variant ? `${mid}${right}` : `${left}${mid}${right}`}</tr>${variant ? `<tr><td colspan="2" class="lh-bottom">${quick}</td></tr>` : ''}</tbody></table></div>`;
}

export function homeCss() {
  return `
/* ---- Home pages (src/home-pages.mjs) ---- */
/* Neutralize the older .home-layout grid areas (tiles/media/about) so each block keeps its own row. */
.home-layout > .hp { grid-column: 1 / -1; width: 100%; min-width: 0; }
.hp { display: grid; grid-template-columns: minmax(0, 1fr); gap: clamp(28px, 4vw, 48px); }
.hp > section, .hp .home-sections, .hp .home-about, .hp .home-media { grid-area: auto !important; grid-column: 1 / -1; min-width: 0; }
.hp .hp-hero > .home-media, .hp .hp-hero > .hp-hero-panel { grid-column: auto; }
.hp .home-sections .section-heading::after { content: none; }
.hp .hp-hero .home-media .visual { margin: 0; max-width: none; width: 100%; height: 100%; border-radius: 0; }
.hp .hp-hero .home-media .visual img { width: 100%; height: 100%; max-height: 460px; aspect-ratio: auto; object-fit: cover; }
.hp .hp-hero-full .home-media .visual img { max-height: 480px; aspect-ratio: 16 / 7; }
.hp .home-tiles { grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); }
.hp > section { min-width: 0; }
.hp-heading { margin: 0 0 16px; font-size: clamp(1.3rem, 2.2vw, 1.7rem); }
.hp-hero { display: grid; gap: 0; border-radius: 6px; overflow: hidden; background: var(--accent-strong, #1d3a33); color: #fff; }
.hp-hero a { color: #fff; }
.hp-hero .visual { margin: 0; max-width: none; }
.hp-hero img { width: 100%; height: 100%; max-height: 460px; object-fit: cover; }
.hp-hero-panel { padding: clamp(22px, 4vw, 44px); display: grid; align-content: center; gap: 10px; }
.hp-hero-panel p { margin: 0; max-width: 60ch; }
.hp-hero-title { font-size: clamp(1.6rem, 3vw, 2.6rem); line-height: 1.12; font-weight: 700; overflow-wrap: anywhere; hyphens: auto; }
.hp-eyebrow { text-transform: uppercase; letter-spacing: .08em; font-size: .8rem; opacity: .85; }
.hp-hero-full { grid-template-columns: 1fr; position: relative; }
.hp-hero-full .hp-hero-media img { max-height: 520px; aspect-ratio: 16 / 7; }
.hp-hero-split, .hp-hero-type, .hp-hero-search, .hp-hero-donate, .hp-hero-lead { grid-template-columns: minmax(0, 2fr) minmax(0, 3fr); align-items: stretch; }
.hp-hero-type, .hp-hero-search { grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); }
.hp-hero-type { background: var(--paper, #fff); color: var(--ink, #222); border: 1px solid var(--line, #ccc); }
.hp-hero-type a { color: var(--accent-strong, #1d3a33); }
.hp-hero-type .hp-hero-title { font-size: clamp(2rem, 4vw, 3.25rem); letter-spacing: -.02em; }
.hp-hero-search .hp-hero-panel { order: -1; }
.hp-hero-lead { background: var(--paper, #fff); color: var(--ink, #222); border-bottom: 3px solid var(--ink, #222); border-radius: 0; }
.hp-hero-lead a { color: var(--ink, #222); text-decoration: none; }
.hp-hero-lead a:hover { text-decoration: underline; }
.hp-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 8px !important; }
.hp-btn { display: inline-block; padding: 10px 18px; border-radius: 4px; background: var(--cta-bg, #fff); color: var(--cta-ink, #111) !important; font-weight: 700; text-decoration: none; }
.hp-chip { display: inline-block; padding: 4px 10px; margin: 2px 4px 2px 0; border: 1px solid currentColor; border-radius: 999px; font-size: .85rem; }
.hp-popular span:first-child { font-weight: 700; margin-right: 4px; }
.hp-amounts { display: flex; flex-wrap: wrap; gap: 6px; }
.hp-amounts .hp-chip { font-size: 1.05rem; padding: 8px 16px; border-radius: 4px; font-weight: 700; }
.hp-facts { display: grid; grid-template-columns: auto 1fr; gap: 4px 14px; margin: 12px 0 0; font-size: .92rem; }
.hp-facts dt { font-weight: 700; }
.hp-facts dd { margin: 0; }
.hp-alert { padding: 12px 18px; border-left: 6px solid #d18b00; background: #fff6df; color: #3a2a00; border-radius: 4px; }
.hp-alert p { margin: 0; }
.hp-intro p { max-width: 70ch; font-size: 1.08rem; margin: 0; }
.hp-tiles .home-tiles { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 14px; }
.hp-tiles .home-tile { padding: 16px; border: 1px solid var(--line, #ccc); border-radius: 6px; background: var(--paper, #fff); }
.hp-tiles .home-tile a { font-weight: 700; font-size: 1.05rem; }
.hp-tiles .home-tile p { margin: 6px 0 0; color: var(--muted, #555); font-size: .92rem; }
.hp-tiles.tiles-pill .home-tile { border-radius: 999px; padding: 12px 20px; }
.hp-tiles.tiles-pill .home-tile p, .hp-tiles.tiles-plain .home-tile p { display: none; }
.hp-tiles.tiles-plain .home-tile { border: 0; border-bottom: 1px solid var(--line, #ccc); border-radius: 0; padding: 10px 0; }
.hp-tiles.tiles-list .home-tiles { grid-template-columns: 1fr; gap: 0; }
.hp-tiles.tiles-list .home-tile { border-radius: 0; border-width: 0 0 1px; }
.hp-tiles.tiles-icon .home-tile { border-top: 4px solid var(--accent, #2a6); }
.hp-cards ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 18px; }
.hp-card { display: grid; gap: 10px; align-content: start; }
.hp-card a { font-weight: 700; font-size: 1.08rem; }
.hp-card p { margin: 0; }
.hp-card > div > p:last-child { color: var(--muted, #555); font-size: .94rem; margin-top: 4px; }
.hp-thumb { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: 4px; }
.hp-cards-grid ul, .hp-cards-exhibit ul { grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
.hp-cards-exhibit .hp-thumb { aspect-ratio: 3 / 4; }
.hp-cards-lead ul { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.hp-cards-lead .hp-card-first { grid-column: span 2; grid-row: span 2; }
.hp-cards-lead .hp-card-first a { font-size: 1.5rem; }
.hp-cards-list ul { gap: 0; }
.hp-cards-list .hp-card { padding: 14px 0; border-bottom: 1px solid var(--line, #ccc); }
.hp-cards-numbered ul { counter-reset: none; }
.hp-cards-numbered .hp-card { grid-template-columns: 48px 1fr; align-items: start; padding-bottom: 12px; border-bottom: 1px solid var(--line, #ccc); }
.hp-num { font-size: 2rem; font-weight: 800; line-height: 1; color: var(--accent, #2a6); }
.hp-meta { color: var(--muted, #555); font-size: .85rem; margin: 0; }
.hp-events ol, .hp-extra ul, .hp-visit ul, .hp-more ul, .hp-week { list-style: none; margin: 0; padding: 0; }
.hp-event-list li { display: grid; grid-template-columns: 64px 1fr; gap: 14px; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--line, #ccc); }
.hp-date { display: grid; justify-items: center; padding: 6px 0; border: 2px solid var(--accent, #2a6); border-radius: 4px; line-height: 1.1; }
.hp-date span { text-transform: uppercase; font-size: .72rem; letter-spacing: .06em; }
.hp-date b { font-size: 1.4rem; }
.hp-event-title { margin: 0; font-weight: 700; }
.hp-week { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; }
.hp-week li { padding: 14px; border-top: 4px solid var(--accent, #2a6); background: color-mix(in srgb, var(--accent, #2a6) 7%, var(--paper, #fff)); }
.hp-week p { margin: 0 0 6px; }
.hp-day { text-transform: uppercase; font-size: .8rem; letter-spacing: .06em; }
.hp-day b { font-size: 1.3rem; }
.hp-stats ul { list-style: none; margin: 0; padding: 22px; display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 18px; background: color-mix(in srgb, var(--accent, #2a6) 10%, var(--paper, #fff)); border-radius: 6px; }
.hp-stats li { display: grid; gap: 4px; }
.hp-stats .home-stat-value { font-size: clamp(1.6rem, 3vw, 2.3rem); font-weight: 800; color: var(--accent-strong, #1d3a33); }
.hp-stats .home-stat-label { color: var(--muted, #555); }
.hp-visit ul { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; }
.hp-visit li { padding: 16px; border: 1px solid var(--line, #ccc); border-radius: 6px; }
.hp-visit li p { margin: 0; }
.hp-visit-label { font-weight: 700; margin-bottom: 6px !important; }
.hp-promo { padding: clamp(20px, 4vw, 36px); background: var(--accent-strong, #1d3a33); color: #fff; border-radius: 6px; }
.hp-promo p { margin: 0; max-width: 64ch; }
.hp-promo-title { font-size: 1.4rem; font-weight: 700; margin-bottom: 8px !important; }
.hp-quote { border-left: 4px solid var(--accent, #2a6); padding-left: 20px; }
.hp-quote blockquote { margin: 0; font-size: 1.25rem; font-style: italic; max-width: 60ch; }
.hp-quote blockquote p { margin: 0 0 8px; }
.hp-extra ul { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
.hp-extra li { padding: 14px; border: 1px solid var(--line, #ccc); border-radius: 6px; }
.hp-more ul { columns: 2 220px; }
.hp-more li { padding: 4px 0; break-inside: avoid; }
.hp-about { padding: 20px; border: 1px solid var(--line, #ccc); border-radius: 6px; }
.hp-mixed-order { order: 0; }
@media (max-width: 760px) {
  .hp-hero-split, .hp-hero-type, .hp-hero-search, .hp-hero-donate, .hp-hero-lead { grid-template-columns: 1fr; }
  .hp-hero img { max-height: 260px; }
  .hp-cards-lead ul { grid-template-columns: 1fr 1fr; }
  .hp-week { grid-template-columns: 1fr; }
}
@media (max-width: 480px) {
  .hp-cards-lead ul { grid-template-columns: 1fr; }
  .hp-cards-lead .hp-card-first { grid-column: auto; grid-row: auto; }
}
/* Legacy 2000s portal home */
.legacy-home { font-family: Verdana, Arial, Helvetica, sans-serif; font-size: 13px; }
.lh-layout { border-collapse: collapse; table-layout: auto; width: 100%; }
.lh-layout > tbody > tr > td { vertical-align: top; padding: 6px; }
.lh-box { border: 1px solid #8a9aa9; border-collapse: collapse; margin-bottom: 10px; background: #fbfbf4; }
.lh-box-title { background: #33557a; color: #fff; text-align: left; font-size: 12px; padding: 4px 6px; }
.lh-box-title h2 { font-size: 12px; margin: 0; color: #fff; }
.lh-links, .lh-plain { margin: 0; padding-left: 16px; }
.lh-links li, .lh-plain li { margin: 3px 0; }
.lh-news { border: 1px solid #8a9aa9; border-collapse: collapse; margin: 10px 0; }
.lh-news td { border-top: 1px dotted #9aa; padding: 5px; vertical-align: top; }
.lh-date { color: #7a2a00; font-weight: bold; white-space: nowrap; }
.lh-new { color: #c00; font-weight: bold; font-size: 10px; }
.lh-welcome { font-family: Georgia, 'Times New Roman', serif; color: #33557a; font-size: 20px; margin: 4px 0 8px; }
.lh-image { float: right; margin: 0 0 8px 10px; max-width: 160px; }
.lh-image .visual { margin: 0; }
.lh-image img { width: 160px; height: auto; border: 1px solid #666; }
.lh-about { clear: both; margin-top: 10px; }
.lh-updated { clear: both; font-size: 11px; color: #666; border-top: 1px solid #ccc; padding-top: 4px; }
@media (max-width: 700px) {
  .lh-layout, .lh-layout > tbody, .lh-layout > tbody > tr, .lh-layout > tbody > tr > td { display: block; width: auto !important; }
  .lh-image { float: none; max-width: 100%; }
}
`;
}
